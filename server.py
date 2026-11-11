#!/usr/bin/env python3
"""Local Task Manager — local server (Python 3 stdlib only).

    python3 server.py            # http://127.0.0.1:3100

Config lives in config.json next to this file (created from the Settings screen;
see config.example.json). Without it, the bundled sample-vault/ (a Projects vault) is used.
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

from tm import agentfiles, agentlinks, agentruns, agentsmd, attachments, commands, export, journal, runchanges, runworktree, schedules
from tm.launchd import activated_sockets
from tm.fsutil import atomic_write
from tm.launch import (CLAUDE_EFFORTS, CLAUDE_MODELS, claude_flags, claude_script, claude_theme, desktop_new_url, desktop_resume_flags,
                       ide_open_url, recent_sessions, resume_flags, session_facts, session_flags, session_folders, session_updated,
                       transcript_path)
from tm.chat import CHAT_MODES, Chat, Chats, chat_flags, session_files
from tm.pty import MAX_COLS, MAX_ROWS, MIN_COLS, MIN_ROWS, Terms, dim
from tm.transcript import history as transcript_history
from tm.store import (ACTIVITY_SOURCES, DEFAULT_FOLDERS, DEFAULT_WORK_KINDS, ITEM_TYPES, PARENT_TYPES, PRIORITIES,
                      META_DIR, STATUSES, Store, StoreError, clean_instruction, now_stamp)
from tm.structures import DEFAULT_STRUCTURE, LEGACY_STRUCTURES, REGISTRY, STRUCTURES, UNNAMED_STRUCTURE

APP_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(APP_DIR, 'static')
CONFIG_PATH = os.path.join(APP_DIR, 'config.json')
# The user guide Settings → Documentation shows: what the app gives you and how to use it (also read on GitHub).
GUIDE_PATH = os.path.join(APP_DIR, 'docs', 'user-guide.md')
# What the app and its tools set aside before overwriting something (a config, a vault): one folder next to config.json,
# apart from versions/ (the exports). Never versioned, never exported.
BACKUPS_DIR = 'backups'
# The runs of the Agents section (tm/agentruns.py): one list for this computer, next to config.json. Never versioned, never exported.
AGENT_RUNS = 'agent-runs.json'


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
    # The folders the Agents section reads commands from (.claude/commands/**/*.md; absolute, existing), and their
    # public names. Its own closed list, apart from claude_paths: the browser names one by its id, never by a path.
    'agent_dirs': [],
    'agent_dir_names': {},
    # The vaults this app can show: [{id, name, path, structure, folders}]. `root` and `folders` above are kept
    # equal to the default vault's, for the tools in tools/ and for a config written before there were vaults.
    'vaults': [],
    'default_vault': '',
}
TERMINALS = ('Terminal', 'iTerm')
# The apps the Explorer may open a vault file in (`open -a`): a closed list, so a config can never name a program.
EDITORS = ('Cursor', 'Visual Studio Code', 'Zed', 'Sublime Text', 'BBEdit', 'TextEdit')
# A JSON request's body: the largest is a chat message with its images (tm/chat.py IMAGES_MAX × IMAGE_MAX).
JSON_MAX = 32 * 1024 * 1024
VAULT_HEADER = 'X-TM-Vault'
ACTOR_HEADER = 'X-TM-Actor'  # who makes a request, for the activity journal: `app` (the page), `claude:<session>`…
VAULT_ID_RE = re.compile(r'^[a-z0-9][a-z0-9-]{0,31}$')


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    own = {}
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, encoding='utf-8') as f:
            own = json.load(f)
        cfg.update(own)
    cfg['folders'] = {**DEFAULT_FOLDERS, **cfg.get('folders', {})}
    cfg['claude_paths'] = clean_paths(cfg.get('claude_paths'), cfg.get('claude_cwd'))
    cfg['claude_path_names'] = clean_names(cfg.get('claude_path_names'), cfg['claude_paths'])
    cfg['agent_dirs'] = clean_paths(cfg.get('agent_dirs'))
    cfg['agent_dir_names'] = clean_names(cfg.get('agent_dir_names'), cfg['agent_dirs'])
    # A config from before there were vaults: its root becomes the one vault, in memory only. The file is
    # left as it is until the next save from Settings (which keeps a copy of it first). A root it names was an
    # Initiatives vault then; with no config at all, the root is the bundled sample, a Projects vault.
    if not isinstance(cfg.get('vaults'), list) or not cfg['vaults']:
        sid = UNNAMED_STRUCTURE if own.get('root') else DEFAULT_STRUCTURE
        cfg['vaults'] = [{'id': sid, 'name': STRUCTURES[sid]['label'], 'path': cfg['root'],
                          'structure': sid, 'folders': cfg['folders']}]
    # A vault saved before there were structures to pick names none: it was an Initiatives one.
    cfg['vaults'] = [{**v, 'structure': v.get('structure') or UNNAMED_STRUCTURE} for v in cfg['vaults'] if isinstance(v, dict)]
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


def _is_empty(path):
    """Whether the folder has nothing but hidden files in it. One that cannot be read is not (the vault check says why:
    a permission, a missing folder), so it is never refused as empty."""
    try:
        return not any(not n.startswith('.') for n in os.listdir(resolve_root(path)))
    except OSError:
        return False


def _same_or_inside(a, b):
    return a == b or a.startswith(b.rstrip(os.sep) + os.sep)


def _slug(text):
    out = re.sub(r'[^a-z0-9]+', '-', str(text or '').lower()).strip('-')[:32].strip('-')
    return out or 'vault'


def clean_vaults(vaults, default_vault, saved=None):
    """The vault list from Settings, checked: ids kept (a new vault gets one from its name, once, and it never
    changes), a name, an existing folder that is not / nor the home folder, a known structure, and no vault
    inside another (the outer one would read the inner one's files as its own). → (vaults, default_vault).
    `saved` (vault id → its resolved folder, as saved now): a vault kept at that folder may have lost it — moved or
    deleted outside the app — and still be saved: only a new vault, or a new folder, must exist. Otherwise a vault gone
    would refuse every save of Settings, even one about something else (an agent folder)."""
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
        if not os.path.isdir(real) and (saved or {}).get(vid) != real:
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
                AGENTS_REFRESH.poke(self.stores[vault_id])  # the app may have moved, or its structure changed, since
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
        # A saved vault sent without its structure keeps the one it has (the default is only a new vault's).
        saved = {v['id']: v['structure'] for v in self.config['vaults']}
        cfg['vaults'] = [{**v, 'structure': v.get('structure') or saved.get(v.get('id'))} if isinstance(v, dict) else v
                         for v in cfg['vaults']]
        cfg['vaults'], cfg['default_vault'] = clean_vaults(cfg['vaults'], cfg.get('default_vault'),
                                                           {v['id']: resolve_root(v['path']) for v in self.config['vaults']})
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
        cfg['agent_dirs'] = clean_paths(cfg.get('agent_dirs'))
        cfg['agent_dir_names'] = clean_names(cfg.get('agent_dir_names'), cfg['agent_dirs'])
        for folder in [*cfg['claude_paths'], *cfg['agent_dirs']]:
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
            if v['structure'] in LEGACY_STRUCTURES and not was and _is_empty(v['path']):
                # A legacy structure opens a folder that already is one of its vaults (to use it, or to move it with
                # docs/migrate-structures.md); an empty folder starts a vault of the current structure.
                raise StoreError(400, f'"{v["name"]}": a new vault starts as {REGISTRY[DEFAULT_STRUCTURE].label}. '
                                      f'{REGISTRY[v["structure"]].label} is a legacy structure, kept only for a folder that already is one of its vaults')

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
        return {**self.config, 'root_resolved': self.store.root,
                # each vault, and whether its folder is gone (Settings → Vaults says so; it can still be saved, or removed)
                'vaults': [{**v, 'missing': not os.path.isdir(resolve_root(v['path']))} for v in self.config['vaults']],
                'structures': {k: v['label'] for k, v in STRUCTURES.items()},
                # the ones only an existing vault keeps (Settings offers a new vault the default one)
                'legacy_structures': list(LEGACY_STRUCTURES), 'default_structure': DEFAULT_STRUCTURE,
                # what each structure lets a vault turn on and off (Settings → Vaults)
                'structure_types': {k: s.type_choices() for k, s in REGISTRY.items()},
                'statuses': STATUSES, 'item_types': list(ITEM_TYPES),
                'priorities': PRIORITIES, 'parent_types': PARENT_TYPES, 'activity_sources': ACTIVITY_SOURCES,
                'editors': list(EDITORS),  # what Settings offers for the Explorer's "Open in <editor>"
                'claude_targets': open_targets(),  # where a Claude session can open: Open in ▾ (claude.js)
                'can_pick_folder': sys.platform == 'darwin',  # a folder field's Choose… (folderpick.js)
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
        if length > JSON_MAX:
            self.close_connection = True  # the body stays unread: this connection cannot carry another request
            raise StoreError(413, f'a request is at most {JSON_MAX // (1024 * 1024)} MB')
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
            if route == ('GET', '/api/chat/stream'):
                return self.stream_chat(q)
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
            store = self.vault_store(route)
            if method != 'POST' or store is None:
                return self.send_json(handler(store, q, body))
            before = journal_before(store, url.path, body)
            result = handler(store, q, body)
            journal_after(store, self.headers.get(ACTOR_HEADER), url.path, body, before, result)
            AGENTS_REFRESH.poke(store)
            return self.send_json(result)
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

    # ── the dock's chats: one Server-Sent Events stream per chat shown ──
    def stream_chat(self, q):
        """`snapshot` (the conversation so far and the chat's state), then one `msg` per message, then `exit`."""
        chat = CHATS.get(q.get('id'))
        snapshot, sub = chat.subscribe()
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()

        def event(name, payload):
            self.wfile.write(f'event: {name}\ndata: {json.dumps(payload)}\n\n'.encode('utf-8'))
            self.wfile.flush()
        try:
            event('snapshot', {'events': snapshot, 'info': chat.info()})
            while True:
                try:
                    msg = sub.get(timeout=15)
                except queue.Empty:
                    self.wfile.write(b': ping\n\n')
                    self.wfile.flush()
                    continue
                if msg is None:
                    event('exit', {'exit_code': chat.exit_code})
                    break
                event('msg', msg)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass  # the tab went away
        finally:
            chat.unsubscribe(sub)

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


# ── the activity journal (tm/journal.py): what a request did, written after it went well ──
def journal_before(store, path, body):
    """The item a request is about, as it is before it runs (to say what changed, or what was deleted); None when
    the route names none or it cannot be read. Never in the way of the request."""
    key = (body or {}).get(journal.BEFORE_KEY.get(path, ''))
    if not key:
        return None
    try:
        return store.read(key)
    except (StoreError, OSError, ValueError):
        return None


def journal_after(store, actor, path, body, before, result):
    """Add what the request did to the day's journal (tm/journal.py), by who made it. A journal that cannot be
    written is reported here and never fails the request."""
    try:
        journal.record(os.path.join(store.root, META_DIR), journal.actor_of(actor), journal.describe(path, body, before, result))
    except Exception:  # noqa: BLE001 — the change is made; only its line in the journal is lost
        traceback.print_exc()


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


# ── a folder chosen in macOS's own dialog (Settings → Vaults, Claude and Agents folders; the Agents "Add folder") ──
# A page cannot learn a folder's absolute path (a browser's folder picker gives names, never where they are), so the
# server opens the dialog itself and answers the path. The prompt and the starting folder go in as argv, never
# inside the script; app.activate() brings the dialog in front of the browser.
_PICK_FOLDER_JXA = """function run(argv) {
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  app.activate();
  const opts = {withPrompt: argv[0]};
  if (argv[1]) opts.defaultLocation = Path(argv[1]);
  try { return app.chooseFolder(opts).toString(); }
  catch (e) { if (e.errorNumber === -128) return ''; throw e; }
}"""
PICK_FOLDER_TIMEOUT = 600  # s: a dialog left open this long is given up (answered as cancelled)
_pick_folder_lock = threading.Lock()  # one dialog at a time: a second click while one is open is refused


def pick_folder(start='', prompt=''):
    """macOS's folder dialog, starting at `start` (or its nearest existing parent, else the home folder):
    {path} of the folder chosen, or {cancelled: True}. Only on macOS (`can_pick_folder` in the config)."""
    if sys.platform != 'darwin':
        raise StoreError(501, 'choosing a folder needs macOS: type its path instead')
    home = os.path.expanduser('~')
    where = os.path.expanduser(str(start or '').strip())
    while where and not os.path.isdir(where):
        parent = os.path.dirname(where)
        where = '' if parent == where else parent
    if not where or not os.path.isabs(where):
        where = home
    prompt = ' '.join(str(prompt or '').split())[:120] or 'Choose a folder'
    if not _pick_folder_lock.acquire(blocking=False):
        raise StoreError(409, 'a folder dialog is already open: look for it behind this window')
    try:
        out = subprocess.run(['osascript', '-l', 'JavaScript', '-e', _PICK_FOLDER_JXA, prompt, where],
                             capture_output=True, text=True, timeout=PICK_FOLDER_TIMEOUT)
    except subprocess.TimeoutExpired:
        return {'cancelled': True}
    finally:
        _pick_folder_lock.release()
    if out.returncode != 0:
        raise StoreError(500, f'the folder dialog failed: {out.stderr.strip() or out.returncode}')
    path = out.stdout.strip()
    path = path.rstrip('/') or path  # "/" stays "/"
    return {'path': path} if path else {'cancelled': True}


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


# ── a vault file opened in its own app (views/files.js: "Open in <App>" for what the page cannot show) ──────────────
# open_local never runs `open <file>`: macOS hands it to whatever app claims it, and for a .command or a .app that app
# runs it. Here the app is looked up first (default_app), checked (opener_policy) and then named to open it with
# (`open -a <that app> <file>`): what was checked is what runs, and the page shows its name before the click.

# Asks Launch Services which app opens a file — the path comes in as argv, never inside the script.
_OPENER_JXA = """ObjC.import('AppKit');
function run(argv) {
  const app = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.fileURLWithPath(argv[0]));
  if (!app || app.isNil()) return '';
  const id = $.NSBundle.bundleWithURL(app).bundleIdentifier;
  const name = $.NSFileManager.defaultManager.displayNameAtPath(app.path).js.replace(/\\.app$/, '');
  return [app.path.js, id && !id.isNil() ? id.js : '', name].join('\\n');
}"""
_opener_cache = {}  # extension → the app (or None): Launch Services decides by type, and asking costs ~0.2 s

# Apps that run what they open rather than show it: a file they would open is only revealed in Finder.
LAUNCHERS = {
    'com.apple.Terminal', 'com.googlecode.iterm2', 'dev.warp.Warp-Stable', 'net.kovidgoyal.kitty', 'com.github.wez.wezterm',
    'com.apple.ScriptEditor2', 'com.apple.Automator', 'com.apple.Automator.Automator-Application-Stub', 'com.apple.shortcuts',
    'com.apple.installer', 'com.apple.systempreferences', 'com.apple.systemevents', 'com.apple.ScriptMenuApp',
    'org.python.PythonLauncher', 'com.apple.JarLauncher', 'com.apple.Ticket-Viewer', 'com.apple.archiveutility.auto',
}
# Shortcuts: what they hold is an address of something else — a .fileloc may point at an .app (Finder would launch it),
# a URL may carry a scheme that starts an app — so whatever app opens them, it would open what the page never saw.
# Archives (.zip, .dmg) are not here: unpacking or mounting runs nothing on macOS.
SHORTCUTS = {'.fileloc', '.inetloc', '.webloc', '.url', '.desktop'}


def default_app(full):
    """The app macOS opens `full` with: {path, id, name} (`name` as Finder shows it, in the Mac's language), or None
    when no app claims it. Cached by extension; a file without one is asked each time."""
    ext = os.path.splitext(full)[1].lower()
    if ext and ext in _opener_cache:
        return _opener_cache[ext]
    try:
        out = subprocess.run(['osascript', '-l', 'JavaScript', '-e', _OPENER_JXA, full],
                             capture_output=True, text=True, timeout=10, check=True).stdout.strip()
    except (subprocess.SubprocessError, OSError):
        return None
    parts = out.split('\n')
    app = {'path': parts[0], 'id': parts[1], 'name': parts[2]} if len(parts) == 3 and parts[0] else None
    if ext:
        _opener_cache[ext] = app
    return app


def opener_policy(full, app):
    """None when `full` may be opened with `app` ({path, id, name}, from default_app); else why not, as the page says it
    (it offers Show in Finder instead). The file's own bits come first: what is executable, or not a plain file (a
    .app is a folder), is never handed to an app. Then the app: one that runs what it opens (LAUNCHERS) is refused.
    Last, a shortcut (SHORTCUTS), whatever app opens it: it would open what it points at."""
    if not os.path.isfile(full) or os.path.islink(full):
        return 'only a plain file opens in its app'
    if os.access(full, os.X_OK):
        return 'it is executable: opening it could run it'
    if not app:
        return 'no app on this Mac opens this kind of file'
    if app['id'] in LAUNCHERS:
        return f'{app["name"]} would run it rather than show it'
    if os.path.splitext(full)[1].lower() in SHORTCUTS:
        return 'it is a shortcut to something else: open what it points at instead'
    return None


def file_opener(store, path):
    """What "Open in <App>" offers for a vault file: {app, ok, why?} — `app` the name of the app that opens it (None
    without one), `ok` whether the app will open it here."""
    full = _vault_file_for_app(store, path)
    app = default_app(full)
    why = opener_policy(full, app)
    return {'app': app and app['name'], 'ok': why is None, **({'why': why} if why else {})}


def open_default(store, path):
    """A vault file opened in the app macOS opens it with, after opener_policy: `open -a <that app> <file>`, so the
    app checked is the app that opens it. → {opened, app}."""
    full = _vault_file_for_app(store, path)
    app = default_app(full)
    why = opener_policy(full, app)
    if why:
        raise StoreError(409, f'Not opened: {why}. Show it in Finder instead.')
    try:
        subprocess.run(['open', '-a', app['path'], full], check=True, timeout=10, capture_output=True)
    except subprocess.CalledProcessError:
        raise StoreError(400, f'{app["name"]} could not open it') from None
    return {'opened': store.rel(full).replace(os.sep, '/'), 'app': app['name']}


def _vault_file_for_app(store, path):
    if sys.platform != 'darwin':
        raise StoreError(501, 'opening a file in its app needs macOS')
    rel = store._rel_path(path)
    full = store.abs(rel)
    if not os.path.lexists(full):
        raise StoreError(404, f'no such file: {rel}')
    return full


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


def _launch_plan(store, key, instruction, model, effort, cwd, empty=False):
    """Everything a new launch needs, before anything runs: the preview (prompt, folder, flags), the item, a fresh
    session id, the flags that carry it, and the entry to record. Shared by Terminal.app and the embedded terminal.
    `empty`: the dock's "+", a session that starts with nothing sent (prompt None) and waits for the first message."""
    if empty:
        instruction = ''
    info = claude_preview(store, key, instruction, model, effort, cwd)
    if empty:
        info['prompt'] = None
    elif not key and not info['prompt']:
        raise StoreError(400, 'a prompt is needed when no item is given')
    item = store.read(key) if key else None
    session_id = str(uuid.uuid4())
    name = (f"{item.get('ref') or item['id'] or item['type']} · {item['title']}" if item
            else info['prompt'].split('\n', 1)[0] if info['prompt'] else UNTITLED)
    flags = [*info['flags'], *session_flags(session_id, name)]
    entry = {'id': session_id, 'at': now_stamp(), 'cwd': info['cwd'], 'instruction': (instruction or '').strip(),
             'model': info['model'], 'effort': info['effort']}
    return info, item, session_id, flags, entry, name


UNTITLED = 'New chat'  # the name of a session started empty, until its first message names it


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
    try:
        found = store.claude_session(key or None, session_id)
    except StoreError:
        found = None if key else agentruns.find(runs_path(), session_id)  # a run of the Agents section: no vault's
        if not found:
            raise
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
    if target == 'desktop' and ((live and live.alive) or CHATS.live(found['id'])):
        raise StoreError(409, 'this session is still running in the dock: close it there first, then open it in Claude Desktop')
    return {**_open_elsewhere(target, found['cwd'], session=found['id']), 'session_id': found['id']}


# ── the embedded terminal: claude in a pty inside this server, shown by xterm.js in the dock ──
TERMS = Terms()


def _spawn_term(term_id, flags, cwd, cols, rows, label, prompt=None):
    if CHATS.live(term_id):  # the same session as a chat: it hands over (one driver at a time)
        CHATS.close(term_id)
    argv = [*shlex.split(APP.config['claude_command']), *flags, *([prompt] if prompt is not None else [])]
    env = {**os.environ, 'TERM': 'xterm-256color', 'COLORTERM': 'truecolor'}
    env.setdefault('LANG', 'en_US.UTF-8')
    return TERMS.open(term_id, argv, cwd, dim(cols, 100, MIN_COLS, MAX_COLS), dim(rows, 30, MIN_ROWS, MAX_ROWS), env, label)


def open_term(store, key, instruction='', model=None, effort=None, cwd=None, cols=None, rows=None, empty=False):
    """Like launch_claude, but in the dock: the same session id, flags, folder and record; the prompt is an argument
    of the process (no shell, no file), so quotes, `$(…)` or backticks in a description are just text."""
    info, item, session_id, flags, entry, name = _launch_plan(store, key, instruction, model, effort, cwd, empty)
    term = _spawn_term(session_id, flags, info['cwd'], cols, rows, name, info['prompt'])
    term.key, term.vault = (item['key'] if item else None), getattr(store, 'vault_id', None)
    return _record(store, {'term': term.info(), 'cwd': info['cwd'], 'command': _command_line(flags)}, item, entry)


def resume_term(store, key, session_id, cols=None, rows=None):
    """Reopen a recorded conversation in the dock. If that session is already running there, it is handed back."""
    found, flags = _resume_plan(store, key, session_id)
    label = found.get('instruction') or 'Claude'
    if key:
        it = store.find(key)
        label = f"{it.get('ref') or it['id'] or it['type']} · {it['title']}"
    term = _spawn_term(found['id'], flags, found['cwd'], cols, rows, label)
    term.key, term.vault = key or None, getattr(store, 'vault_id', None)
    return {'term': term.info(), 'cwd': found['cwd'], 'session_id': found['id']}


def term_input(term_id, data):
    TERMS.get(term_id).write(str(data or '').encode('utf-8'))
    return {'ok': True}


def term_resize(term_id, cols, rows):
    term = TERMS.get(term_id)
    term.resize(dim(cols, term.cols, MIN_COLS, MAX_COLS), dim(rows, term.rows, MIN_ROWS, MAX_ROWS))
    return {'cols': term.cols, 'rows': term.rows}


# ── the dock's chats: claude -p in stream-json inside this server (tm/chat.py), the same sessions as the terminal ──
CHATS = Chats()


def _spawn_chat(session_id, flags, cwd, label, key, mode, model='', prompt=None, history=(), effort=''):
    try:
        argv = [*shlex.split(APP.config['claude_command']), *chat_flags(mode), *flags]
    except ValueError as e:
        raise StoreError(400, str(e))
    if TERMS.live(session_id):  # the same session in a terminal: it hands over
        TERMS.close(session_id)
    chat = CHATS.open(session_id, argv, cwd, dict(os.environ), label, key, mode or 'default', model, prompt, history, effort)
    chat.on_settings = lambda model, effort: _record_settings(chat, model, effort)
    return chat


def _record_settings(chat, model, effort):
    """A chat's model or effort, changed from its composer and confirmed by claude, onto its record — in the vault
    and on the item it belongs to now (both read at the time: a change of item moves the record). Not on record
    (a vault since removed, an entry forgotten): nothing to keep."""
    if not chat.vault:
        return
    try:
        APP.store_for(chat.vault).set_claude_session_settings(chat.key, chat.id, model, effort)
    except StoreError:
        pass


def open_chat(store, key, instruction='', model=None, effort=None, cwd=None, mode='', empty=False):
    """Like open_term, but as a chat: the same session id, flags, folder and record; the prompt goes in as the first
    message on stdin. `empty`: nothing goes in; the first message the user sends names it (chat_send)."""
    info, item, session_id, flags, entry, name = _launch_plan(store, key, instruction, model, effort, cwd, empty)
    chat = _spawn_chat(session_id, flags, info['cwd'], name, item['key'] if item else None, mode, info['model'], info['prompt'],
                       effort=info['effort'])
    chat.vault = getattr(store, 'vault_id', None)
    chat.untitled = bool(empty)
    return _record(store, {'chat': chat.info(), 'cwd': info['cwd'], 'command': _command_line([*chat_flags(mode), *flags])}, item, entry)


def resume_chat(store, key, session_id, mode=''):
    """A recorded conversation, reopened as a chat with what was said before. A live one is handed back as it is."""
    found, flags = _resume_plan(store, key, session_id)
    live = CHATS.live(found['id'])
    if live:
        return {'chat': live.info(), 'cwd': found['cwd'], 'session_id': found['id']}
    label = found.get('instruction') or (agent_message(found['cmd'], found.get('args')) if found.get('cmd') else 'Claude')
    if key:
        it = store.find(key)
        label = f"{it.get('ref') or it['id'] or it['type']} · {it['title']}"
    if TERMS.live(found['id']):  # close it first, so its transcript is complete before it is read
        TERMS.close(found['id'])
    past = transcript_history(transcript_path(found['id'], found['cwd']))
    chat = _spawn_chat(found['id'], flags, found['cwd'], label, key or None, mode, found.get('model') or '', history=past,
                       effort=found.get('effort') or '')
    chat.vault = getattr(store, 'vault_id', None)
    if found.get('cmd'):  # an agent run, resumed: its new turns keep its record up to date
        _watch_run(chat, found['id'])
    return {'chat': chat.info(), 'cwd': found['cwd'], 'session_id': found['id']}


# ── Agents: the commands of the folders in Settings → Agents, run as a chat in the folder they come from ──
AGENT_ARGS_MAX = 4000  # characters of a run's arguments: one line of text after the command, never a shell


def agent_dirs():
    """The agent folders of Settings, each with its id, public name and whether it is still there."""
    names = APP.config.get('agent_dir_names', {})
    return [{'id': commands.dir_id(p), 'path': p, 'name': names.get(p) or os.path.basename(p) or p, 'exists': os.path.isdir(p)}
            for p in APP.config.get('agent_dirs', [])]


def agent_dir(dir_id):
    """The agent folder whose id is `dir_id`: only one of Settings' list (the browser never sends a path)."""
    found = next((d for d in agent_dirs() if d['id'] == str(dir_id or '')), None)
    if not found:
        raise StoreError(404, 'no such agent folder: add it in Settings → Agents')
    if not found['exists']:
        raise StoreError(409, f"that folder no longer exists: {found['path']}")
    return found


def list_agents():
    """Every agent folder with its commands (none for a folder that is gone: it is still listed, to be removed), and
    whether it is in a git repository (`git`: its runs can have a worktree of their own)."""
    return {'dirs': [{**d, 'commands': commands.scan(d['path']) if d['exists'] else [],
                      'git': bool(d['exists'] and runworktree.toplevel(d['path']))} for d in agent_dirs()]}


def agent_command(dir_id, name):
    """One command for its page: its fields and its body (the prompt)."""
    folder = agent_dir(dir_id)
    found = commands.read(folder['path'], name)
    if not found:
        raise StoreError(404, f'{folder["name"]} has no command /{name}')
    return {'dir': folder, 'command': found}


def agent_related(dir_id, name):
    """What an agent works with, for its page's tabs: the skills, subagents and commands of its folder its prompt names
    (and theirs, one step on), and the folder's files it points at (tm/agentlinks.py)."""
    folder = agent_dir(dir_id)
    found = agentlinks.related(folder['path'], name)
    if found is None:
        raise StoreError(404, f'{folder["name"]} has no command /{name}')
    return found


def agent_file(dir_id, name, path=''):
    """An agent's own file (no `path`) or one it works with, whole, for Source and Edit on its page (tm/agentfiles.py)."""
    folder = agent_dir(dir_id)
    found = agentfiles.read(folder['path'], name, str(path or ''))
    if found is None:
        raise StoreError(404, f'/{name} has no file {path}' if path else f'{folder["name"]} has no command /{name}')
    return found


def agent_file_save(dir_id, name, path, text, rev):
    """Edit's save of one of those: refused (409) when it changed on disk since it was read at `rev`."""
    folder = agent_dir(dir_id)
    found = agentfiles.save(folder['path'], name, str(path or ''), text, str(rev or ''))
    if found is None:
        raise StoreError(404, f'/{name} has no file {path}' if path else f'{folder["name"]} has no command /{name}')
    return found


def agent_message(name, args=''):
    """What a run sends as its first message: `/<name> <args>`, the way it is typed in Claude Code. Claude loads the
    command itself (its body, `$ARGUMENTS`, its allowed-tools); the arguments are text in a message, on one line."""
    args = ' '.join(str(args or '').split())
    if len(args) > AGENT_ARGS_MAX:
        raise StoreError(400, f'the arguments are too long (at most {AGENT_ARGS_MAX} characters)')
    return f'/{name} {args}'.rstrip()


def runs_path():
    return os.path.join(os.path.dirname(CONFIG_PATH), AGENT_RUNS)


AGENT_WHERE = ('here', 'worktree')  # a run starts in the agent's folder, or in a new worktree of it (tm/runworktree.py)


def _agent_plan(dir_id, name, args, mode, model, effort, where='here'):
    """What a run needs before anything starts: the folder and the command (looked up here, never taken from the
    request), the message, a fresh session id, the flags, and the entry for the list of runs (agentruns). With
    where='worktree', a new worktree of the folder is made last, once everything else is known to be right, and the
    run starts there."""
    folder = agent_dir(dir_id)
    found = commands.find(folder['path'], name)
    if not found:
        raise StoreError(404, f'{folder["name"]} has no command /{name}')
    where = (where or 'here').strip()
    if where not in AGENT_WHERE:
        raise StoreError(400, f"where must be one of {', '.join(AGENT_WHERE)}")
    mode = (mode or '').strip()
    if mode and mode not in CHAT_MODES:
        raise StoreError(400, f"mode must be one of {', '.join(CHAT_MODES)}")
    model = ((APP.config.get('claude_model') if model is None else model) or '').strip()
    effort = ((APP.config.get('claude_effort') if effort is None else effort) or '').strip()
    try:
        flags = claude_flags(model, effort)
    except ValueError as e:
        raise StoreError(400, str(e))
    prompt = agent_message(name, args)
    session_id = str(uuid.uuid4())
    cwd = os.path.realpath(folder['path'])
    entry = {'id': session_id, 'at': now_stamp(), 'cwd': cwd, 'dir': folder['id'], 'cmd': name, 'args': ' '.join(str(args or '').split()),
             'mode': mode or 'default', 'model': model, 'effort': effort}
    if where == 'worktree':
        try:
            wt = runworktree.create(folder['path'], found, name)
        except runworktree.WorktreeError as e:
            raise StoreError(409, str(e))
        cwd = entry['cwd'] = wt['cwd']
        entry.update(worktree=wt['worktree'], branch=wt['branch'])
    return prompt, cwd, [*flags, *session_flags(session_id, prompt)], entry


def _drop_worktree(entry):
    """A run that could not start after its worktree was made: the worktree goes (its branch, empty, stays)."""
    if entry.get('worktree'):
        try:
            runworktree.remove(entry['worktree'], force=True)
        except runworktree.WorktreeError:
            pass


def _now_ms():
    return int(time.time() * 1000)


def _close_quietly(chat_id):
    try:
        CHATS.close(chat_id)
    except StoreError:
        pass


def _watch_run(chat, run_id, close_after=False):
    """An agent run's outcome onto its record as it comes: each turn's `result` (its cost, turns, whether it erred —
    and unread again: there is something new to see), and the end of its process (exit code, closed by the user).
    `close_after` (a scheduled run): once its turn is over, its claude ends unless the dock has it open — nobody is
    there to go on with it, and Open in dock resumes it from its transcript."""
    path = runs_path()

    def on_result(msg):
        agentruns.update(path, run_id, outcome='error' if msg.get('is_error') else 'success', ended_ts=_now_ms(),
                         cost=msg.get('total_cost_usd') if isinstance(msg.get('total_cost_usd'), (int, float)) else None,
                         turns=msg.get('num_turns') if isinstance(msg.get('num_turns'), int) else None,
                         stopped=True if chat.stopped else None, read_at=None)
        if close_after and not chat.pending and not chat.watched:
            # Not from here: this runs on the chat's own reader thread, which kill() waits for.
            threading.Thread(target=_close_quietly, args=(run_id,), daemon=True).start()

    def on_exit(code):
        agentruns.update(path, run_id, exit_code=code, closed_ts=_now_ms(), stopped=True if chat.stopped else None)

    chat.on_result, chat.on_exit = on_result, on_exit
    if chat.last_result is not None:  # a turn already over before the hooks were on (a very quick one)
        on_result(chat.last_result)


def start_agent_run(dir_id, name, args='', mode='', model=None, effort=None, source='here', vault=None, where='here', schedule=None):
    """A run as a chat inside this server, from the page (`here`) or from a schedule (`schedule`, its id: no page
    needed): claude -p started in the agent's folder (so it loads that folder's commands), with `/<name> <args>` as its
    first message, recorded in the list of runs (agentruns) and watched until it ends (_watch_run)."""
    prompt, cwd, flags, entry = _agent_plan(dir_id, name, args, mode, model, effort, where)
    if schedule:
        entry['schedule'] = schedule
    before = runchanges.snapshot(cwd)  # where the folder stood: its Changes compare with it
    try:
        chat = _spawn_chat(entry['id'], flags, cwd, prompt, None, entry['mode'], entry['model'], None, effort=entry['effort'])
    except Exception:
        _drop_worktree(entry)
        raise
    chat.vault = vault
    agentruns.add(runs_path(), {**entry, **before, 'target': 'here', 'source': source, 'started_ts': _now_ms()})
    _watch_run(chat, entry['id'], close_after=source == 'schedule')
    chat.send(prompt)  # once recorded and watched: its first result always finds its record
    return {'chat': chat.info(), 'cwd': cwd, 'command': _command_line([*chat_flags(entry['mode']), *flags]), 'session_id': entry['id'],
            **{k: entry[k] for k in ('worktree', 'branch') if k in entry}}


def run_agent(store, dir_id, name, args='', mode='', model=None, effort=None, where='here'):
    """Run a command of an agent folder as a chat in the dock (start_agent_run), its vault the one the page is in."""
    return start_agent_run(dir_id, name, args, mode, model, effort, 'here', getattr(store, 'vault_id', None), where)


def open_agent_chat(store, dir_id, name, args='', mode='', model=None, effort=None, where='here'):
    """Run, on an agent's page: a chat in the dock, in the agent's folder (or a new worktree of it), with nothing sent
    yet. The dock's composer is handed `/<name> <args>` (`draft`): the arguments, mode, model and effort are settled
    there, and the run is recorded and watched when its first message goes (chat_send → _start_agent_draft). Closed
    unsent, nothing is recorded and its worktree, if any, goes."""
    prompt, cwd, flags, entry = _agent_plan(dir_id, name, args, mode, model, effort, where)
    try:
        chat = _spawn_chat(entry['id'], flags, cwd, f'/{name}', None, entry['mode'], entry['model'], None, effort=entry['effort'])
    except Exception:
        _drop_worktree(entry)
        raise
    chat.vault = getattr(store, 'vault_id', None)
    chat.agent_draft = entry
    chat.on_exit = lambda code: _drop_worktree(chat.agent_draft) if getattr(chat, 'agent_draft', None) else None
    return {'chat': chat.info(), 'cwd': cwd, 'draft': prompt if entry['args'] else f'{prompt} ', 'session_id': entry['id'],
            **{k: entry[k] for k in ('worktree', 'branch') if k in entry}}


def draft_args(name, text):
    """The arguments of a first message that runs `/<name>` (the command alone, or followed by a space and them), on one
    line; None when the message is something else."""
    line = ' '.join(str(text or '').split())
    head = f'/{name}'
    if line == head:
        return ''
    return line[len(head) + 1:] if line.startswith(f'{head} ') else None


def _start_agent_draft(chat, entry, text):
    """The first message of a chat opened by open_agent_chat: from now on it is a run, recorded with the arguments it
    was sent with and the mode, model and effort the composer holds, where the folder stands now (its Changes compare
    with it), and watched until it ends. A first message that is not the command is still that agent's run in that
    folder (its worktree has to be listed somewhere to be removed), with no arguments."""
    args = draft_args(entry['cmd'], text)
    before = runchanges.snapshot(chat.cwd)
    agentruns.add(runs_path(), {**entry, 'at': now_stamp(), 'args': args or '', 'mode': chat.mode or entry['mode'], 'model': chat.model or entry['model'],
                                'effort': chat.effort or entry['effort'], **before, 'target': 'here', 'source': 'here', 'started_ts': _now_ms()})
    _watch_run(chat, entry['id'])
    chat.rename(agent_message(entry['cmd'], args) if args is not None else f'/{entry["cmd"]}')


def launch_agent(dir_id, name, args='', mode='', model=None, effort=None, target='terminal', where='here'):
    """Open in ▾ of an agent's page: the same run somewhere else. Terminal: `claude` in the folder under a fresh session
    id, the message as its first one and the mode as --permission-mode, recorded like a run in the dock. Claude
    Desktop, Cursor or Antigravity: a new session there, in that folder, the message written and not sent (Enter,
    there), not recorded (the app picks its own id), as the Claude terminal's Open in ▾ does."""
    target = _target(target)
    prompt, cwd, flags, entry = _agent_plan(dir_id, name, args, mode, model, effort, where)
    if target != 'terminal':
        try:
            return {**_open_elsewhere(target, cwd, prompt=prompt), **{k: entry[k] for k in ('worktree', 'branch') if k in entry}}
        except Exception:
            _drop_worktree(entry)
            raise
    if entry['mode'] != 'default':
        flags = [*flags, '--permission-mode', entry['mode']]
    before = runchanges.snapshot(cwd)
    try:
        out = _open_terminal(cwd, flags, prompt)
    except Exception:
        _drop_worktree(entry)
        raise
    agentruns.add(runs_path(), {**entry, **before, 'target': 'terminal', 'source': 'terminal', 'started_ts': _now_ms()})
    return {**out, 'session_id': entry['id'], 'recorded': True}


def _run_now(r):
    """A run as listed: its record, and what its chat in this server is doing now — `live` (running in the dock or as a
    terminal there), `busy` (a turn under way), `pending` (requests waiting for an answer) and `waiting_for` (what the
    first one asks: a tool's name, 'question' or 'plan')."""
    chat = CHATS.live(r['id'])
    out = {**r, 'live': bool(chat or TERMS.live(r['id'])), 'busy': bool(chat and chat.busy), 'pending': len(chat.pending) if chat else 0}
    out.pop('untracked', None)  # the Changes' business, not a list's
    if chat and chat.pending:
        out['waiting_for'] = chat.waiting_for()
    return out


def agent_runs(dir_id=None, name=None):
    """The runs on record, newest first: of one agent (its page's Runs panel), of one folder, or all."""
    return {'runs': [_run_now(r) for r in agentruns.of(agentruns.load(runs_path()), dir_id or None, name or None)]}


ACTIVITY_MAX = 200  # runs the Activity page and the Inbox are given: the newest


def agent_activity():
    """Every agent's runs for the Activity page, the sidebar's Inbox and its dots: the newest ACTIVITY_MAX, each with its
    folder's name, and the counts — waiting for an answer, running, finished and not looked at yet."""
    names = {d['id']: d['name'] for d in agent_dirs()}
    runs = [{**_run_now(r), 'dir_name': names.get(r.get('dir'), '')} for r in agentruns.of(agentruns.load(runs_path()))][:ACTIVITY_MAX]
    # As static/js/runmodel.js runStatus reads them: a run whose turn is over has ended, even with its chat still open.
    working = lambda r: r['live'] and (r['busy'] or not r.get('outcome'))  # noqa: E731
    return {'runs': runs, 'counts': {
        'needs_you': sum(1 for r in runs if r['pending']),
        'running': sum(1 for r in runs if working(r) and not r['pending']),
        'unread': sum(1 for r in runs if r.get('outcome') and not r.get('read_at') and not working(r) and not r['pending']),
    }}


def read_agent_runs(ids):
    if not isinstance(ids, list):
        raise StoreError(400, 'ids must be a list')
    return {'read': agentruns.mark_read(runs_path(), ids[:500], now_stamp())}


def archive_agent_runs(ids, archived=True):
    """Archives runs (or brings them back): only a run that has ended — never one working or waiting for you, whose
    chat is still under way (as static/js/runmodel.js runStatus reads it)."""
    if not isinstance(ids, list):
        raise StoreError(400, 'ids must be a list')
    on = archived is not False
    wanted = {str(i or '').strip().lower() for i in ids[:500]}
    runs = {r['id']: _run_now(r) for r in agentruns.load(runs_path()) if r['id'] in wanted}
    if on:
        busy = [sid for sid, r in runs.items() if r['pending'] or (r['live'] and (r['busy'] or not r.get('outcome')))]
        if busy and len(busy) == len(runs):
            raise StoreError(409, 'a run that is working or waiting for you cannot be archived')
        runs = {sid: r for sid, r in runs.items() if sid not in busy}
    return {'archived' if on else 'unarchived': agentruns.archive(runs_path(), list(runs), now_stamp(), on)}


def _run_on_record(session_id):
    r = agentruns.find(runs_path(), session_id)
    if not r:
        raise StoreError(404, 'that run is not on record')
    return r


def agent_run_changes(session_id):
    """What a run changed in its folder (tm/runchanges.py): its files with their lines added and deleted. `git` false:
    it did not start in a git work tree (or before this app noted where it stood), so there is nothing to compare with."""
    r = _run_on_record(session_id)
    if not r.get('base'):
        return {'git': False, 'files': []}
    files = runchanges.changes(r['cwd'], r['base'], r.get('untracked'))
    if files is None:
        return {'git': True, 'files': [], 'error': 'git cannot compare with where the folder stood: the folder or its snapshot is gone'}
    return {'git': True, 'files': files, 'base': r['base'][:12]}


def agent_run_diff(session_id, path):
    """One changed file's diff — only a file its Changes list."""
    r = _run_on_record(session_id)
    out = runchanges.diff(r['cwd'], r.get('base'), r.get('untracked'), str(path or '')) if r.get('base') else None
    if out is None:
        raise StoreError(404, 'that file is not among the run\'s changes')
    return out


def remove_run_worktree(session_id, force=False):
    """Takes a run's worktree away (tm/runworktree.py); its branch stays, with what the run committed. One with changes
    nobody committed is kept unless `force`: the answer says so (`dirty`) for the page to ask first."""
    r = _run_on_record(session_id)
    if not r.get('worktree'):
        raise StoreError(400, 'this run has no worktree of its own')
    if CHATS.live(r['id']) or TERMS.live(r['id']):
        raise StoreError(409, 'it is still running here: close it in the dock first')
    try:
        runworktree.remove(r['worktree'], force=bool(force))
    except runworktree.WorktreeError as e:
        if e.dirty and not force:
            return {'removed': False, 'dirty': True, 'message': str(e)}
        raise StoreError(409, str(e))
    agentruns.update(runs_path(), r['id'], removed_ts=_now_ms())
    return {'removed': True, 'branch': r.get('branch')}


def forget_agent_run(session_id):
    if not agentruns.forget(runs_path(), session_id):
        raise StoreError(404, 'that run is not on record')
    return {'forgotten': str(session_id).strip().lower()}


# ── Agents: scheduled runs (tm/schedules.py) ──
AGENT_SCHEDULES = 'agent-schedules.json'
SCHEDULER_EVERY = 30  # seconds between the scheduler's looks
_tick_lock = threading.Lock()


def schedules_path():
    return os.path.join(os.path.dirname(CONFIG_PATH), AGENT_SCHEDULES)


def _schedule_out(s, names):
    return {**s, 'label': schedules.label(s['rule']), 'dir_name': names.get(s['dir'], '')}


def agent_schedules(dir_id=None, name=None):
    """The schedules, of one agent (its page's Schedules tab) or all (Settings → Agents), each with its rule in words."""
    names = {d['id']: d['name'] for d in agent_dirs()}
    items = [s for s in schedules.load(schedules_path()) if (not dir_id or s['dir'] == dir_id) and (not name or s['cmd'] == name)]
    return {'schedules': [_schedule_out(s, names) for s in items], 'catch_up_hours': schedules.CATCH_UP_MS // 3_600_000}


def save_agent_schedule(body):
    """A new schedule, or one changed (`id`): checked as a run would be — the folder and its command, the arguments,
    mode, model, effort and where — and its next fire worked out from now."""
    body = body if isinstance(body, dict) else {}
    folder = agent_dir(body.get('dir'))
    name = str(body.get('cmd') or '').strip()
    if not name or not commands.find(folder['path'], name):
        raise StoreError(404, f'{folder["name"]} has no command /{name}')
    agent_message(name, body.get('args'))  # its length
    try:
        rule = schedules.normalize(body.get('rule'))
    except ValueError as e:
        raise StoreError(400, str(e))
    mode = str(body.get('mode') or 'default').strip()
    if mode not in CHAT_MODES:
        raise StoreError(400, f"mode must be one of {', '.join(CHAT_MODES)}")
    where = str(body.get('where') or 'here').strip()
    if where not in AGENT_WHERE:
        raise StoreError(400, f"where must be one of {', '.join(AGENT_WHERE)}")
    model, effort = str(body.get('model') or '').strip(), str(body.get('effort') or '').strip()  # empty: the app's own
    try:
        claude_flags(model, effort)
    except ValueError as e:
        raise StoreError(400, str(e))
    fields = {'dir': folder['id'], 'cmd': name, 'args': ' '.join(str(body.get('args') or '').split()), 'mode': mode,
              'model': model or None, 'effort': effort or None, 'where': where, 'rule': rule,
              'next_ts': schedules.next_ts(rule, _now_ms())}
    path = schedules_path()
    if body.get('id'):
        out = schedules.update(path, str(body['id']), **fields, error=None, error_ts=None)
        if not out:
            raise StoreError(404, 'no such schedule')
    else:
        try:
            out = schedules.add(path, {**fields, 'created_at': now_stamp(), 'paused': False})
        except ValueError as e:
            raise StoreError(409, str(e))
    return {'schedule': _schedule_out(out, {folder['id']: folder['name']})}


def _schedule(sid):
    s = next((x for x in schedules.load(schedules_path()) if x['id'] == str(sid or '')), None)
    if not s:
        raise StoreError(404, 'no such schedule')
    return s


def pause_agent_schedule(sid, paused):
    """Paused, it never fires; on again, it fires next at its next time from now (what it missed meanwhile, it skips)."""
    s = _schedule(sid)
    out = schedules.update(schedules_path(), s['id'], paused=bool(paused),
                           next_ts=None if paused else schedules.next_ts(s['rule'], _now_ms()))
    return {'schedule': _schedule_out(out, {d['id']: d['name'] for d in agent_dirs()})}


def delete_agent_schedule(sid):
    """The schedule goes; the runs it made stay in the list of runs."""
    if not schedules.remove(schedules_path(), str(sid or '')):
        raise StoreError(404, 'no such schedule')
    return {'deleted': sid}


def _fire(s, now):
    """Starts one run of a schedule → its session id, or None. Not while its last run is still going here (one at a
    time: an hourly one slower than an hour would pile up); a run that cannot start is noted on the schedule."""
    path = schedules_path()
    if s.get('last_run') and CHATS.live(s['last_run']):
        schedules.update(path, s['id'], skipped_ts=now)
        return None
    try:
        out = start_agent_run(s['dir'], s['cmd'], s.get('args', ''), s.get('mode') or '', s.get('model'), s.get('effort'),
                              'schedule', None, s.get('where') or 'here', schedule=s['id'])
    except Exception as e:  # a folder gone, claude missing, a command not committed for its worktree…
        schedules.update(path, s['id'], error=str(e) or type(e).__name__, error_ts=now)
        return None
    schedules.update(path, s['id'], last_run=out['session_id'], last_ts=now, error=None, error_ts=None)
    return out['session_id']


def run_agent_schedule_now(sid):
    """Run now: one run of the schedule at once; its next fire stays as it was."""
    s = _schedule(sid)
    run = _fire(s, _now_ms())
    after = _schedule(sid)
    if not run:
        raise StoreError(409, after.get('error') or 'its last run is still going: wait for it, or close it in the dock')
    return {'session_id': run}


def tick(now_ms=None):
    """The scheduler's look (every SCHEDULER_EVERY seconds, and once as the server starts): each schedule not paused
    whose time has come runs once — moved on to its next time first, so one that cannot start is not retried every
    look. One whose time came more than CATCH_UP_MS ago (the app off, the Mac asleep) does not run: it is marked
    missed. → the session ids started."""
    now = _now_ms() if now_ms is None else now_ms
    started = []
    with _tick_lock:
        path = schedules_path()
        for s in schedules.load(path):
            if s['paused'] or 'next_ts' not in s or s['next_ts'] > now:
                continue
            nxt = schedules.next_ts(s['rule'], now)
            if now - s['next_ts'] > schedules.CATCH_UP_MS:
                schedules.update(path, s['id'], missed_ts=s['next_ts'], next_ts=nxt)
                continue
            schedules.update(path, s['id'], next_ts=nxt)
            run = _fire(s, now)
            if run:
                started.append(run)
    return started


def start_scheduler(every=SCHEDULER_EVERY):
    """The scheduler's thread (main(); tests call tick themselves)."""
    def loop():
        while True:
            try:
                tick()
            except Exception:  # never the end of the scheduler
                traceback.print_exc()
            time.sleep(every)
    threading.Thread(target=loop, name='agent-schedules', daemon=True).start()


def open_agent_file(dir_id, name):
    """A command's file in the editor of Settings (`open -a <app> <file>`: handed to it to edit, never run)."""
    if sys.platform != 'darwin':
        raise StoreError(501, 'opening in an editor needs macOS')
    folder = agent_dir(dir_id)
    full = commands.find(folder['path'], name)
    if not full:
        raise StoreError(404, f'{folder["name"]} has no command /{name}')
    app = APP.config.get('editor_app') or 'Cursor'
    if app not in EDITORS:
        raise StoreError(400, f'editor_app must be one of {", ".join(EDITORS)}')
    try:
        subprocess.run(['open', '-a', app, full], check=True, timeout=10, capture_output=True)
    except subprocess.CalledProcessError:
        raise StoreError(400, f'{app} could not open it: is it installed? Pick another editor in Settings → General.') from None
    return {'opened': name, 'app': app}


def _in_dock(session_id):
    """The dock's chat or terminal of that session, running or ended, else None."""
    for pool in (CHATS, TERMS):
        try:
            return pool.get(session_id)
        except StoreError:
            pass
    return None


def associate_claude(store, session_id, from_key, to_key):
    """Change the item a session is about: its record moves to that item's list (or the global one, no item), so it
    is listed there, and the dock's chat or terminal of it takes the item's name. A session the dock runs from
    another vault is refused: its record is not in this one."""
    sid = str(session_id or '').strip().lower()
    live = _in_dock(sid)
    vault = getattr(store, 'vault_id', None)
    if live and live.vault and vault and live.vault != vault:
        raise StoreError(409, 'this session was opened in another vault: switch to it to change its item')
    fallback = None
    if live:  # a launch that never got its record still gets one, from what the dock knows of it
        fallback = {'cwd': live.cwd, 'instruction': '' if live.key else live.label,
                    **({'model': live.model, 'effort': live.effort} if isinstance(live, Chat) else {})}
    entry = store.move_claude_session(sid, from_key or None, to_key or None, fallback)
    out = {'session_id': sid}
    if live:
        it = store.find(to_key) if to_key else None
        live.key = it['key'] if it else None
        live.label = f"{it.get('ref') or it['id'] or it['type']} · {it['title']}" if it else (entry.get('instruction') or 'Claude')
        out['session'] = live.info()
    return out


def chat_files(chat_id):
    """The files and folders of a chat's folder, for the composer's @."""
    paths, truncated = session_files(CHATS.get(chat_id).cwd)
    return {'files': paths, 'truncated': truncated}


CHAT_ITEMS_MAX = 10  # vault items attached to one message


def chat_send(chat_id, text, keys=None, vault_id=None, images=None):
    """A message for a chat, with the vault items attached to it: their context is built here from their files, in
    the vault the page shows (`vault_id` — the chat itself belongs to no vault, so the route is global and does not
    go into a vault's journal). Its images are checked by the chat (tm/chat.py image_blocks)."""
    chat = CHATS.get(chat_id)
    keys = [k for k in (keys or []) if isinstance(k, str) and k]
    if len(keys) > CHAT_ITEMS_MAX:
        raise StoreError(400, f'at most {CHAT_ITEMS_MAX} items can be attached to one message')
    items = []
    if keys:
        if not vault_id:
            raise StoreError(400, 'which vault the items are in: reload the page', reload=True)
        store = APP.store_for(vault_id)
        for key in dict.fromkeys(keys):
            it = store.read(key)
            items.append({'id': it.get('ref') or it['id'], 'title': it['title'], 'type': it['type'], 'context': store.claude_item_context(key)})
    draft = getattr(chat, 'agent_draft', None)
    if draft and str(text or '').strip():  # an agent's chat, opened unsent: this message makes it a run
        chat.agent_draft = None
        _start_agent_draft(chat, draft, text)
    chat.send(text, items, images or [])
    if chat.untitled and str(text or '').strip():
        _name_untitled(chat, text)
    return {'ok': True}


def _name_untitled(chat, text):
    """A chat started empty, named by its first message: its first line is the instruction on its record (what its
    history shows) and, about no item, its name in the dock. Not on record (a vault since removed): just the name."""
    chat.untitled = False
    line = clean_instruction(text)
    if not chat.key:
        chat.rename(line)
    if chat.vault:
        try:
            APP.store_for(chat.vault).set_claude_session_instruction(chat.key, chat.id, line)
        except StoreError:
            pass


def chat_control(chat_id, mode=None, model=None, effort=None):
    """The composer's choices, from closed lists: the permission mode, the model (those claude listed), the effort."""
    chat = CHATS.get(chat_id)
    out = {}
    if mode:
        out.update(chat.set_mode(mode))
    if model:
        if not chat.models and model not in CLAUDE_MODELS:
            raise StoreError(400, f"model must be one of {', '.join(CLAUDE_MODELS)}")
        out.update(chat.set_model(model))
    if effort:
        out.update(chat.set_effort(effort))
    return {**out, 'chat': chat.info()}


def recent_claude_sessions(store, cwd=None):
    """The newest conversations on this computer for the AI tab's Add a session (`cwd`: those of that folder, however
    old), each with the item that already lists it in this vault (`listed_on`: its key), so the picker can say so."""
    on = {}
    for it in store.items():
        for s in it['fields'].get('claude_sessions') or []:
            on.setdefault(s.get('id'), it['key'])
    found = recent_sessions(200, cwd=cwd) if cwd else recent_sessions()
    return {'sessions': [{**f, 'listed_on': on.get(f['id'])} for f in found]}


def add_existing_claude(store, key, session_id):
    """Add to an item a conversation started elsewhere — Terminal, Claude Desktop, the VS Code / Cursor extension —
    found by its id among Claude Code's transcripts: the folder, start, title and origin come from there, never from
    the request, so a resume runs only where Claude Code itself says it ran."""
    sid = str(session_id or '').strip().lower()
    path = transcript_path(sid, '')
    facts = session_facts(path) if path else None
    if not facts:
        raise StoreError(404, f'Claude Code has no conversation with that id on this computer: {sid or "(empty)"}')
    entry = {'id': facts['id'], 'at': facts['started'] or facts['updated'], 'cwd': facts['cwd'],
             'instruction': facts['title'], 'source': facts['source'] or 'other'}
    return store.add_existing_claude_session(key, entry)


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
    return {'vault': vault, 'check': check, 'matches': matches, 'agents': store.agents_status()}


class AgentsRefresh:
    """Keeps each opted-in vault's AGENTS.md (tm/agentsmd.py) up to date, off the request: poke() after a write
    (or when a vault is opened) waits DELAY seconds of quiet, then writes the guide again if what it says changed. A
    burst of saves is one refresh, and no answer waits for the scan it needs. A vault without the guide costs one
    small read per write."""
    DELAY = 3.0

    def __init__(self):
        self._timers = {}
        self._lock = threading.Lock()

    def poke(self, store):
        if store is None or not agentsmd.is_on(store.root):
            return
        with self._lock:
            old = self._timers.pop(store.root, None)
            if old:
                old.cancel()
            timer = threading.Timer(self.DELAY, self._run, args=(store,))
            timer.daemon = True
            self._timers[store.root] = timer
            timer.start()

    def _run(self, store):
        with self._lock:
            self._timers.pop(store.root, None)
        try:
            store.refresh_agents_md(APP_DIR)
        except StoreError as e:  # a vault that stopped matching its structure: the next write after it is fixed refreshes it
            sys.stderr.write(f'AGENTS.md of {store.root} not refreshed: {e}\n')
        except Exception:  # noqa: BLE001 — a guide that cannot be written never breaks the app
            traceback.print_exc()


AGENTS_REFRESH = AgentsRefresh()


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
    # The vault's guide for agents (tm/agentsmd.py): AGENTS.md at its top, on or off (Settings → Vaults).
    ('POST', '/api/vault/agents'): lambda s, q, b: s.set_agents_md(bool(b.get('on')), APP_DIR),
    ('GET', '/api/items'): lambda s, q, b: {'items': s.items()},
    # The vault as a graph: its items and docs, and every link between them (tm/graph.py). The page filters it.
    ('GET', '/api/graph'): lambda s, q, b: s.graph(),
    ('GET', '/api/files'): lambda s, q, b: s.files(hidden=q.get('hidden') == '1'),
    ('POST', '/api/files/mkdir'): lambda s, q, b: s.make_folder(b.get('path'), parents=bool(b.get('parents'))),
    ('GET', '/api/docs/roots'): lambda s, q, b: {'containers': s.docs_roots()},
    ('GET', '/api/canvases'): lambda s, q, b: s.canvases(q.get('host')),
    ('GET', '/api/canvases/index'): lambda s, q, b: {'hosts': s.canvas_index()},
    ('GET', '/api/canvases/all'): lambda s, q, b: s.all_canvases(),
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
    ('GET', '/api/files/opener'): lambda s, q, b: file_opener(s, q.get('path')),
    ('POST', '/api/files/open-default'): lambda s, q, b: open_default(s, b.get('path')),
    ('POST', '/api/files/save'): lambda s, q, b: s.save_file(b.get('path'), b.get('text'), b.get('base_rev'), bool(b.get('force'))),
    ('POST', '/api/files/create'): lambda s, q, b: s.create_file(b.get('path'), b.get('text') or '', parents=bool(b.get('parents'))),
    ('POST', '/api/files/duplicate'): lambda s, q, b: s.duplicate_file(b.get('path')),
    ('POST', '/api/files/upload'): lambda s, q, b: s.upload_file(q.get('folder') or '', b['filename'], b['data']),
    ('GET', '/api/item'): lambda s, q, b: s.read(q['key']),
    ('GET', '/api/item/history'): lambda s, q, b: {'entries': s.item_history(q['key'])},
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
    ('GET', '/api/week-board'): lambda s, q, b: s.week_lists(),
    ('POST', '/api/week-board'): lambda s, q, b: s.save_week_lists(b.get('lists')),
    ('GET', '/api/pins'): lambda s, q, b: s.pins(),
    ('GET', '/api/people'): lambda s, q, b: s.people(),
    ('POST', '/api/people'): lambda s, q, b: s.add_person(b.get('name'), b.get('values')),
    ('POST', '/api/people/rename'): lambda s, q, b: s.rename_person(b.get('old'), b.get('new')),
    ('POST', '/api/people/delete'): lambda s, q, b: s.delete_person(b.get('name')),
    ('POST', '/api/people/to-group'): lambda s, q, b: s.person_to_group(b.get('name')),
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
        b['id'], b['kind'], b.get('note') or '', b.get('date'), APP.config['work_kinds'], b.get('time'), bool(b.get('tentative'))),
    # A tentative entry (the worklog proposal's): `index` one of them, else every one of the day.
    ('POST', '/api/worklog/confirm'): lambda s, q, b: s.confirm_log(b['date'], b.get('index')),
    ('POST', '/api/worklog/discard'): lambda s, q, b: s.discard_log(b['date'], b.get('index')),
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
    ('GET', '/api/claude/recent'): lambda s, q, b: recent_claude_sessions(s, q.get('cwd') or None),
    ('GET', '/api/claude/folders'): lambda s, q, b: {'folders': session_folders()},
    ('POST', '/api/claude/add'): lambda s, q, b: add_existing_claude(s, b.get('key'), b.get('session_id')),
    ('POST', '/api/claude/main'): lambda s, q, b: s.set_main_claude_session(b.get('key'), str(b.get('session_id') or '')),
    ('POST', '/api/claude/forget'): lambda s, q, b: forget_claude_session(s, b.get('key'), int(b.get('index', -1))),
    ('POST', '/api/claude/associate'): lambda s, q, b: associate_claude(s, b.get('session_id'), b.get('from_key'), b.get('to_key')),
    ('GET', '/api/term/list'): lambda s, q, b: {'terms': TERMS.list()},
    ('POST', '/api/term/open'): lambda s, q, b: open_term(s, b.get('key'), b.get('instruction') or '', b.get('model'), b.get('effort'),
                                                       b.get('cwd'), b.get('cols'), b.get('rows'), bool(b.get('empty'))),
    ('POST', '/api/term/resume'): lambda s, q, b: resume_term(s, b.get('key'), b.get('session_id'), b.get('cols'), b.get('rows')),
    ('POST', '/api/term/input'): lambda s, q, b: term_input(b.get('id'), b.get('data')),
    ('POST', '/api/term/resize'): lambda s, q, b: term_resize(b.get('id'), b.get('cols'), b.get('rows')),
    ('POST', '/api/term/close'): lambda s, q, b: TERMS.close(b.get('id')),
    ('GET', '/api/chat/list'): lambda s, q, b: {'chats': CHATS.list(), 'modes': list(CHAT_MODES), 'models': list(CLAUDE_MODELS),
                                                 'offered': Chat.last_models},
    ('POST', '/api/chat/open'): lambda s, q, b: open_chat(s, b.get('key'), b.get('instruction') or '', b.get('model'), b.get('effort'),
                                                       b.get('cwd'), b.get('mode') or '', bool(b.get('empty'))),
    ('POST', '/api/chat/resume'): lambda s, q, b: resume_chat(s, b.get('key'), b.get('session_id'), b.get('mode') or ''),
    ('GET', '/api/chat/files'): lambda s, q, b: chat_files(q.get('id')),
    ('POST', '/api/chat/send'): lambda s, q, b: chat_send(b.get('id'), b.get('text'), b.get('items'), b.get('vault'), b.get('images')),
    ('POST', '/api/chat/permission'): lambda s, q, b: CHATS.get(b.get('id')).answer(
        b.get('request_id'), b.get('behavior'), bool(b.get('always')), b.get('message') or '', b.get('answers'), b.get('mode') or ''),
    ('POST', '/api/chat/interrupt'): lambda s, q, b: CHATS.get(b.get('id')).interrupt(),
    ('POST', '/api/chat/control'): lambda s, q, b: chat_control(b.get('id'), b.get('mode'), b.get('model'), b.get('effort')),
    ('POST', '/api/chat/close'): lambda s, q, b: CHATS.close(b.get('id')),
    ('POST', '/api/item/comment'): lambda s, q, b: s.add_comment(b.get('key'), b.get('text')),
    ('POST', '/api/item/comment/delete'): lambda s, q, b: s.delete_comment(b.get('key'), int(b.get('index', -1))),
    ('POST', '/api/item/comment/restore'): lambda s, q, b: s.restore_comment(b.get('key'), int(b.get('index', 0)), b.get('comment')),
    ('POST', '/api/item/comment/edit'): lambda s, q, b: s.edit_comment(b.get('key'), int(b.get('index', -1)), b.get('text'), b.get('was')),
    ('POST', '/api/item/convert'): lambda s, q, b: s.convert(b.get('key'), b.get('type'), b.get('values')),
    ('POST', '/api/open'): lambda s, q, b: open_local(b.get('path')),
    ('POST', '/api/folder/pick'): lambda s, q, b: pick_folder(b.get('start'), b.get('prompt')),
    ('GET', '/api/server'): lambda s, q, b: server_status(),
    ('POST', '/api/server/stop'): lambda s, q, b: stop_server(),
    ('GET', '/api/exports'): lambda s, q, b: exports_listing(),
    ('POST', '/api/exports'): lambda s, q, b: export_version(s, b.get('note'), b.get('kind')),
    ('POST', '/api/exports/delete'): lambda s, q, b: export.delete(source_dir(), b.get('name')),
    ('POST', '/api/exports/reveal'): lambda s, q, b: open_local(export.path_of(source_dir(), b.get('name'))),
    ('POST', '/api/worklog/delete'): lambda s, q, b: s.unlog_work(b['date'], int(b['index'])),
    ('POST', '/api/worklog/restore'): lambda s, q, b: s.restore_log(b.get('date'), int(b.get('index', 0)), b.get('entry')),
    ('GET', '/api/guide'): lambda s, q, b: user_guide(),
    ('GET', '/api/agents'): lambda s, q, b: list_agents(),
    ('GET', '/api/agents/command'): lambda s, q, b: agent_command(q.get('dir'), q.get('cmd')),
    ('POST', '/api/agents/run'): lambda s, q, b: run_agent(s, b.get('dir'), b.get('cmd'), b.get('args') or '', b.get('mode') or '',
                                                           b.get('model'), b.get('effort'), b.get('where') or 'here'),
    ('GET', '/api/agents/related'): lambda s, q, b: agent_related(q.get('dir'), q.get('cmd')),
    ('GET', '/api/agents/file'): lambda s, q, b: agent_file(q.get('dir'), q.get('cmd'), q.get('path')),
    ('POST', '/api/agents/file'): lambda s, q, b: agent_file_save(b.get('dir'), b.get('cmd'), b.get('path'), b.get('text'), b.get('rev')),
    ('POST', '/api/agents/open'): lambda s, q, b: open_agent_chat(s, b.get('dir'), b.get('cmd'), b.get('args') or '', b.get('mode') or '',
                                                                  b.get('model'), b.get('effort'), b.get('where') or 'here'),
    ('POST', '/api/agents/launch'): lambda s, q, b: launch_agent(b.get('dir'), b.get('cmd'), b.get('args') or '', b.get('mode') or '',
                                                                 b.get('model'), b.get('effort'), b.get('target') or 'terminal',
                                                                 b.get('where') or 'here'),
    ('POST', '/api/agents/runs/worktree/remove'): lambda s, q, b: remove_run_worktree(b.get('id'), b.get('force')),
    ('GET', '/api/agents/runs'): lambda s, q, b: agent_runs(q.get('dir'), q.get('cmd')),
    ('POST', '/api/agents/runs/forget'): lambda s, q, b: forget_agent_run(b.get('session_id')),
    ('GET', '/api/agents/activity'): lambda s, q, b: agent_activity(),
    ('POST', '/api/agents/runs/read'): lambda s, q, b: read_agent_runs(b.get('ids')),
    ('POST', '/api/agents/runs/archive'): lambda s, q, b: archive_agent_runs(b.get('ids'), b.get('archived', True)),
    ('GET', '/api/agents/runs/changes'): lambda s, q, b: agent_run_changes(q.get('id')),
    ('GET', '/api/agents/runs/diff'): lambda s, q, b: agent_run_diff(q.get('id'), q.get('path')),
    ('GET', '/api/agents/schedules'): lambda s, q, b: agent_schedules(q.get('dir'), q.get('cmd')),
    ('POST', '/api/agents/schedules'): lambda s, q, b: save_agent_schedule(b),
    ('POST', '/api/agents/schedules/pause'): lambda s, q, b: pause_agent_schedule(b.get('id'), b.get('paused')),
    ('POST', '/api/agents/schedules/delete'): lambda s, q, b: delete_agent_schedule(b.get('id')),
    ('POST', '/api/agents/schedules/run'): lambda s, q, b: run_agent_schedule_now(b.get('id')),
    ('POST', '/api/agents/open-file'): lambda s, q, b: open_agent_file(b.get('dir'), b.get('cmd')),
    ('POST', '/api/agents/reveal'): lambda s, q, b: open_local(agent_dir(b.get('dir'))['path']),
}
# The routes whose body is a file's bytes, not JSON.
UPLOAD_ROUTES = {('POST', '/api/attachments/add'), ('POST', '/api/files/upload')}
# The routes that are not about one vault: they get no store and need no X-TM-Vault. Everything else does.
GLOBAL_ROUTES = {
    ('GET', '/api/config'), ('POST', '/api/config'),
    ('GET', '/api/term/list'), ('POST', '/api/term/input'), ('POST', '/api/term/resize'), ('POST', '/api/term/close'),
    ('GET', '/api/chat/list'), ('GET', '/api/chat/files'), ('POST', '/api/chat/send'), ('POST', '/api/chat/permission'),
    ('POST', '/api/chat/interrupt'), ('POST', '/api/chat/control'), ('POST', '/api/chat/close'),
    ('POST', '/api/claude/updated'), ('GET', '/api/claude/folders'), ('POST', '/api/open'), ('POST', '/api/folder/pick'), ('GET', '/api/server'), ('POST', '/api/server/stop'),
    ('GET', '/api/exports'), ('POST', '/api/exports/delete'), ('POST', '/api/exports/reveal'), ('GET', '/api/guide'),
    ('GET', '/api/agents'), ('GET', '/api/agents/command'), ('GET', '/api/agents/related'), ('GET', '/api/agents/file'), ('POST', '/api/agents/file'), ('POST', '/api/agents/open-file'), ('POST', '/api/agents/reveal'),
    ('POST', '/api/agents/launch'), ('GET', '/api/agents/runs'), ('POST', '/api/agents/runs/forget'),
    ('GET', '/api/agents/activity'), ('POST', '/api/agents/runs/read'), ('POST', '/api/agents/runs/archive'), ('GET', '/api/agents/runs/changes'), ('GET', '/api/agents/runs/diff'),
    ('POST', '/api/agents/runs/worktree/remove'), ('GET', '/api/agents/schedules'), ('POST', '/api/agents/schedules'),
    ('POST', '/api/agents/schedules/pause'), ('POST', '/api/agents/schedules/delete'), ('POST', '/api/agents/schedules/run'),
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
        CHATS.close_all()
        print('\nbye', flush=True)
        os._exit(0)
    signal.signal(signal.SIGTERM, stop)
    SERVER.update(on_demand=bool(listeners), started_at=time.time(), port=port, stop=stop)
    start_scheduler()  # its first look now: what came due while the app was off
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        stop()


if __name__ == '__main__':
    main()
