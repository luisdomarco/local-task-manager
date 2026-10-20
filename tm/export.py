"""Versions as zips, to carry them between machines (Settings → Export, README "Exporting the system").
Three kinds, each its own zip and its own list:
  system  the app: code, tests, tools, docs, the sample vault
  agents  what Claude works with: .claude/ (commands, settings…) and every CLAUDE.md
  vault   the vault in use, wherever it lives, whole (.task-manager/ too), under vault-<its id>/ in the zip

For the system and the agents what goes in is a WHITELIST: a new file at the top of the app stays out
until it is named here, so a secret dropped next to server.py cannot leave by accident. Every zip carries
a VERSION.json saying where and when it was made, and which top-level entries were left out, so a short
whitelist shows. The installed Mac app (tools/install_app.py) exports the checkout it came from: see home().
"""

import json
import os
import re
import socket
import subprocess
import zipfile
from datetime import datetime

# Top-level entries that go in (files, or folders taken whole minus EXCLUDE_DIRS), for either kind.
INCLUDE = ('server.py', 'tm', 'static', 'docs', 'tests', 'tools', 'plans', 'sample-vault', 'sample-vault-ticketing', '.claude', 'CLAUDE.md',
           'README.md', 'LICENSE', 'CHANGELOG.md', 'package.json', 'config.example.json', '.env.example', '.gitignore')
KINDS = ('system', 'agents', 'vault')
# Every name starts with its kind; before that, `task-manager-<kind>-…` (still listed)
PREFIX = 'task-manager-system'


def kind_of(rel):
    """Which zip a whitelisted file goes in: .claude/ and any CLAUDE.md are the agents, the rest the system."""
    return 'agents' if rel == '.claude' or rel.startswith('.claude/') or rel.split('/')[-1] == 'CLAUDE.md' else 'system'
# Folders skipped wherever they appear (relative to the app; a bare name matches at any depth).
EXCLUDE_DIRS = ('__pycache__', '.git', 'node_modules', 'sample-vault/.task-manager', 'sample-vault-ticketing/.task-manager',
                '.claude/worktrees')
EXCLUDE_FILES = ('.DS_Store',)
# Files skipped by their path: Claude Code's permissions on this machine (settings.json, shared, still goes).
EXCLUDE_PATHS = ('.claude/settings.local.json',)
EXCLUDE_SUFFIXES = ('.pyc',)
# Never in, even if someone adds them to INCLUDE: per-machine settings, secrets, personal data, the zips.
NEVER = ('config.json', '.env', 'vault', 'versions', 'backups')
VERSIONS_DIR = 'versions'
NAME_RE = re.compile(r'^(?:(?:system|agents|vault)-)?task-manager-[0-9A-Za-z._-]+\.zip$')
# Inside the vault zip, everything goes under vault-<its id>/ (plain vault/ when it has none): two vaults' zips
# unzipped side by side never land in the same folder. Restoring one: unzip, then add that folder in Settings → Vaults
# with the structure VERSION.json names.
VAULT_DIR = 'vault'
# In an installed copy (tools/install_app.py): {"source": "<the checkout it was installed from>"}
INSTALL_FILE = 'install.json'
# A zip still being written (.part) older than this was cut off (the server stopped mid-export): listing removes it.
STALE_PART_S = 3600


class ExportError(ValueError):
    pass


def _git(app_dir, *args):
    try:
        out = subprocess.run(['git', *args], cwd=app_dir, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return ''
    # rstrip only: a porcelain status line starts with a space (" M file") that is part of its format
    return out.stdout.rstrip() if out.returncode == 0 else ''


def git_info(app_dir):
    """Branch, short sha and the uncommitted paths (empty values outside a repo)."""
    changes = [line[3:] for line in _git(app_dir, 'status', '--porcelain').splitlines() if line.strip()]
    return {'branch': _git(app_dir, 'rev-parse', '--abbrev-ref', 'HEAD').strip(), 'sha': _git(app_dir, 'rev-parse', '--short=7', 'HEAD').strip(),
            'dirty': bool(changes), 'changes': changes}


def home(app_dir):
    """(the folder exports are made from and kept in, why it can make only vault zips). An installed copy holds only
    what the app needs to run — no .git, tests, plans, .claude or CLAUDE.md — so it exports the checkout it was
    installed from (install.json) and keeps the zips in that checkout's versions/: the installed app and the checkout
    list the same ones. That checkout gone: the copy itself, and only vault zips."""
    try:
        with open(os.path.join(app_dir, INSTALL_FILE), encoding='utf-8') as f:
            source = json.load(f).get('source') or ''
    except FileNotFoundError:
        return app_dir, ''
    except (OSError, ValueError, AttributeError):
        source = ''
    if source and os.path.isfile(os.path.join(source, 'server.py')):
        return source, ''
    return app_dir, f"the checkout this app was installed from ({source or 'unknown'}) is not there: only a vault can be exported"


def _skipped(rel, is_dir=False):
    parts = rel.split('/')
    if parts[0] in NEVER or parts[0].startswith('vault.backup-'):
        return True
    if not is_dir and (parts[-1] in EXCLUDE_FILES or rel.endswith(EXCLUDE_SUFFIXES) or rel in EXCLUDE_PATHS):
        return True
    for ex in EXCLUDE_DIRS:
        if '/' in ex:
            if rel == ex or rel.startswith(ex + '/'):
                return True
        elif ex in (parts if is_dir else parts[:-1]):
            return True
    return False


def collect(app_dir, vault_root=None, kind=None, other_vaults=()):
    """(files to zip as relative paths, top-level entries left out), of one kind (None: both). Symlinks
    out of the app and every vault the app knows (when it lives inside the app) are skipped."""
    app_dir = os.path.realpath(app_dir)
    vaults = [os.path.realpath(v) for v in (vault_root, *other_vaults) if v]
    vaults = [v for v in vaults if v != app_dir]
    inside = lambda p: p == app_dir or p.startswith(app_dir + os.sep)
    in_vault = lambda p: any(p == v or p.startswith(v + os.sep) for v in vaults)
    files = []

    def add(abs_path):
        real = os.path.realpath(abs_path)
        if not inside(real) or in_vault(real):
            return
        rel = os.path.relpath(abs_path, app_dir).replace(os.sep, '/')
        if not _skipped(rel) and (kind is None or kind_of(rel) == kind):
            files.append(rel)

    for top in INCLUDE:
        path = os.path.join(app_dir, top)
        if top in NEVER or not os.path.lexists(path):
            continue
        if os.path.isfile(path):
            add(path)
            continue
        for dirpath, dirnames, filenames in os.walk(path):
            rel_dir = os.path.relpath(dirpath, app_dir).replace(os.sep, '/')
            dirnames[:] = sorted(d for d in dirnames
                                 if not _skipped(f'{rel_dir}/{d}', True) and inside(os.path.realpath(os.path.join(dirpath, d)))
                                 and not in_vault(os.path.realpath(os.path.join(dirpath, d))))
            for name in sorted(filenames):
                add(os.path.join(dirpath, name))
    left_out = sorted(e for e in os.listdir(app_dir) if e not in INCLUDE)
    return files, left_out


def collect_vault(app_dir, vault_root):
    """(the vault's real path, its files, its empty folders), relative to it: everything but
    EXCLUDE_FILES/EXCLUDE_DIRS, symlinks out of it, and the app's versions/ (were the vault to hold the
    app, a zip would swallow the zips). Empty folders count: a zip keeps only what is named in it."""
    if not vault_root or not os.path.isdir(vault_root):
        raise ExportError('no vault to export')
    vault = os.path.realpath(vault_root)
    versions = os.path.realpath(os.path.join(app_dir, VERSIONS_DIR))
    inside = lambda p: (p == vault or p.startswith(vault + os.sep)) and not (p == versions or p.startswith(versions + os.sep))
    files, empty = [], []
    for dirpath, dirnames, filenames in os.walk(vault):
        dirnames[:] = sorted(d for d in dirnames
                             if d not in EXCLUDE_DIRS and inside(os.path.realpath(os.path.join(dirpath, d))))
        for name in sorted(filenames):
            path = os.path.join(dirpath, name)
            if name in EXCLUDE_FILES or name.endswith(EXCLUDE_SUFFIXES) or not inside(os.path.realpath(path)):
                continue
            files.append(os.path.relpath(path, vault).replace(os.sep, '/'))
        if dirpath != vault and not dirnames and not filenames:
            empty.append(os.path.relpath(dirpath, vault).replace(os.sep, '/'))
    return vault, files, empty


def _vault_rel(app_dir, vault_root):
    if not vault_root:
        return None
    app, vault = os.path.realpath(app_dir), os.path.realpath(vault_root)
    return os.path.relpath(vault, app).replace(os.sep, '/') if vault.startswith(app + os.sep) else None


def vault_dir(vault_id=None):
    """The folder a vault zip puts everything under."""
    slug = re.sub(r'[^0-9A-Za-z._-]+', '-', vault_id or '').strip('-')
    return f'{VAULT_DIR}-{slug}' if slug else VAULT_DIR


def create(app_dir, note='', vault_root=None, now=None, kind='system', other_vaults=(), vault_id=None, vault_info=None):
    """Writes versions/<name>.zip of one kind and returns its record (what VERSION.json says, plus name and size).
    `vault_root` is the vault of the request (the one a vault zip carries); `other_vaults`, the rest the app knows:
    none of them goes in a system or agents zip. A vault zip's name ends with its vault's id, its files go under
    vault-<id>/, and `vault_info` ({name, structure, disabled_types}) goes in its VERSION.json: enough to register it
    again after unzipping."""
    if kind not in KINDS:
        raise ExportError(f"kind must be one of {', '.join(KINDS)}")
    now = now or datetime.now()
    git = git_info(app_dir)
    host = socket.gethostname().split('.')[0] or 'host'
    if kind == 'vault':
        src, rels, empty = collect_vault(app_dir, vault_root)
        under = vault_dir(vault_id)
        entries = [(os.path.join(src, rel), f'{under}/{rel}') for rel in rels]
        folders = [(os.path.join(src, rel), f'{under}/{rel}/') for rel in empty]
        left_out = []
    else:
        files, left_out = collect(app_dir, vault_root, kind, other_vaults)
        entries = [(os.path.join(app_dir, rel), rel) for rel in files]
        folders = []
    if not entries:
        raise ExportError(f'nothing to export as {kind}')
    slug = lambda s: re.sub(r'[^0-9A-Za-z._-]+', '-', s).strip('-') or 'x'
    name = '-'.join([kind, PREFIX, now.strftime('%Y-%m-%d_%H%M'), *([git['sha']] if git['sha'] else []),
                     *(['dirty'] if git['dirty'] else []), slug(host),
                     *([slug(vault_id)] if kind == 'vault' and vault_id else [])]) + '.zip'
    out_dir = os.path.join(app_dir, VERSIONS_DIR)
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, name)
    n = 2
    while os.path.exists(out):  # two exports in the same minute
        out = os.path.join(out_dir, name.replace('.zip', f'-{n}.zip'))
        n += 1
    meta = {'kind': kind, 'created_at': now.isoformat(timespec='seconds'), 'host': host, 'branch': git['branch'], 'sha': git['sha'],
            'dirty': git['dirty'], 'changes': git['changes'], 'note': str(note or '').strip()[:500],
            'files': len(entries), 'left_out': left_out,
            # the vault in use, when it lives inside the app: kept out of the system and the agents
            **({'vault_root': os.path.realpath(vault_root), 'vault_id': vault_id, 'vault_dir': under,
                **{k: v for k, v in (vault_info or {}).items() if k in ('name', 'structure', 'disabled_types')}} if kind == 'vault'
               else {'vault_left_out': _vault_rel(app_dir, vault_root)})}
    tmp = out + '.part'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('VERSION.json', json.dumps(meta, indent=2, ensure_ascii=False) + '\n')
        for src, arc in entries + folders:  # a folder's path writes a folder entry
            z.write(src, arc)
    os.replace(tmp, out)
    return record(out, meta)


def record(path, meta=None):
    if meta is None:
        try:
            with zipfile.ZipFile(path) as z:
                meta = json.loads(z.read('VERSION.json'))
        except (OSError, KeyError, ValueError, zipfile.BadZipFile):
            meta = {}
    # Before the two kinds, an export was everything: listed with the system.
    return {'kind': 'system', **meta, 'name': os.path.basename(path), 'size': os.path.getsize(path)}


def list_exports(app_dir, now=None):
    d = os.path.join(app_dir, VERSIONS_DIR)
    if not os.path.isdir(d):
        return []
    now = now or datetime.now().timestamp()
    for n in os.listdir(d):  # a zip cut off mid-write never lists: its .part only takes disk
        part = os.path.join(d, n)
        if n.endswith('.zip.part') and NAME_RE.match(n[:-5]):
            try:
                if now - os.path.getmtime(part) > STALE_PART_S:
                    os.remove(part)
            except OSError:
                pass
    names = [n for n in os.listdir(d) if NAME_RE.match(n)]
    return sorted((record(os.path.join(d, n)) for n in names), key=lambda r: r.get('created_at') or r['name'], reverse=True)


def path_of(app_dir, name):
    """The zip's path, for a name the browser sent: only a bare export name, never a path."""
    if not isinstance(name, str) or not NAME_RE.match(name) or '..' in name:
        raise ExportError('not an export name')
    path = os.path.join(app_dir, VERSIONS_DIR, name)
    if not os.path.isfile(path):
        raise ExportError('no such export')
    return path


def delete(app_dir, name):
    os.remove(path_of(app_dir, name))
    return {'ok': True}
