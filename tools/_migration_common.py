#!/usr/bin/env python3
"""What the vault migrators share: hashing a source, iCloud placeholders, wikilink and id rewriting, project keys.

Used by `migrate_structures.py` (a folder-per-type vault → Projects) and by `migrate_repo_roadmaps.py` (the
`roadmap/` and `work/` trees of ~/github → a Projects vault). Nothing here reads config.json or knows a vault: the
caller passes paths. Python stdlib only.

Two rules these helpers exist to keep, in both migrators:

- **The source is never written.** `digest()` is how `--apply` and `--check` refuse a source that moved under them.
- **Nothing is half written.** `write_once()` refuses to overwrite, so two items that would land on the same file
  name stop the run instead of silently eating one another.
"""
import hashlib
import os
import re
import sys

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)
from tm import attachments  # noqa: E402
from tm.fsutil import atomic_write  # noqa: E402
from tm.store import META_DIR  # noqa: E402
from tm.structures.check import PLACEHOLDER_RE  # noqa: E402
from tm.structures.ticketing.definition import (DOCS_FOLDER, OPTIONAL_ROOT_FOLDERS, PROJECT_KEY_RE,  # noqa: E402
                                                ROOT_FOLDERS, WORKLOG_FOLDER)

# Files that are noise in any source: they never carry content and would only make a digest flap.
IGNORED = {'.DS_Store', 'Icon\r', '.gitkeep'}
# An id as text: not inside a longer one (WEB-INI-0001 holds INI-0001, which is not an old id there).
OLD_ID_RE = re.compile(r'(?<![\w-])([A-Z]+)-(\d+)\b')
# A wikilink's target: [[Target]], [[Target|alias]], [[Target#heading]] (Obsidian names a note by its file name).
LINK_TARGET_RE = re.compile(r'\[\[([^\]|#\n]+)(?=[\]|#])')
WIKILINK_RE = re.compile(r'\[\[[^\]\n]*\]\]')
# Top-level folders of a Projects vault: no project may be named as one (its folder would be that one).
RESERVED_NAMES = {n.casefold() for n in (*ROOT_FOLDERS.values(), *OPTIONAL_ROOT_FOLDERS.values(), DOCS_FOLDER,
                                         WORKLOG_FOLDER, attachments.DIR, META_DIR)}


def reserved_project_names(structure):
    """Exactly the folder names `Store._check_project_folder` refuses, read from the structure so it cannot drift.

    Wider than RESERVED_NAMES above, which predates the per-project type folders: it also holds `Initiatives`,
    `Stories`, `Specs`, `Support`, `Hotfixes`, `PRDs`, `Plans`, `Analyses` and `Records`, where the tickets in no
    project live. A project named as one of those is refused by the Store with a 400.
    """
    return {n.casefold() for n in (*structure.docs_not_projects, structure.docs_folder)}


class PlanError(Exception):
    """Something the plan or the folders do not allow: said to the user as it is, exit 2."""


def digest(root, skip=()):
    """A hash of every file under `root` (path and bytes): --apply and --check refuse a source that changed.

    `skip`: top-level names not to hash. A live vault needs `('.task-manager',)` — the app rewrites its board,
    its today list and its ids there on its own, so a digest that counts them says "it changed" every time and
    never says anything else. Taking the vault lock writes `.task-manager/.lock`, so even this tool would trip it.
    """
    h = hashlib.sha256()
    skip = {s.rstrip(os.sep) for s in skip}
    for here, dirs, files in os.walk(root):
        if os.path.relpath(here, root) == '.':
            dirs[:] = [d for d in dirs if d not in skip]
        dirs.sort()
        for name in sorted(files):
            if name in IGNORED or (os.path.relpath(here, root) == '.' and name in skip):
                continue
            full = os.path.join(here, name)
            h.update(os.path.relpath(full, root).encode('utf-8') + b'\0')
            with open(full, 'rb') as f:
                for chunk in iter(lambda: f.read(1 << 16), b''):
                    h.update(chunk)
    return h.hexdigest()


def placeholders(root):
    """iCloud files not downloaded yet (`.name.icloud`), anywhere under `root`, hidden folders too: copied as they are,
    they would be stubs in the new vault (an attachment lost, an ids.json read as empty)."""
    out = []
    for here, dirs, files in os.walk(root):
        dirs.sort()
        out += [os.path.relpath(os.path.join(here, f), root) for f in sorted(files) if PLACEHOLDER_RE.search(f)]
    return out


def relink(text, stems):
    """`text` with every wikilink to a file the migration renames pointing at its new name (`stems`: {old: new})."""
    return LINK_TARGET_RE.sub(lambda m: '[[' + stems.get(m.group(1), m.group(1)), text)


def links_to(text, stems):
    """The old names `text` links to."""
    return sorted({m.group(1) for m in LINK_TARGET_RE.finditer(text) if m.group(1) in stems})


def replace_ids(text, ids):
    """`text` with every old id (whole word) as its new one, outside wikilinks (relink renames those by file name)."""
    parts = WIKILINK_RE.split(text)
    links = WIKILINK_RE.findall(text)
    out = [OLD_ID_RE.sub(lambda m: ids.get(m.group(0), m.group(0)), part) for part in parts]
    return ''.join(x for pair in zip(out, [*links, '']) for x in pair)


def key_for(name, taken):
    """2-4 capital letters for a project named `name`, not in `taken`: its words' initials, else its first letters."""
    words = [w for w in re.findall(r'[A-Za-z]+', name.upper())]
    tries = []
    if len(words) >= 2:
        tries.append(''.join(w[0] for w in words)[:4])
    if words:
        tries += [words[0][:n] for n in (3, 4, 2)]
    tries.append('PRJ')
    for k in tries:
        if PROJECT_KEY_RE.match(k) and k not in taken:
            return k
    for a in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ':
        for b in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ':
            if f'P{a}{b}' not in taken:
                return f'P{a}{b}'
    raise PlanError('no project key left')


def counts(items):
    """{type: how many}, sorted: what --check compares against."""
    out = {}
    for it in items:
        out[it['type']] = out.get(it['type'], 0) + 1
    return dict(sorted(out.items()))


def write_once(root, rel, text):
    """Write `rel` under `root`, refusing to overwrite: two items on one file name stop the run."""
    full = os.path.join(root, rel)
    if os.path.exists(full):
        raise PlanError(f'two items would be written to {rel}: rename one in the source first')
    os.makedirs(os.path.dirname(full), exist_ok=True)
    atomic_write(full, text)
    return 1
