"""An item's comments as files (TSK-128), in a vault of a structure that keeps them so (Projects: `comments_folder`).

Each comment is one Markdown file, `Comments/<ref>/<at>.md`: a folder per item, named by its id as drawn (TSK-482,
ACME-STY-001; a project by its key), and the file named after the moment it was written, to the millisecond, with
`:` and `.` made `-` (2026-11-16T09:23:45.123 → `2026-11-16T09-23-45-123.md`). Its frontmatter says what it is
(`fileClass: Comment`), the item it is about as a link Obsidian follows (`item: "[[<the item's file>]]"`), `at`, `by`
(`owner`: a person in the app; `agent`: a script, a command) and, once changed, `edited`; its body is the text. The
item's own file is never touched by a comment: Obsidian, git and a sync see one new file per comment.

Neither the app nor a vault check looks inside the folder for items (store.SKIP_DIRS, the checks' skip_dirs). The
file's name is its id: two comments in one millisecond move the second on by one (`next_at`). A deleted comment goes to
`.task-manager/trash/comments/<ref>/`, whence its Undo brings it back. Pure but for reading and writing those files.
"""

import os
import re
from datetime import datetime, timedelta

from . import frontmatter as fm
from .attachments import safe_name
from .fsutil import atomic_write

DIR = 'Comments'
FILE_CLASS = 'Comment'
TRASH = os.path.join('trash', 'comments')  # in the vault's .task-manager
STEM_RE = re.compile(r'^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})$')
AT_RE = re.compile(r'^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$')
_TRIES = 1000  # a millisecond each: more comments than that in one second is not a person


def now_at():
    """The moment a comment is written, to the millisecond: 2026-11-16T09:23:45.123."""
    return datetime.now().isoformat(timespec='milliseconds')


def stem_of(at):
    """The file name (without .md) of a comment written at `at`; a minute or a second alone gets zeros (a comment from
    before, kept in the item's frontmatter, moved here). ValueError for anything that is not a moment."""
    m = AT_RE.match(str(at or '').strip())
    if not m:
        raise ValueError(f'not a moment: {at!r}')
    day, hh, mm, ss, frac = m.groups()
    return f"{day}T{hh}-{mm}-{ss or '00'}-{(frac or '').ljust(3, '0')[:3]}"


def at_of(stem):
    """The moment a comment's file name says (stem_of undone), or None for a name that is not one."""
    m = STEM_RE.match(str(stem or ''))
    return f'{m[1]}T{m[2]}:{m[3]}:{m[4]}.{m[5]}' if m else None


def next_at(at):
    """`at` one millisecond on: the name of a comment whose moment another already has."""
    return (datetime.fromisoformat(at_of(stem_of(at))) + timedelta(milliseconds=1)).isoformat(timespec='milliseconds')


def folder_name(item):
    """The folder of an item's comments: its id as drawn (TSK-482; a project's key), else its file's name, made safe
    (as attachments.owner_folder)."""
    return safe_name(item.get('ref') or item.get('id') or os.path.splitext(os.path.basename(item['path']))[0])


def item_link(item):
    """What a comment's `item:` says: a link to the item's file, by its name, as Obsidian writes one."""
    return f"[[{os.path.splitext(os.path.basename(item['path']))[0]}]]"


def render(link, at, text, by, edited=None):
    """A comment's file."""
    fields = {'fileClass': FILE_CLASS, 'item': link, 'at': at, 'by': by}
    if edited:
        fields['edited'] = edited
    return fm.build(fields, str(text).strip() + '\n')


def parse(text, stem):
    """{id, at, text, by, edited?} of a comment's file named `stem`: its `at` from the frontmatter, else its name."""
    head, body = fm.split(text)
    fields = fm.parse(head) if head is not None else {}
    out = {'id': stem, 'at': str(fields.get('at') or at_of(stem) or ''), 'text': body.strip(), 'by': str(fields.get('by') or '')}
    if fields.get('edited'):
        out['edited'] = str(fields['edited'])
    return out


def read_folder(path):
    """The comments in one item's folder, oldest first ([] when it has none)."""
    out = []
    for name in names(path):
        try:
            with open(os.path.join(path, name), encoding='utf-8', errors='replace') as f:
                out.append(parse(f.read(), name[:-3]))
        except OSError:  # gone meanwhile, or iCloud has not downloaded it
            continue
    return sorted(out, key=lambda c: (c['at'], c['id']))


def write_new(path, link, text, by, at=None):
    """Write a comment into an item's folder `path` (made when missing), never over another: one at the same
    millisecond moves this one on (next_at). → the comment as parse gives it."""
    at = at or now_at()
    os.makedirs(path, exist_ok=True)
    for _ in range(_TRIES):
        stem = stem_of(at)
        try:
            atomic_write(os.path.join(path, stem + '.md'), render(link, at, text, by), exclusive=True)
        except FileExistsError:
            at = next_at(at)
            continue
        return {'id': stem, 'at': at, 'text': str(text).strip(), 'by': by}
    raise FileExistsError(f'no free moment for a comment in {path}')


def summary(root):
    """{folder: {'ats': [at, …] oldest first, 'rev': str}} of every item's comments under `root` (a vault's Comments/),
    from the folders' listings alone: no comment is opened. `rev` changes with any comment added, removed or edited
    (their count and latest change), so a page knows when to read them again."""
    out = {}
    try:
        folders = list(os.scandir(root))
    except OSError:
        return out
    for d in folders:
        if not d.is_dir(follow_symlinks=False) or d.name.startswith('.'):
            continue
        ats, latest = [], 0
        try:
            entries = list(os.scandir(d.path))
        except OSError:
            continue
        for e in entries:
            if not e.name.endswith('.md') or not STEM_RE.match(e.name[:-3]):
                continue
            ats.append(at_of(e.name[:-3]))
            try:
                latest = max(latest, e.stat(follow_symlinks=False).st_mtime_ns)
            except OSError:
                pass
        if ats:
            out[d.name] = {'ats': sorted(ats), 'rev': f'{len(ats)}:{latest}'}
    return out


def names(path):
    """The comments' file names in one item's folder, in order ([] when it has none)."""
    try:
        return sorted(n for n in os.listdir(path) if n.endswith('.md') and STEM_RE.match(n[:-3]))
    except OSError:
        return []
