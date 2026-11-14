"""An item's versions: a definition (an architecture, an entity) is versioned, and an edit is not a version until one is
cut (the owner's knowledge base: *Esquema B*, a definition is versioned; plans/agent-architecture.md §4).

One folder per item, <vault>/.task-manager/versions/<its id>/, a hidden folder like the history (neither the scan nor
the vault check sees it):

    1.0.md           the item's file as it was when 1.0 was cut, byte for byte (it opens in Obsidian as it was)
    1.1.md
    versions.json    [{"version": "1.1", "at": "2026-11-14T10:02:11", "by": "owner", "note": "…", "title": "…",
                       "entities": {"ENT-12": "2.1"}}, …]   oldest first; `entities` only on an architecture

A snapshot is never edited after, and stays when the item is deleted (ids are never reused: a restored item finds its
versions again). The Store cuts and restores them (Store.cut_version, Store.restore_version), under its write lock.
"""
import difflib
import json
import os
import re

from .fsutil import atomic_write

VERSIONS_DIR = 'versions'  # in the vault's META_DIR
INDEX = 'versions.json'
FIRST = '1.0'
VERSION_RE = re.compile(r'^(\d+)\.(\d+)$')


def parse(version):
    """'1.2' → (1, 2); anything else → None."""
    m = VERSION_RE.match(str(version or '').strip())
    return (int(m.group(1)), int(m.group(2))) if m else None


def bump(version, major=False):
    """The version after `version`: a minor one (1.2 → 1.3) or a major one, which changes a contract (1.2 → 2.0). One
    that is not `major.minor` starts again from 1.0."""
    v = parse(version)
    if not v:
        return FIRST
    return f'{v[0] + 1}.0' if major else f'{v[0]}.{v[1] + 1}'


def folder(meta_root, item_id):
    return os.path.join(meta_root, VERSIONS_DIR, re.sub(r'[^\w.-]+', '_', str(item_id)))


def listing(meta_root, item_id):
    """Its versions, oldest first ([] when it has none, or its index cannot be read)."""
    try:
        with open(os.path.join(folder(meta_root, item_id), INDEX), encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    return [e for e in data if isinstance(e, dict) and parse(e.get('version'))] if isinstance(data, list) else []


def text_of(meta_root, item_id, version):
    """The file as it was at `version`, or None when there is no such snapshot."""
    if not parse(version):
        return None
    try:
        with open(os.path.join(folder(meta_root, item_id), f'{version}.md'), encoding='utf-8') as f:
            return f.read()
    except OSError:
        return None


def record(meta_root, item_id, entry, text):
    """Keep a new version: its snapshot first, then its line in the index (a snapshot without a line is harmless; a
    line without its snapshot would be a version that cannot be read)."""
    where = folder(meta_root, item_id)
    os.makedirs(where, exist_ok=True)
    atomic_write(os.path.join(where, f"{entry['version']}.md"), text)
    entries = [e for e in listing(meta_root, item_id) if e.get('version') != entry['version']] + [entry]
    atomic_write(os.path.join(where, INDEX), json.dumps(entries, ensure_ascii=False, indent=1) + '\n')


def diff(old, new, version):
    """A unified diff (as `git diff` writes it, read by static/js/udiff.js) from `version` to the file as it is now."""
    return ''.join(difflib.unified_diff(old.splitlines(keepends=True), new.splitlines(keepends=True),
                                        fromfile=f'v{version}', tofile='now', n=3))
