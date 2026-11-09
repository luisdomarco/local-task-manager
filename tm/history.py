"""What changed on an item, for its Activity tab: its status, priority, dates, plan, outside ticket and local path.

One Markdown file per item, <vault>/.task-manager/history/<its id>.md: a hidden folder, so neither the item scan nor
the vault check sees it, and the item's own file never grows with it (it is also edited in Obsidian). Its frontmatter
keeps the entries, oldest first; its body lists them to be read:

    type: history
    item: TSK-0012
    entries: [{"at": "2026-10-23T09:42:07", "by": "owner", "field": "status", "from": "Todo", "to": "InProgress"}]

The Store writes it on every change it makes (store.update, close_by_rule), whoever asks: the page (`owner`), a
script or a command (`agent`), a structure's rule (`rule`). An edit made outside the app (Obsidian, an editor) is not
seen, so it is not here. `planned` is one field for the three plan keys: the day, else the week, else the month.
"""
import os
import re
import threading

from . import frontmatter as fm
from .fsutil import atomic_write

HISTORY_DIR = 'history'  # in the vault's META_DIR
PLAN_KEYS = ('plan_day', 'plan_week', 'plan_month')
_lock = threading.Lock()


def tracked(structure):
    """The fields whose changes are kept, in the order Activity names them: status, priority, start, due, planned,
    then the outside ticket (tracker, id, url, as the structure names them) and the local path."""
    ext = getattr(structure, 'external_ref', None) or {}
    outside = [ext.get('tracker_key'), ext.get('id_key'), ext.get('url_key')]
    return ['status', 'priority', 'start', 'due', 'planned', *[k for k in outside if k], 'local_path']


def _value(fields, key):
    if key == 'planned':
        return next((fields.get(k) for k in PLAN_KEYS if fields.get(k)), None)
    value = fields.get(key)
    return None if value in ('', [], None) else value


def changes(before, after, keys):
    """[{field, from, to}] for each of `keys` whose value differs between two items' fields (None for empty)."""
    out = []
    for key in keys:
        was, now = _value(before or {}, key), _value(after or {}, key)
        if was != now:
            out.append({'field': key, 'from': was, 'to': now})
    return out


def path_of(meta_root, name):
    """Its file: by the item's id (or its key, for one without), made safe as a file name."""
    return os.path.join(meta_root, HISTORY_DIR, re.sub(r'[^\w.-]+', '_', str(name)) + '.md')


def read(meta_root, name):
    """Its entries, oldest first ([] when it has none, or its file cannot be read)."""
    try:
        with open(path_of(meta_root, name), encoding='utf-8') as f:
            entries = fm.parse(fm.split(f.read())[0]).get('entries')
    except (OSError, ValueError):
        return []
    return [e for e in entries or [] if isinstance(e, dict)]


def _body(name, entries):
    lines = [f'# History of {name}', '']
    for e in entries:
        lines.append(f"- {e.get('at', '')} · {e.get('by', '')} · {e.get('field')}: {e.get('from') or '—'} → {e.get('to') or '—'}")
    return '\n'.join(lines) + '\n'


def record(meta_root, name, found, at, by):
    """Add `found` (changes()'s) to the item's history, at `at` (to the second, as a comment's), by `by`."""
    if not found or not name:
        return
    path = path_of(meta_root, name)
    with _lock:
        entries = read(meta_root, name) + [{'at': at, 'by': by, **c} for c in found]
        os.makedirs(os.path.dirname(path), exist_ok=True)
        atomic_write(path, fm.build({'type': 'history', 'item': str(name), 'entries': entries}, _body(name, entries)))
