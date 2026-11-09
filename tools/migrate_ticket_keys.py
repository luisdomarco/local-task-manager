#!/usr/bin/env python3
"""Rename the outside-ticket keys of a folder-per-type vault (Initiatives, Tasks) to the names every structure uses.

    python3 tools/migrate_ticket_keys.py PATH            # plan: each file and the keys it would rename
    python3 tools/migrate_ticket_keys.py PATH --apply    # rename them in place

The keys are tm/structures/traits.py RENAMED_KEYS (`redmine_id` → `ticket_id`, `redmine_url` → `ticket_url`). Only the
key changes: the line keeps its value and comment, and every other byte of the file stays as it was (tm/frontmatter
rename_keys). A file that already has the new key keeps both lines untouched and is reported, to be fixed by hand.

Nothing here is required: the app reads the old keys under their new names and renames them on an item's next save.
This only does it for every file at once. Run it on a vault folder you have backed up; it never reads config.json.
"""
import argparse
import os
import sys

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_DIR)
from tm import frontmatter as fm  # noqa: E402
from tm.fsutil import atomic_write  # noqa: E402
from tm.structures.traits import RENAMED_KEYS  # noqa: E402


def markdown_files(root):
    """Every .md file under `root`, in a stable order, skipping hidden folders (.task-manager, .trash, .obsidian…)."""
    for here, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if not d.startswith('.'))
        for name in sorted(files):
            if name.endswith('.md'):
                yield os.path.join(here, name)


def plan(root):
    """[(path, new_text, renamed, left)] for each file that has an old key: `left` are the old keys kept because the
    file has their new name already."""
    out = []
    for path in markdown_files(root):
        with open(path, encoding='utf-8', newline='') as f:
            text = f.read()
        head = fm.split(text)[0]
        if head is None:
            continue
        present = set(fm.parse(head))
        old = [k for k in RENAMED_KEYS if k in present]
        if not old:
            continue
        new_text, renamed = fm.rename_keys(text, RENAMED_KEYS)
        out.append((path, new_text, renamed, [k for k in old if k not in renamed]))
    return out


def main(argv=None, out=sys.stdout):
    p = argparse.ArgumentParser(description=__doc__.split('\n', 1)[0])
    p.add_argument('path', help='the vault folder')
    p.add_argument('--apply', action='store_true', help='write the changes (default: only show them)')
    a = p.parse_args(argv)
    root = os.path.abspath(os.path.expanduser(a.path))
    if not os.path.isdir(root):
        raise SystemExit(f'not a folder: {root}')
    changes = plan(root)
    renamed_files = 0
    for path, new_text, renamed, left in changes:
        rel = os.path.relpath(path, root)
        if renamed:
            out.write(f"{rel}: {', '.join(f'{k} → {RENAMED_KEYS[k]}' for k in renamed)}\n")
            renamed_files += 1
            if a.apply:
                atomic_write(path, new_text)
        if left:
            out.write(f"{rel}: left alone, has both {', '.join(f'{k} and {RENAMED_KEYS[k]}' for k in left)}\n")
    verb = 'renamed' if a.apply else 'to rename (run again with --apply)'
    out.write(f'{renamed_files} file(s) {verb}\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
