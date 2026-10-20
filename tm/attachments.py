"""Files attached to an item: where a vault keeps them, what they may be called, and how the app hands them out.

A vault keeps its attachments in one visible folder at its root, `Attachments/`, a folder per item inside it
(`Attachments/TSK-001/screenshot.png`; an item with no id goes by its file's name). The item names its files in its
frontmatter, `attachments: ["Attachments/TSK-001/screenshot.png", …]` — paths relative to the vault, and that list is
what ties a file to an item: the folder only keeps them tidy. Neither the app nor a vault check looks inside the
folder for items (store.SKIP_DIRS, the checks' skip_dirs): an attached .md stays a file, never an item.

Removing one moves it to `.task-manager/trash/attachments/`, never unlinks it. Deleting an item leaves its files where
they are, so a restore finds them. Only purging it (or emptying the trash) deletes them, and only those no other item,
live or deleted, lists. Emptying the trash also deletes the removed ones. A file no item lists is a vault warning
(Store.unlisted_attachments), never blocking.
"""

import os
import re
import unicodedata

DIR = 'Attachments'
MAX_BYTES = 25 * 1024 * 1024  # one file

# Shown in the page (an <img>, the PDF viewer, plain text); anything else is downloaded. Served with a sandbox CSP and
# nosniff (server.py), so even an SVG or a text file opened on its own runs nothing.
INLINE_TYPES = ('image/', 'application/pdf', 'text/plain')

_UNSAFE = re.compile(r'[\x00-\x1f\x7f/\\:*?"<>|]+')
_NAME_MAX = 120


def safe_name(filename):
    """The name a file is kept under: its own, without folders or characters a disk or Obsidian refuses, at most
    _NAME_MAX characters (the extension kept). ValueError when nothing usable is left."""
    name = unicodedata.normalize('NFC', os.path.basename(str(filename or '').replace('\\', '/'))).strip()
    name = _UNSAFE.sub('-', name).strip(' .-')
    if not name or name in ('.', '..'):
        raise ValueError('an attachment needs a file name')
    stem, ext = os.path.splitext(name)
    if len(name) > _NAME_MAX:
        ext = ext[:16]
        name = stem[:_NAME_MAX - len(ext)].rstrip(' .-') + ext
    return name


def owner_folder(item):
    """The folder of an item's files: its id, else its file's name (a plan, an analysis), made safe."""
    return safe_name(item.get('id') or os.path.splitext(os.path.basename(item['path']))[0])


def clean_list(value):
    """An item's `attachments` as the store keeps them: vault-relative paths inside DIR, each once, in order.
    ValueError for anything else (a path out of the folder, ..)."""
    raw = value if isinstance(value, (list, tuple)) else [value] if value else []
    out = []
    for p in raw:
        rel = str(p or '').strip().replace('\\', '/').lstrip('/')
        if not rel:
            continue
        parts = rel.split('/')
        if parts[0] != DIR or len(parts) < 2 or any(x in ('', '.', '..') for x in parts):
            raise ValueError(f'an attachment lives in {DIR}/: {p}')
        if rel not in out:
            out.append(rel)
    return out


def inline(content_type):
    """Whether the page may show it (an image, a PDF, plain text) rather than download it."""
    return any(content_type == t or (t.endswith('/') and content_type.startswith(t)) for t in INLINE_TYPES)
