#!/usr/bin/env python3
"""Local Task Manager — local server (Python 3 stdlib only).

    python3 server.py            # http://127.0.0.1:3100

Config lives in config.json next to this file (created from the Settings screen;
see config.example.json). Without it, the bundled sample-vault/ is used.
"""

import json
import mimetypes
import re
import threading
import time
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlparse

import base64
import errno
import queue
import signal

from tm import attachments, export
from tm.launchd import activated_sockets
from tm.fsutil import atomic_write
from tm.launch import (CLAUDE_EFFORTS, CLAUDE_MODELS, claude_flags, claude_script, claude_theme, desktop_new_url, desktop_resume_flags,
                       ide_open_url, resume_flags, session_flags, session_updated)
from tm.pty import MAX_COLS, MAX_ROWS, MIN_COLS, MIN_ROWS, Terms, dim
from tm.store import (ACTIVITY_SOURCES, DEFAULT_FOLDERS, DEFAULT_WORK_KINDS, ITEM_TYPES, PARENT_TYPES, PRIORITIES,
                      STATUSES, Store, StoreError, now_stamp)
from tm.structures import DEFAULT_STRUCTURE, REGISTRY, STRUCTURES

APP_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(APP_DIR, 'static')
CONFIG_PATH = os.path.join(APP_DIR, 'config.json')
# The user guide Settings → Documentation shows: what the app gives you and how to use it (also read on GitHub).
GUIDE_PATH = os.path.join(APP_DIR, 'docs', 'user-guide.md')
# What the app and its tools set aside before overwriting something (a config, a vault): one folder next to config.json,
# apart from versions/ (the exports). Never versioned, never exported.
BACKUPS_DIR = 'backups'


def backup_path(name):
    """Where a backup called `name` goes: backups/ next to config.json (made if missing)."""
    folder = os.path.join(os.path.dirname(CONFIG_PATH), BACKUPS_DIR)
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, name)
DEFAULT_CONFIG = {
    'root': 'sample-vault',
    'port': 3100,
    'folders': DEFAULT_FOLDERS,
    'work_kinds': DEFAULT_WORK_KINDS,
    'claude_cwd': '',          # the default among claude_paths: where Claude starts when the item (and its parents) has no Local path; '' = this project's folder
    'claude_paths': [],        # saved folders the dialog offers to start Claude in (absolute, existing). A closed list: the browser picks one, never types one.
    'claude_path_names': {},   # saved folder → its public name, what the dialog shows instead of the path (none: the path); '' = this project's folder
    'claude_command': 'claude',
    'terminal': 'Terminal',    # Terminal | iTerm
    'editor_app': 'Cursor',    # the Explorer's "Open in <editor>": one of EDITORS
    'claude_model': '',        # '' = Claude's own default; else one of CLAUDE_MODELS
    'claude_effort': '',       # '' = Claude's own default; else one of CLAUDE_EFFORTS
    # The vaults this app can show: [{id, name, path, structure, folders}]. `root` and `folders` above are kept
    # equal to the default vault's, for the tools in tools/ and for a config written before there were vaults.
    'vaults': [],
    'default_vault': '',
}
TERMINALS = ('Terminal', 'iTerm')
# The apps the Explorer may open a vault file in (`open -a`): a closed list, so a config can never name a program.
EDITORS = ('Cursor', 'Visual Studio Code', 'Zed', 'Sublime Text', 'BBEdit', 'TextEdit')
VAULT_HEADER = 'X-TM-Vault'
VAULT_ID_RE = re.compile(r'^[a-z0-9][a-z0-9-]{0,31}$')


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, encoding='utf-8') as f:
            cfg.update(json.load(f))
    cfg['folders'] = {**DEFAULT_FOLDERS, **cfg.get('folders', {})}
    cfg['claude_paths'] = clean_paths(cfg.get('claude_paths'), cfg.get('claude_cwd'))
    cfg['claude_path_names'] = clean_names(cfg.get('claude_path_names'), cfg['claude_paths'])
    # A config from before there were vaults: its root becomes the one vault, in memory only. The file is
    # left as it is until the next save from Settings (which keeps a copy of it first).
    if not isinstance(cfg.get('vaults'), list) or not cfg['vaults']:
        cfg['vaults'] = [{'id': DEFAULT_STRUCTURE, 'name': STRUCTURES[DEFAULT_STRUCTURE]['label'], 'path': cfg['root'],
                          'structure': DEFAULT_STRUCTURE, 'folders': cfg['folders']}]
    cfg['vaults'] = [{**v, 'structure': v.get('structure') or DEFAULT_STRUCTURE} for v in cfg['vaults'] if isinstance(v, dict)]
    cfg['vaults'] = [{**v, 'folders': vault_folders(v['structure'], v.get('folders')),
                      'disabled_types': vault_disabled(v['structure'], v.get('disabled_types'))}
                     for v in cfg['vaults']]
    if cfg.get('default_vault') not in {v.get('id') for v in cfg['vaults']}:
        cfg['default_vault'] = cfg['vaults'][0].get('id')
    return cfg


def vault_folders(structure, folders):
    """A vault's folders for new items: its structure's, with the ones Settings moved (only for a structure whose
    layout is one folder per type; Ticketing's layout is fixed, so it has none of its own)."""
    s = REGISTRY.get(structure or DEFAULT_STRUCTURE)
    if not s or not s.folders_configurable:
        return {}
    base = s.default_folders
    return {**base, **{k: str(v).strip().strip('/') for k, v in (folders or {}).items()
                       if k in base and str(v or '').strip().strip('/')}}


def vault_disabled(structure, disabled):
    """The types a vault turned off, as read from config.json: only its structure's, never a required one (a hand-
    edited config cannot hide a type the structure needs)."""
    s = REGISTRY.get(structure or DEFAULT_STRUCTURE)
    if not s:
        return []
    return [t for t in (disabled or []) if t in s.types and t not in s.required]


def structures_matching(path, structure=None, folders=None):
    """The structures whose shape this folder has (their check passes), as ids. An empty folder has none: it is the
    start of any of them. `folders` are the vault's own, for its own `structure` (the folder-per-type structure lets a vault move its
    types' folders); any other structure is checked with its default ones."""
    real = resolve_root(path)
    try:
        if not any(not n.startswith('.') for n in os.listdir(real)):
            return []
    except OSError:
        return []
    out = []
    for sid, s in REGISTRY.items():
        own = folders if sid == structure and s.folders_configurable else None
        if Store(real, own, s).check()['ok']:
            out.append(sid)
    return out


def _same_or_inside(a, b):
    return a == b or a.startswith(b.rstrip(os.sep) + os.sep)


def _slug(text):
    out = re.sub(r'[^a-z0-9]+', '-', str(text or '').lower()).strip('-')[:32].strip('-')
    return out or 'vault'


def clean_vaults(vaults, default_vault):
    """The vault list from Settings, checked: ids kept (a new vault gets one from its name, once, and it never
    changes), a name, an existing folder that is not / nor the home folder, a known structure, and no vault
    inside another (the outer one would read the inner one's files as its own). → (vaults, default_vault)."""
    if not isinstance(vaults, list) or not vaults:
        raise StoreError(400, 'there must be at least one vault')
    given = {str(v.get('id') or '') for v in vaults if isinstance(v, dict)}
    out, ids, roots = [], set(), []
    for raw in vaults:
        if not isinstance(raw, dict):
            raise StoreError(400, 'each vault must be an object')
        name = ' '.join(str(raw.get('name') or '').split())
        if not name:
            raise StoreError(400, 'every vault needs a name')
        vid = str(raw.get('id') or '').strip()
        if vid and not VAULT_ID_RE.match(vid):
            raise StoreError(400, f'not a valid vault id: {vid}')
        if not vid:  # a new vault: an id from its name, free among the others
            base = vid = _slug(name)
            n = 2
            while vid in ids or vid in given:
                vid = f'{base[:28]}-{n}'
                n += 1
        if vid in ids:
            raise StoreError(400, f'two vaults have the id {vid}')
        structure = raw.get('structure') or DEFAULT_STRUCTURE
        if structure not in STRUCTURES:
            raise StoreError(400, f'unknown structure: {structure}')
        path = _tidy_path(raw.get('path'))
        if not path:
            raise StoreError(400, f'the vault "{name}" needs a folder')
        real = resolve_root(path)
        if not os.path.isdir(real):
            raise StoreError(400, f'not a directory: {real}')
        if real in (os.path.realpath(os.sep), os.path.realpath(os.path.expanduser('~'))):
            raise StoreError(400, f'a vault cannot be the whole disk or the home folder: {real}')
        for other_name, other in roots:
            if _same_or_inside(real, other) or _same_or_inside(other, real):
                raise StoreError(400, f'the vaults "{name}" and "{other_name}" overlap: one folder is inside the other')
        folders = vault_folders(structure, raw.get('folders'))
        disabled = [str(t) for t in (raw.get('disabled_types') or []) if str(t).strip()]
        s = REGISTRY[structure]
        for t in disabled:
            if t not in s.types:
                raise StoreError(400, f'the vault "{name}": {t} is not a type of the {s.label} structure')
            if t in s.required:
                raise StoreError(400, f'the vault "{name}": {s.types[t].plural} cannot be turned off in {s.label}')
        if not set(s.types) - set(disabled):
            raise StoreError(400, f'the vault "{name}" needs at least one type turned on')
        ids.add(vid)
        roots.append((name, real))
        out.append({'id': vid, 'name': name, 'path': path, 'structure': structure, 'folders': folders,
                    'disabled_types': sorted(set(disabled), key=list(s.types).index)})
    return out, (default_vault if default_vault in ids else out[0]['id'])


def _tidy_path(p):
    return os.path.expanduser(str(p or '').strip()).rstrip('/') or ''


def clean_paths(paths, default=''):
    """The saved folders, tidy: expanded, stripped, no repeats, in the order given, plus the default when it is
    not among them (a config written before the list existed only had claude_cwd). Existence is checked on save."""
    out = []
    for p in [*(paths if isinstance(paths, list) else []), default]:
        p = _tidy_path(p)
        if p and p not in out:
            out.append(p)
    return out


def clean_names(names, paths):
    """The public names of the saved folders: keyed like the paths (tidied the same way), one line, only for a
    folder still in the list or '' (the project folder of this app), and only when there is a name (none: the
    dialog shows the path)."""
    out = {}
    for p, name in (names.items() if isinstance(names, dict) else []):
        p, name = _tidy_path(p), ' '.join(str(name or '').split())
        if (p in paths or p == '') and name:
            out[p] = name
    return out


def resolve_root(root):
    return os.path.realpath(os.path.join(APP_DIR, os.path.expanduser(root)))


def open_vault_store(vault_id=None, structures=('folders',)):
    """For the tools in tools/: the store of one vault from config.json (the default one when no id is given),
    as the server opens it. Refused (ValueError, with the reason) when the vault is not of a structure the tool
    knows, or its folder does not match its structure: the tool must not write into it."""
    cfg = load_config()
    vault_id = vault_id or cfg['default_vault']
    vault = next((v for v in cfg['vaults'] if v['id'] == vault_id), None)
    if not vault:
        raise ValueError(f"no vault '{vault_id}' in config.json (there are: {', '.join(v['id'] for v in cfg['vaults'])})")
    if vault['structure'] not in structures:
        raise ValueError(f"the vault '{vault_id}' has the {vault['structure']} structure, which this tool does not handle")
    store = Store(resolve_root(vault['path']), vault['folders'], vault['structure'], enforce_structure=True,
                  disabled_types=vault.get('disabled_types') or ())
    result = store.check()
    if not result['ok']:
        found = '; '.join(f"{f['path']}: {f['detail']}" for f in result['blocking'][:5])
        raise ValueError(f"the vault '{vault_id}' does not match its structure, so nothing is written to it ({found})")
    return store


class App:
    def __init__(self):
        self.config = load_config()
        # One store per vault, opened when first asked for. No migration here: this runs on import (the tests
        # import this module), and importing must never rewrite a vault. main() migrates before serving.
        self.stores = {}
        self._stores_lock = threading.Lock()

    # ── vaults ───────────────────────────────────────────────────────────────
    def vault(self, vault_id):
        found = next((v for v in self.config['vaults'] if v['id'] == vault_id), None)
        if not found:
            raise StoreError(404, f'unknown vault: {vault_id}. Reload the page.', reload=True)
        return found

    @staticmethod
    def _build(vault):
        return Store(resolve_root(vault['path']), vault['folders'], vault['structure'], enforce_structure=True,
                     disabled_types=vault.get('disabled_types') or ())

    def store_for(self, vault_id):
        vault = self.vault(vault_id)
        with self._stores_lock:
            if vault_id not in self.stores:
                self._put(vault_id, self._build(vault))
            return self.stores[vault_id]

    def _put(self, vault_id, store):
        store.vault_id = vault_id  # which vault a store is, for the answers that name it (callers hold the lock)
        self.stores[vault_id] = store

    # `store` is the default vault's: what the tools and the tests written before there were vaults use.
    @property
    def store(self):
        return self.store_for(self.config['default_vault'])

    @store.setter
    def store(self, value):
        with self._stores_lock:
            self._put(self.config['default_vault'], value)

    def public_vault(self, vault_id):
        v = self.vault(vault_id)
        return {'id': v['id'], 'name': v['name'], 'structure': v['structure'], 'path': v['path'],
                'root': self.store_for(vault_id).root}

    @staticmethod
    def migrate(store):
        """One-off upgrades of a vault's files, only on a vault that matches its structure: one that does not
        is read-only, and these write."""
        if not store.check()['ok']:
            print(f'not migrating {store.root}: it does not match its structure')
            return
        for m in store.migrate_user_stories():  # stories embedded in initiatives become items (once)
            print(f"migrated {m['was']} of {m['initiative']} → {m['story']}")

    def _open(self, vault):
        store = self._build(vault)
        self.migrate(store)
        return store

    def set_config(self, changes):
        cfg = {**self.config, **{k: v for k, v in changes.items() if k in DEFAULT_CONFIG}}
        if 'vaults' not in changes:
            # A save without the vault list (from before there were vaults, or a tool): `root` and `folders`
            # are the default vault's.
            cfg['vaults'] = [{**v, 'path': cfg['root'], 'folders': cfg['folders']} if v['id'] == cfg['default_vault'] else v
                             for v in cfg['vaults']]
        cfg['vaults'], cfg['default_vault'] = clean_vaults(cfg['vaults'], cfg.get('default_vault'))
        self._refuse_other_shapes(cfg['vaults'])
        default = next(v for v in cfg['vaults'] if v['id'] == cfg['default_vault'])
        cfg['root'], cfg['folders'] = default['path'], default['folders']
        root = resolve_root(cfg['root'])
        if not os.path.isdir(root):
            raise StoreError(400, f'not a directory: {root}')
        kinds = [str(k).strip() for k in cfg.get('work_kinds') or [] if str(k).strip()]
        if not kinds:
            raise StoreError(400, 'work_kinds cannot be empty')
        cfg['work_kinds'] = kinds
        if cfg.get('terminal') not in TERMINALS:
            raise StoreError(400, f'terminal must be one of {", ".join(TERMINALS)}')
        if cfg.get('editor_app') not in EDITORS:
            raise StoreError(400, f'editor_app must be one of {", ".join(EDITORS)}')
        if not shlex.split(str(cfg.get('claude_command') or '')):
            raise StoreError(400, 'claude_command cannot be empty')
        try:
            claude_flags(cfg.get('claude_model'), cfg.get('claude_effort'))
        except ValueError as e:
            raise StoreError(400, str(e))
        cfg['claude_cwd'] = os.path.expanduser(str(cfg.get('claude_cwd') or '').strip()).rstrip('/')
        cfg['claude_paths'] = clean_paths(cfg.get('claude_paths'), cfg['claude_cwd'])
        cfg['claude_path_names'] = clean_names(cfg.get('claude_path_names'), cfg['claude_paths'])
        for folder in cfg['claude_paths']:
            if not os.path.isabs(folder) or not os.path.isdir(folder):
                raise StoreError(400, f'not a directory: {folder}')
        before = {v['id']: v for v in self.config['vaults']}
        self._keep_copy_before_vaults()
        atomic_write(CONFIG_PATH, json.dumps(cfg, indent=2, ensure_ascii=False) + '\n')
        self.config = load_config()
        # Reopening drops the cache and re-runs the migration over the whole vault: only worth it for a vault
        # whose folder, structure or folders changed. Everything else (kinds, Claude, terminal) is read live.
        # A vault taken out of the list is only forgotten: nothing on disk is touched.
        def shape(v):
            return resolve_root(v['path']), v['structure'], v['folders'], tuple(v.get('disabled_types') or ())
        with self._stores_lock:
            old_stores, self.stores = self.stores, {}
        for v in self.config['vaults']:
            was = before.get(v['id'])
            store = old_stores.get(v['id']) if was and shape(was) == shape(v) else None
            if store is None and (was or v['id'] == self.config['default_vault']):
                store = self._open(v)  # a vault that changed (or the default): reopened now, migrated if it matches
            if store is not None:
                with self._stores_lock:
                    self._put(v['id'], store)

    def _refuse_other_shapes(self, vaults):
        """A vault given a folder (or a structure) that clearly is another structure's vault — a folder-per-type vault saved
        as Ticketing, two folders swapped between two new vaults — is refused, and nothing is saved. Only for a vault
        that is new or whose folder or structure changed: one already saved keeps its notice instead."""
        before = {v['id']: v for v in self.config['vaults']}
        for v in vaults:
            was = before.get(v['id'])
            if was and resolve_root(was['path']) == resolve_root(v['path']) and was['structure'] == v['structure']:
                continue
            shapes = structures_matching(v['path'], v['structure'], v.get('folders'))
            if shapes and v['structure'] not in shapes:
                other = ' or '.join(REGISTRY[s].label for s in shapes)
                raise StoreError(400, f'the folder of "{v["name"]}" ({resolve_root(v["path"])}) holds a vault of the {other} '
                                      f'structure, not {REGISTRY[v["structure"]].label}: pick {other} for it, or another folder')

    @staticmethod
    def _keep_copy_before_vaults():
        """The first save that writes the vault list keeps the config as it was: backups/config.json.bak-<stamp>."""
        try:
            with open(CONFIG_PATH, encoding='utf-8') as f:
                text = f.read()
        except FileNotFoundError:
            return
        try:
            had_vaults = bool(json.loads(text).get('vaults'))
        except (ValueError, AttributeError):
            had_vaults = False
        if not had_vaults:
            stamp = now_stamp().replace(':', '').replace('T', '-')
            atomic_write(backup_path(f'{os.path.basename(CONFIG_PATH)}.bak-{stamp}'), text)

    def public_config(self):
        return {**self.config, 'root_resolved': self.store.root, 'structures': {k: v['label'] for k, v in STRUCTURES.items()},
                # what each structure lets a vault turn on and off (Settings → Vaults)
                'structure_types': {k: s.type_choices() for k, s in REGISTRY.items()},
                'statuses': STATUSES, 'item_types': list(ITEM_TYPES),
                'priorities': PRIORITIES, 'parent_types': PARENT_TYPES, 'activity_sources': ACTIVITY_SOURCES,
                'editors': list(EDITORS),  # what Settings offers for the Explorer's "Open in <editor>"
                'claude_targets': open_targets(),  # where a Claude session can open: Open in ▾ (claude.js)
                'claude_theme': claude_theme()}  # the embedded terminal takes Claude Code's own theme


APP = App()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if os.environ.get('TM_VERBOSE'):
            super().log_message(fmt, *args)

    # ── io ───────────────────────────────────────────────────────────────────
    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def send_export(self, name):
        """A zip of versions/ (it may hold a whole vault): like a vault file, only for this app's own pages."""
        if self.headers.get('Sec-Fetch-Site', 'none') not in ('same-origin', 'none'):
            return self.send_json({'error': 'exports are for this app only'}, 403)
        path = export.path_of(source_dir(), name)
        self.send_response(200)
        self.send_header('Content-Type', 'application/zip')
        self.send_header('Content-Disposition', f'attachment; filename="{os.path.basename(path)}"')
        self.send_header('Content-Length', str(os.path.getsize(path)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        with open(path, 'rb') as f:
            shutil.copyfileobj(f, self.wfile)

    def read_upload(self):
        """An attachment's bytes, sent as they are (no JSON, no base64), its name in X-TM-Filename (URI-encoded).
        Too big is refused before anything is read."""
        length = int(self.headers.get('Content-Length') or 0)
        if length > attachments.MAX_BYTES:
            self.close_connection = True  # the body stays unread: this connection cannot carry another request
            raise StoreError(413, f'an attachment is at most {attachments.MAX_BYTES // (1024 * 1024)} MB')
        return {'data': self.rfile.read(length) if length else b'', 'filename': unquote(self.headers.get('X-TM-Filename') or '')}

    def send_vault_file(self, q, resolve):
        """One file of a vault: an attachment (resolve = Store.attachment_file) or any file the Explorer shows
        (Store.vault_file). An <img> or a link cannot send X-TM-Vault, so the vault comes in the query. Only this
        app's own pages may load it (Sec-Fetch-Site, CORP); it is never sniffed, and it runs nothing even opened on its
        own (a sandbox CSP; not on a PDF, whose viewer it would stop). What the page cannot show is downloaded."""
        if self.headers.get('Sec-Fetch-Site', 'none') not in ('same-origin', 'none'):
            return self.send_json({'error': 'vault files are for this app only'}, 403)
        path = resolve(APP.store_for(q.get('vault') or ''), q.get('path'))
        ctype = mimetypes.guess_type(path)[0] or 'application/octet-stream'
        shown = attachments.inline(ctype)
        self.send_response(200)
        self.send_header('Content-Type', ctype + ('; charset=utf-8' if ctype.startswith('text/') else ''))
        self.send_header('Content-Length', str(os.path.getsize(path)))
        self.send_header('Content-Disposition', f"{'inline' if shown else 'attachment'}; filename*=UTF-8''{quote(os.path.basename(path))}")
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-TM-Rev', Store.disk_rev(path))  # the version the Explorer's editor saves against
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        if ctype != 'application/pdf':
            self.send_header('Content-Security-Policy', 'sandbox')
        self.end_headers()
        with open(path, 'rb') as f:
            shutil.copyfileobj(f, self.wfile)

    def read_json(self):
        length = int(self.headers.get('Content-Length') or 0)
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode('utf-8'))

    def send_static(self, rel):
        path = os.path.realpath(os.path.join(STATIC_DIR, rel))
        if not path.startswith(STATIC_DIR + os.sep) or not os.path.isfile(path):
            return self.send_json({'error': 'not found'}, 404)
        ctype = mimetypes.guess_type(path)[0] or 'application/octet-stream'
        if path.endswith('.js'):
            ctype = 'text/javascript'
        with open(path, 'rb') as f:
            data = f.read()
        self.send_response(200)
        self.send_header('Content-Type', ctype + ('; charset=utf-8' if ctype.startswith('text') else ''))
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def host_ok(self):
        """DNS-rebinding guard: only answer requests addressed to this machine by name/IP."""
        port = self.server.server_address[1]
        allowed = {f'127.0.0.1:{port}', f'localhost:{port}'}
        if self.headers.get('Host') not in allowed:
            return False
        origin = self.headers.get('Origin')
        return origin is None or origin in {f'http://{h}' for h in allowed}

    def dispatch(self, method):
        if not self.host_ok():
            return self.send_json({'error': 'forbidden host/origin'}, 403)
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        route = (method, url.path)
        try:
            if method == 'GET' and not url.path.startswith('/api/'):
                rel = url.path.lstrip('/') or 'index.html'
                return self.send_static(rel)
            if route == ('GET', '/api/term/stream'):  # streams: it writes the response itself
                return self.stream_term(q)
            if route == ('GET', '/api/exports/file'):  # a zip, not JSON
                return self.send_export(q.get('name'))
            if route == ('GET', '/api/attachments/file'):  # a file, not JSON; its vault in the query
                return self.send_vault_file(q, lambda store, path: store.attachment_file(path))
            if route == ('GET', '/api/files/raw'):  # any file the Explorer shows, the same way
                return self.send_vault_file(q, lambda store, path: store.vault_file(path))
            handler = ROUTES.get(route)
            if not handler:
                return self.send_json({'error': f'no route {method} {url.path}'}, 404)
            # CSRF guard: a custom header forces a CORS preflight, which this server
            # never answers, so other origins cannot reach a mutating endpoint.
            if method == 'POST' and self.headers.get('X-Task-Manager') != '1':
                return self.send_json({'error': 'missing X-Task-Manager header'}, 403)
            body = (self.read_upload() if route in UPLOAD_ROUTES else self.read_json()) if method == 'POST' else {}
            return self.send_json(handler(self.vault_store(route), q, body))
        except StoreError as e:
            return self.send_json({**e.extra, 'error': str(e)}, e.status)
        except export.ExportError as e:
            return self.send_json({'error': str(e)}, 404)
        except (ValueError, KeyError, TypeError) as e:
            return self.send_json({'error': f'bad request: {e}'}, 400)
        except OSError as e:
            return self.send_json({'error': f'filesystem: {e}'}, 500)
        except Exception as e:  # a bug must still answer: without this the browser just sees the connection drop
            traceback.print_exc()
            return self.send_json({'error': f'internal error: {type(e).__name__}: {e}'}, 500)

    def vault_store(self, route):
        """The store of the vault this request is about, named by the page in every request (X-TM-Vault), never
        remembered here: a tab still showing another vault can only ever touch that vault, even after another tab
        switched. None for the routes that are not about a vault (config, terminals' io, exports, Finder)."""
        if route in GLOBAL_ROUTES:
            return None
        vault_id = self.headers.get(VAULT_HEADER)
        if not vault_id:
            raise StoreError(400, f'missing {VAULT_HEADER} header: reload the page', reload=True)
        return APP.store_for(vault_id)

    # ── the embedded terminal's output: one Server-Sent Events stream per open tab ──
    def stream_term(self, q):
        """`snapshot` (what was printed so far), then `data` chunks, then `exit`. Bytes go base64: a chunk may cut
        a UTF-8 sequence in two, and xterm.js reassembles them itself. A comment line every 15 s keeps the
        connection from idling out."""
        term = TERMS.get(q.get('id'))
        snapshot, sub = term.subscribe()
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()

        def b64(data):
            return base64.b64encode(data).decode('ascii')

        def event(name, payload):
            self.wfile.write(f'event: {name}\ndata: {json.dumps(payload)}\n\n'.encode('utf-8'))
            self.wfile.flush()
        try:
            event('snapshot', {'data': b64(snapshot), 'alive': term.alive, 'cols': term.cols, 'rows': term.rows})
            while True:
                try:
                    chunk = sub.get(timeout=15)
                except queue.Empty:
                    self.wfile.write(b': ping\n\n')
                    self.wfile.flush()
                    continue
                if chunk is None:
                    event('exit', {'exit_code': term.exit_code})
                    break
                parts = [chunk]
                while True:  # coalesce what is already waiting: fewer, larger events while Claude redraws
                    try:
                        more = sub.get_nowait()
                    except queue.Empty:
                        break
                    if more is None:
                        sub.put(None)
                        break
                    parts.append(more)
                event('data', {'data': b64(b''.join(parts))})
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass  # the tab went away
        finally:
            term.unsubscribe(sub)

    def do_GET(self):
        self.dispatch('GET')

    def do_POST(self):
        self.dispatch('POST')


# The running server, for Settings → App: how it was started, since when, and how it stops (main() fills it in).
SERVER = {'on_demand': False, 'started_at': None, 'port': None, 'stop': None}


def server_status():
    """What Settings → App shows: whether this server runs as the installed app (started on demand by launchd,
    tools/install_app.py) or by hand, since when, on which port, from which folder."""
    started = SERVER['started_at']
    return {'pid': os.getpid(), 'port': SERVER['port'], 'on_demand': SERVER['on_demand'], 'app_dir': APP_DIR,
            'started_at': started, 'uptime_s': int(time.time() - started) if started else None}


def stop_server():
    """Settings → App's Stop: the answer goes out first, then the server ends as on Ctrl-C (its terminals with it).
    Started on demand, launchd keeps listening and starts it again the next time the app is opened."""
    stop = SERVER['stop']
    if stop:
        threading.Timer(0.4, stop).start()
    return {'stopping': bool(stop), 'on_demand': SERVER['on_demand']}


def open_in_editor(store, path):
    """A vault file or folder opened in the editor of Settings (Cursor by default): `open -a <app> <path>`, which
    hands it to that app to edit — never runs it. Only a path the Explorer shows (inside the vault, nothing hidden)."""
    if sys.platform != 'darwin':
        raise StoreError(501, 'opening in an editor needs macOS')
    rel = store._rel_path(path, allow_root=True)
    full = store.abs(rel) if rel else store.root
    if not os.path.exists(full):
        raise StoreError(404, f'no such file: {rel}')
    app = APP.config.get('editor_app') or 'Cursor'
    if app not in EDITORS:
        raise StoreError(400, f'editor_app must be one of {", ".join(EDITORS)}')
    try:
        subprocess.run(['open', '-a', app, full], check=True, timeout=10, capture_output=True)
    except subprocess.CalledProcessError:
        raise StoreError(400, f'{app} could not open it: is it installed? Pick another editor in Settings → General.') from None
    return {'opened': rel, 'app': app}


def open_local(path):
    """Show a local path in the file manager — never launch it.

    `open <file>` would run an .app/.command/.sh, and paths come from .md files
    that anyone may have written. So only a plain folder is opened; everything
    else is revealed (selected in Finder), never opened.

    "Plain folder" is an allowlist, never a denylist of bundle suffixes: macOS
    launches or installs many package types (.app .prefPane .saver .mpkg
    .workflow .plugin…), matches them case-insensitively (`Evil.APP`), and also
    treats an extensionless folder with Finder's bundle bit as a package. So a
    folder is opened only if its name has no dot at all and it has no bundle
    structure (`Contents/`), which is what a package needs to run anything.
    """
    path = os.path.realpath(os.path.expanduser(str(path or '')))
    if not os.path.exists(path):
        raise StoreError(404, f'path does not exist: {path}')
    is_plain_dir = (os.path.isdir(path) and '.' not in os.path.basename(path)
                    and not os.path.exists(os.path.join(path, 'Contents')))
    if sys.platform == 'darwin':
        cmd = ['open', path] if is_plain_dir else ['open', '-R', path]
    else:
        cmd = ['xdg-open', path if is_plain_dir else os.path.dirname(path)]
    subprocess.run(cmd, check=True, timeout=10)
    return {'opened' if is_plain_dir else 'revealed': path}


def folder_name(path):
    """The public name (Settings) of a folder Claude runs in, matched on the real path; '' when it has none."""
    real = os.path.realpath(path)
    names = APP.config.get('claude_path_names', {})
    named = next((n for p, n in names.items() if p and os.path.realpath(p) == real), '')
    return named or (names.get('', '') if real == os.path.realpath(source_dir()) else '')


# Open in ▾ (TSK-038): where a Claude session can open besides Terminal — each an app of this Mac, offered when it is
# installed. A session opened there is not recorded: the app picks its own id (only Terminal and the dock fix it).
OPEN_TARGETS = {'desktop': ('Claude Desktop', 'Claude', '/Applications/Claude.app'),
                'cursor': ('Cursor', 'Cursor', '/Applications/Cursor.app'),
                'antigravity': ('Antigravity', 'Antigravity', '/Applications/Antigravity.app')}


def open_targets():
    """[{key, label}]: Terminal, then each OPEN_TARGETS app installed here (macOS only)."""
    out = [{'key': 'terminal', 'label': APP.config.get('terminal') or 'Terminal'}]
    if sys.platform == 'darwin':
        out += [{'key': k, 'label': label} for k, (label, _, path) in OPEN_TARGETS.items() if os.path.isdir(path)]
    return out


def _target(target):
    t = target or 'terminal'
    if t not in {o['key'] for o in open_targets()}:
        raise StoreError(400, f'cannot open in {t} here')
    return t


def _open_url(*cmds):
    """`open` calls in turn (an IDE: its folder first, then its extension's URL, a moment later so the window is there)."""
    for i, cmd in enumerate(cmds):
        if i:
            time.sleep(1.0)
        try:
            subprocess.run(cmd, check=True, timeout=15, capture_output=True)
        except (subprocess.SubprocessError, OSError) as e:
            raise StoreError(500, f'could not open it: {e}')


def _open_elsewhere(target, cwd, prompt=None, session=None):
    """A new session (`prompt`) or a recorded one (`session`) opened in Claude Desktop or an IDE, in `cwd`."""
    label, app, _ = OPEN_TARGETS[target]
    if target == 'desktop':
        if session:  # the CLI hands it over (documented: --desktop with --resume)
            try:
                run = subprocess.run([*shlex.split(APP.config['claude_command']), *desktop_resume_flags(session)], cwd=cwd,
                                     capture_output=True, text=True, timeout=30)
            except (subprocess.SubprocessError, OSError, ValueError) as e:
                raise StoreError(500, f'could not hand it to Claude Desktop: {e}')
            if run.returncode != 0:
                raise StoreError(500, f'could not hand it to Claude Desktop: {(run.stderr or run.stdout).strip()[:300]}')
        else:
            _open_url(['open', desktop_new_url(cwd, prompt)])
    else:
        _open_url(['open', '-a', app, cwd], ['open', ide_open_url(target, session=session, prompt=None if session else prompt)])
    return {'launched': True, 'target': target, 'target_label': label, 'cwd': cwd, 'recorded': False}


def _command_line(flags):
    return ' '.join(shlex.quote(w) for w in [*shlex.split(APP.config['claude_command']), *flags])


def claude_preview(store, key, instruction='', model=None, effort=None, cwd=None):
    """What would be sent, and where: shown to the user before anything is launched.
    Without a key (the top bar's terminal) the prompt is the instruction alone, run in the default folder.
    `cwd` picks one of the saved folders (Settings) instead of the automatic one: anything else is refused."""
    model = APP.config.get('claude_model') if model is None else model  # not sent: the Settings default
    effort = APP.config.get('claude_effort') if effort is None else effort
    try:
        flags = claude_flags(model, effort)
    except ValueError as e:
        raise StoreError(400, str(e))
    chosen = os.path.expanduser(str(cwd or '').strip()).rstrip('/')
    if chosen:
        if chosen not in APP.config['claude_paths']:  # a closed list, like the model: the browser never names a folder
            raise StoreError(400, 'the folder must be one of the saved paths in Settings')
        if not os.path.isdir(chosen):
            raise StoreError(409, f'that folder no longer exists: {chosen}')
        where = {'path': os.path.realpath(chosen), 'source': 'chosen', 'from_id': None}
    else:
        configured = str(APP.config.get('claude_cwd') or '').strip()
        where = store.claude_cwd(key or None, configured or source_dir())  # nothing set anywhere: the checkout, not the home folder
        if where['source'] == 'settings' and not configured:
            where = {**where, 'source': 'project'}
    prompt = store.claude_prompt(key, instruction) if key else ((instruction or '').strip() + store.mentions_note(instruction))
    return {'prompt': prompt, 'cwd': where['path'], 'cwd_name': folder_name(where['path']), 'cwd_source': where['source'],
            'cwd_from': where['from_id'], 'terminal': APP.config['terminal'], 'launchable': sys.platform == 'darwin',
            'flags': flags, 'command': _command_line(flags), 'model': (model or '').strip(), 'effort': (effort or '').strip(),
            'models': list(CLAUDE_MODELS), 'efforts': list(CLAUDE_EFFORTS), 'targets': open_targets()}


def _open_terminal(cwd, flags, prompt=None):
    """Open Terminal (or iTerm) in `cwd` running `claude <flags>`, with `prompt` as the first message when given.
    The prompt goes through a private temp file, never the command line; the script removes the folder itself."""
    if sys.platform != 'darwin':
        raise StoreError(501, 'launching a terminal is only supported on macOS — copy the prompt instead')
    tmp = tempfile.mkdtemp(prefix='tm-claude-')  # 0700
    prompt_file = os.path.join(tmp, 'prompt.md') if prompt is not None else None
    script = os.path.join(tmp, 'run.command')
    if prompt_file:
        with open(prompt_file, 'w', encoding='utf-8') as f:
            f.write(prompt)
    with open(script, 'w', encoding='utf-8') as f:
        f.write(claude_script(cwd, prompt_file, tmp, APP.config['claude_command'], flags))
    os.chmod(script, 0o700)
    try:
        subprocess.run(['open', '-a', APP.config['terminal'], script], check=True, timeout=10)
    except (subprocess.SubprocessError, OSError) as e:
        shutil.rmtree(tmp, ignore_errors=True)
        raise StoreError(500, f'could not open {APP.config["terminal"]}: {e}')
    return {'launched': True, 'cwd': cwd, 'terminal': APP.config['terminal'], 'command': _command_line(flags)}


def _launch_plan(store, key, instruction, model, effort, cwd):
    """Everything a new launch needs, before anything runs: the preview (prompt, folder, flags), the item, a fresh
    session id, the flags that carry it, and the entry to record. Shared by Terminal.app and the embedded terminal."""
    info = claude_preview(store, key, instruction, model, effort, cwd)
    if not key and not info['prompt']:
        raise StoreError(400, 'a prompt is needed when no item is given')
    item = store.read(key) if key else None
    session_id = str(uuid.uuid4())
    name = f"{item['id'] or item['type']} · {item['title']}" if item else info['prompt'].split('\n', 1)[0]
    flags = [*info['flags'], *session_flags(session_id, name)]
    entry = {'id': session_id, 'at': now_stamp(), 'cwd': info['cwd'], 'instruction': (instruction or '').strip(),
             'model': info['model'], 'effort': info['effort']}
    return info, item, session_id, flags, entry, name


def _record(store, out, item, entry):
    """Recorded only once the terminal is open: a failed launch leaves nothing to resume."""
    if item:
        out['item'] = store.add_claude_session(item['key'], entry)
    else:
        store.add_global_claude_session(entry)
    return {**out, 'session_id': entry['id']}


def launch_claude(store, key, instruction='', model=None, effort=None, cwd=None, target='terminal'):
    """Open Terminal in the item's folder with `claude` started on the item as its first message, under a fresh
    session id that is recorded on the item (or in the global list, for the top bar's terminal) so it can be
    resumed later. The client sends only the key and an optional instruction: the prompt is rebuilt here from the file.
    `target` Claude Desktop, Cursor or Antigravity: a new session there, in the same folder, the prompt written and not
    sent (Enter, there), not recorded (the app picks its id, model and effort)."""
    target = _target(target)
    if target != 'terminal':
        info = claude_preview(store, key, instruction, model, effort, cwd)
        if not key and not info['prompt']:
            raise StoreError(400, 'a prompt is needed when no item is given')
        return _open_elsewhere(target, info['cwd'], prompt=info['prompt'])
    info, item, session_id, flags, entry, _ = _launch_plan(store, key, instruction, model, effort, cwd)
    return _record(store, _open_terminal(info['cwd'], flags, info['prompt']), item, entry)


def _resume_plan(store, key, session_id):
    """The record a resume starts from (the item's list, or the global one) and the flags: never from the request,
    so the shell only ever sees what was stored."""
    found = store.claude_session(key or None, session_id)
    try:
        flags = resume_flags(found['id'])
    except ValueError as e:
        raise StoreError(400, str(e))
    if not os.path.isdir(found['cwd']):
        raise StoreError(409, f"the folder this session ran in no longer exists: {found['cwd']}")
    return found, flags


def resume_claude(store, key, session_id, target='terminal'):
    """Reopen a recorded conversation in Terminal.app: `claude --resume <id>` in the folder it ran in. Or in Claude
    Desktop (`claude --desktop --resume <id>`), Cursor or Antigravity (their Claude Code extension, in that folder).
    One still running in the dock is not handed to Desktop: --desktop does not move a live session."""
    target = _target(target)
    found, flags = _resume_plan(store, key, session_id)
    if target == 'terminal':
        return {**_open_terminal(found['cwd'], flags), 'session_id': found['id']}
    try:
        live = TERMS.get(found['id'])  # 404 when the dock never ran it
    except StoreError:
        live = None
    if target == 'desktop' and live and live.alive:
        raise StoreError(409, 'this session is still running in the dock: close it there first, then open it in Claude Desktop')
    return {**_open_elsewhere(target, found['cwd'], session=found['id']), 'session_id': found['id']}


# ── the embedded terminal: claude in a pty inside this server, shown by xterm.js in the dock ──
TERMS = Terms()


def _spawn_term(term_id, flags, cwd, cols, rows, label, prompt=None):
    argv = [*shlex.split(APP.config['claude_command']), *flags, *([prompt] if prompt is not None else [])]
    env = {**os.environ, 'TERM': 'xterm-256color', 'COLORTERM': 'truecolor'}
    env.setdefault('LANG', 'en_US.UTF-8')
    return TERMS.open(term_id, argv, cwd, dim(cols, 100, MIN_COLS, MAX_COLS), dim(rows, 30, MIN_ROWS, MAX_ROWS), env, label)


def open_term(store, key, instruction='', model=None, effort=None, cwd=None, cols=None, rows=None):
    """Like launch_claude, but in the dock: the same session id, flags, folder and record; the prompt is an argument
    of the process (no shell, no file), so quotes, `$(…)` or backticks in a description are just text."""
    info, item, session_id, flags, entry, name = _launch_plan(store, key, instruction, model, effort, cwd)
    term = _spawn_term(session_id, flags, info['cwd'], cols, rows, name, info['prompt'])
    return _record(store, {'term': term.info(), 'cwd': info['cwd'], 'command': _command_line(flags)}, item, entry)


def resume_term(store, key, session_id, cols=None, rows=None):
    """Reopen a recorded conversation in the dock. If that session is already running there, it is handed back."""
    found, flags = _resume_plan(store, key, session_id)
    label = found.get('instruction') or 'Claude'
    if key:
        it = store.find(key)
        label = f"{it['id'] or it['type']} · {it['title']}"
    term = _spawn_term(found['id'], flags, found['cwd'], cols, rows, label)
    return {'term': term.info(), 'cwd': found['cwd'], 'session_id': found['id']}


def term_input(term_id, data):
    TERMS.get(term_id).write(str(data or '').encode('utf-8'))
    return {'ok': True}


def term_resize(term_id, cols, rows):
    term = TERMS.get(term_id)
    term.resize(dim(cols, term.cols, MIN_COLS, MAX_COLS), dim(rows, term.rows, MIN_ROWS, MAX_ROWS))
    return {'cols': term.cols, 'rows': term.rows}


def forget_claude_session(store, key, index):
    return store.forget_claude_session(key, index) if key else store.forget_global_claude_session(index)


def source_dir():
    """This app's own checkout: this folder, or — the installed app — the checkout it came from (install.json).
    Exports are made from it and kept in it, and Claude starts in it when nothing else says where."""
    return export.home(APP_DIR)[0]


def export_version(store, note, kind='system'):
    """A zip in versions/ (tm/export.py): the system, the agents, or the vault being used (only its own zip carries it)."""
    kind = kind or 'system'
    src, why = export.home(APP_DIR)
    if why and kind != 'vault':
        raise StoreError(409, why)
    vault_id = getattr(store, 'vault_id', None)
    others = [resolve_root(v['path']) for v in APP.config['vaults'] if v['id'] != vault_id]
    info = next(({'name': v.get('name'), 'structure': v.get('structure'), 'disabled_types': v.get('disabled_types') or []}
                 for v in APP.config['vaults'] if v['id'] == vault_id), None)
    return export.create(src, note, vault_root=store.root, kind=kind, other_vaults=others, vault_id=vault_id, vault_info=info)


def exports_listing():
    """Settings → Export's lists, and where the zips come from (the installed app: its checkout)."""
    src, why = export.home(APP_DIR)
    return {'exports': export.list_exports(src), 'from': src, 'installed': src != APP_DIR or bool(why), 'limited': why}


def vault_status(store, vault_id):
    """The vault the page shows, and whether its folder matches its structure (when not, the page shows only that,
    and which other structures the folder does match, if any: a vault given the wrong structure)."""
    check = store.check()
    if check['ok']:  # and the files nobody lists: a warning of its own, too slow for the check every write runs
        check = {**check, 'warnings': check['warnings'] + store.unlisted_attachments()}
    vault = APP.public_vault(vault_id)
    matches = [] if check['ok'] else [
        {'id': s, 'label': REGISTRY[s].label} for s in structures_matching(store.root, vault['structure'], store.folders) if s != vault['structure']]
    return {'vault': vault, 'check': check, 'matches': matches}


ROUTES = {
    ('GET', '/api/config'): lambda s, q, b: APP.public_config(),
    ('POST', '/api/config'): lambda s, q, b: (APP.set_config(b), APP.public_config())[1],
    ('GET', '/api/vault/status'): lambda s, q, b: vault_status(s, s.vault_id),
    # The vault's structure: its types, statuses, priorities, lists… what the page builds itself from.
    ('GET', '/api/structure'): lambda s, q, b: s.structure.public(),
    # Each type's statuses in the three groups, with their colours (Settings → Item type status, TSK-037).
    ('GET', '/api/statuses'): lambda s, q, b: s.status_config(),
    ('POST', '/api/statuses'): lambda s, q, b: s.save_status_config({'types': b.get('types') or {}, 'colors': b.get('colors') or {}},
                                                                    b.get('remap')),
    # One of the structure's own actions on an item (Ticketing: promote a support ticket to an initiative, or
    # escalate it to a hotfix); a structure without it answers 404.
    ('POST', '/api/item/action'): lambda s, q, b: s.item_action(b.get('action'), b.get('key')),
    ('POST', '/api/vault/create-folders'): lambda s, q, b: {'check': s.create_missing_folders()},
    ('GET', '/api/items'): lambda s, q, b: {'items': s.items()},
    ('GET', '/api/files'): lambda s, q, b: s.files(),
    ('POST', '/api/files/mkdir'): lambda s, q, b: s.make_folder(b.get('path'), parents=bool(b.get('parents'))),
    ('GET', '/api/docs/roots'): lambda s, q, b: {'containers': s.docs_roots()},
    ('POST', '/api/docs/from-note'): lambda s, q, b: s.note_to_doc(b.get('key'), b.get('folder')),
    ('POST', '/api/docs/props'): lambda s, q, b: s.update_doc(b.get('path'), b.get('values') or {}, b.get('rev')),
    ('POST', '/api/files/rename'): lambda s, q, b: s.rename_path(b.get('path'), b.get('name')),
    ('POST', '/api/files/move'): lambda s, q, b: s.move_path(b.get('path'), b.get('to'), b.get('order')),
    ('POST', '/api/files/order'): lambda s, q, b: s.set_order(b.get('folder'), b.get('names')),
    ('POST', '/api/files/delete'): lambda s, q, b: s.delete_path(b.get('path')),
    ('POST', '/api/files/restore'): lambda s, q, b: s.restore_file(b.get('trashed')),
    ('POST', '/api/files/purge'): lambda s, q, b: s.purge_file(b.get('trashed')),
    ('GET', '/api/files/search'): lambda s, q, b: s.search_files(q.get('q')),
    ('GET', '/api/files/backlinks'): lambda s, q, b: s.backlinks(q.get('path')),
    ('POST', '/api/files/open-in-editor'): lambda s, q, b: open_in_editor(s, b.get('path')),
    ('POST', '/api/files/save'): lambda s, q, b: s.save_file(b.get('path'), b.get('text'), b.get('base_rev'), bool(b.get('force'))),
    ('POST', '/api/files/create'): lambda s, q, b: s.create_file(b.get('path'), b.get('text') or ''),
    ('POST', '/api/files/duplicate'): lambda s, q, b: s.duplicate_file(b.get('path')),
    ('POST', '/api/files/upload'): lambda s, q, b: s.upload_file(q.get('folder') or '', b['filename'], b['data']),
    ('GET', '/api/item'): lambda s, q, b: s.read(q['key']),
    ('POST', '/api/item/create'): lambda s, q, b: s.create(
        b['type'], b.get('subject'), b.get('values'), b.get('body') or ''),
    # A change from the page is the owner's (free to move a status anywhere); a script says "by": "agent" to go through
    # the structure's transitions and gates (tools/devflow.py, the /dev:* commands).
    ('POST', '/api/item/update'): lambda s, q, b: s.update(
        b['key'], b.get('values'), b.get('body'), b.get('base_rev'), b.get('base_body_rev'),
        by='agent' if b.get('by') == 'agent' else 'owner'),
    ('POST', '/api/item/delete'): lambda s, q, b: s.delete(b['key']),
    # Attachments (tm/attachments.py): add takes the file's bytes as the body, the item's key in the query.
    ('POST', '/api/attachments/add'): lambda s, q, b: s.add_attachment(q['key'], b['filename'], b['data']),
    ('POST', '/api/attachments/remove'): lambda s, q, b: s.remove_attachment(b['key'], b['path']),
    ('POST', '/api/attachments/restore'): lambda s, q, b: s.restore_attachment(b['key'], b['trashed'], b['path']),
    ('POST', '/api/item/restore'): lambda s, q, b: s.restore(b.get('trashed'), b.get('to')),
    ('GET', '/api/trash'): lambda s, q, b: {'entries': s.trash(), 'attachments': s.removed_attachments(), 'files': s.trashed_files()},
    ('POST', '/api/trash/restore'): lambda s, q, b: s.restore_trashed(b.get('trashed')),
    ('POST', '/api/trash/purge'): lambda s, q, b: s.purge(b.get('trashed')),
    ('POST', '/api/trash/empty'): lambda s, q, b: s.empty_trash(),
    ('POST', '/api/assign-ids'): lambda s, q, b: {'assigned': s.assign_missing_ids()},
    ('GET', '/api/board'): lambda s, q, b: s.board(),
    ('POST', '/api/board'): lambda s, q, b: s.save_board(b['lists']),
    ('GET', '/api/today'): lambda s, q, b: s.today_lists(),
    ('POST', '/api/today'): lambda s, q, b: s.save_today_lists(b.get('lists')),
    ('GET', '/api/pins'): lambda s, q, b: s.pins(),
    ('GET', '/api/people'): lambda s, q, b: s.people(),
    ('POST', '/api/people'): lambda s, q, b: s.add_person(b.get('name'), b.get('values')),
    ('POST', '/api/people/rename'): lambda s, q, b: s.rename_person(b.get('old'), b.get('new')),
    ('POST', '/api/people/delete'): lambda s, q, b: s.delete_person(b.get('name')),
    ('POST', '/api/people/update'): lambda s, q, b: s.update_person(b.get('name'), b.get('values')),
    ('GET', '/api/groups'): lambda s, q, b: s.groups(),
    ('POST', '/api/groups'): lambda s, q, b: s.add_group(b.get('name'), b.get('values')),
    ('POST', '/api/groups/update'): lambda s, q, b: s.update_group(b.get('name'), b.get('values')),
    ('POST', '/api/groups/delete'): lambda s, q, b: s.delete_group(b.get('name')),
    ('GET', '/api/labels'): lambda s, q, b: s.labels(),
    ('POST', '/api/labels'): lambda s, q, b: s.add_label(b.get('name')),
    ('POST', '/api/labels/rename'): lambda s, q, b: s.rename_label(b.get('old'), b.get('new')),
    ('POST', '/api/labels/delete'): lambda s, q, b: s.delete_label(b.get('name')),
    ('POST', '/api/pins'): lambda s, q, b: s.save_pins(b.get('items')),
    ('GET', '/api/sidebar'): lambda s, q, b: s.sidebar_order(),
    ('POST', '/api/sidebar'): lambda s, q, b: s.save_sidebar_order(b.get('items')),
    ('GET', '/api/worklog'): lambda s, q, b: {'entries': s.worklog(q.get('from'), q.get('to'))},
    ('POST', '/api/worklog'): lambda s, q, b: s.log_work(
        b['id'], b['kind'], b.get('note') or '', b.get('date'), APP.config['work_kinds'], b.get('time')),
    ('POST', '/api/worklog/update'): lambda s, q, b: s.update_log(
        b['date'], int(b['index']), {k: b[k] for k in ('kind', 'time', 'note', 'new_date') if k in b}, APP.config['work_kinds']),
    ('POST', '/api/item/claude/preview'): lambda s, q, b: claude_preview(s, b.get('key'), b.get('instruction') or '', b.get('model'), b.get('effort'), b.get('cwd')),
    ('POST', '/api/item/claude'): lambda s, q, b: launch_claude(s, b.get('key'), b.get('instruction') or '', b.get('model'), b.get('effort'), b.get('cwd'),
                                                                b.get('target') or 'terminal'),
    ('GET', '/api/claude/sessions'): lambda s, q, b: s.global_claude_sessions(),
    # When each conversation was last written (its transcript in ~/.claude), for the sessions tables; null = never saved.
    ('POST', '/api/claude/updated'): lambda s, q, b: {'updated': {str(s.get('id')): session_updated(s.get('id'), s.get('cwd'))
                                                               for s in (b.get('sessions') or [])[:500] if isinstance(s, dict)}},
    ('POST', '/api/claude/resume'): lambda s, q, b: resume_claude(s, b.get('key'), b.get('session_id'), b.get('target') or 'terminal'),
    ('POST', '/api/claude/forget'): lambda s, q, b: forget_claude_session(s, b.get('key'), int(b.get('index', -1))),
    ('GET', '/api/term/list'): lambda s, q, b: {'terms': TERMS.list()},
    ('POST', '/api/term/open'): lambda s, q, b: open_term(s, b.get('key'), b.get('instruction') or '', b.get('model'), b.get('effort'),
                                                       b.get('cwd'), b.get('cols'), b.get('rows')),
    ('POST', '/api/term/resume'): lambda s, q, b: resume_term(s, b.get('key'), b.get('session_id'), b.get('cols'), b.get('rows')),
    ('POST', '/api/term/input'): lambda s, q, b: term_input(b.get('id'), b.get('data')),
    ('POST', '/api/term/resize'): lambda s, q, b: term_resize(b.get('id'), b.get('cols'), b.get('rows')),
    ('POST', '/api/term/close'): lambda s, q, b: TERMS.close(b.get('id')),
    ('POST', '/api/item/comment'): lambda s, q, b: s.add_comment(b.get('key'), b.get('text')),
    ('POST', '/api/item/comment/delete'): lambda s, q, b: s.delete_comment(b.get('key'), int(b.get('index', -1))),
    ('POST', '/api/item/convert'): lambda s, q, b: s.convert(b.get('key'), b.get('type'), b.get('values')),
    ('POST', '/api/open'): lambda s, q, b: open_local(b.get('path')),
    ('GET', '/api/server'): lambda s, q, b: server_status(),
    ('POST', '/api/server/stop'): lambda s, q, b: stop_server(),
    ('GET', '/api/exports'): lambda s, q, b: exports_listing(),
    ('POST', '/api/exports'): lambda s, q, b: export_version(s, b.get('note'), b.get('kind')),
    ('POST', '/api/exports/delete'): lambda s, q, b: export.delete(source_dir(), b.get('name')),
    ('POST', '/api/exports/reveal'): lambda s, q, b: open_local(export.path_of(source_dir(), b.get('name'))),
    ('POST', '/api/worklog/delete'): lambda s, q, b: s.unlog_work(b['date'], int(b['index'])),
    ('GET', '/api/guide'): lambda s, q, b: user_guide(),
}
# The routes whose body is a file's bytes, not JSON.
UPLOAD_ROUTES = {('POST', '/api/attachments/add'), ('POST', '/api/files/upload')}
# The routes that are not about one vault: they get no store and need no X-TM-Vault. Everything else does.
GLOBAL_ROUTES = {
    ('GET', '/api/config'), ('POST', '/api/config'),
    ('GET', '/api/term/list'), ('POST', '/api/term/input'), ('POST', '/api/term/resize'), ('POST', '/api/term/close'),
    ('POST', '/api/claude/updated'), ('POST', '/api/open'), ('GET', '/api/server'), ('POST', '/api/server/stop'),
    ('GET', '/api/exports'), ('POST', '/api/exports/delete'), ('POST', '/api/exports/reveal'), ('GET', '/api/guide'),
}


def user_guide():
    """docs/user-guide.md as Markdown, for Settings → Documentation (the page renders and sanitizes it)."""
    try:
        with open(GUIDE_PATH, encoding='utf-8') as f:
            return {'markdown': f.read()}
    except OSError:
        raise StoreError(404, 'the user guide (docs/user-guide.md) is missing from this copy of the app')


def main():
    for v in APP.config['vaults']:  # each vault that matches its structure gets its one-off upgrades
        if os.path.isdir(resolve_root(v['path'])):
            App.migrate(APP.store_for(v['id']))
    port = int(os.environ.get('TM_PORT') or APP.config.get('port') or 3100)
    listeners = activated_sockets()  # the installed app, started by launchd on its first connection
    try:
        if listeners:
            server = ThreadingHTTPServer(('127.0.0.1', port), Handler, bind_and_activate=False)
            server.socket.close()
            server.socket = listeners[0]  # launchd's own, already listening
            server.server_address = server.socket.getsockname()[:2]
            port = server.server_address[1]
        else:
            server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    except OSError as e:
        if e.errno != errno.EADDRINUSE:
            raise
        # Another copy already serves there (the app's own, from its LaunchAgent: tools/install_app.py; or one started
        # by hand): say so, rather than a traceback.
        sys.exit(f'Port {port} is taken: another Task Manager (or another program) is already serving at '
                 f'http://127.0.0.1:{port}. Open that one, or start this one with TM_PORT=<another port>.')
    vaults = ', '.join(f"{v['name']}: {resolve_root(v['path'])}" for v in APP.config['vaults'])
    print(f'Local Task Manager → http://127.0.0.1:{port}  (vaults — {vaults})', flush=True)

    def stop(*_):
        # launchctl stops the app's LaunchAgent with SIGTERM: the terminals it runs end with it, as they do on Ctrl-C.
        TERMS.close_all()
        print('\nbye', flush=True)
        os._exit(0)
    signal.signal(signal.SIGTERM, stop)
    SERVER.update(on_demand=bool(listeners), started_at=time.time(), port=port, stop=stop)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        stop()


if __name__ == '__main__':
    main()
