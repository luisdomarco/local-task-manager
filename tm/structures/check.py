"""Does a folder match its vault structure? A pure function: it reads, never writes.

The app shows a vault only when it matches, and refuses every write while it does not: a vault in an
unexpected shape is where a write lands in the wrong place, or an id is handed out twice. What it finds
comes in two kinds:

- blocking: the vault is not shown and nothing is written. When every blocking finding is a missing
  folder, `can_create_folders` is true and the app offers to create them (and only them).
- warnings: shown, never blocking (a loose file, an item outside its type's folder…).

`spec` describes the structure (see folders_spec): the folders, the item types and their id prefixes,
the other typed files it knows (the work log), the id pattern and the folders it never looks into.

Its `docs` folder, at the top (TSK-039), holds documents, never items: never missing, never unexpected, and nothing in
it is checked, except an item put there, which is a warning (the app does not see it).
"""

import os
import re

from .. import frontmatter as fm

# What a sync client leaves while a file is not downloaded yet: iCloud's `.Name.md.icloud`. The app would
# not see that item, so its id could be handed out again.
PLACEHOLDER_RE = re.compile(r'\.icloud$')
IGNORED_FILES = {'.DS_Store', 'Icon\r', '.gitkeep'}


def folders_spec(folders, item_types, id_re, skip_dirs):
    """The folder-per-type structure: one folder per type (from the vault's `folders`), the work log in its own."""
    return {
        'folders': dict(folders),
        'types': dict(item_types),          # type -> id prefix
        'other_types': {'worklog'},         # typed files that are not items
        'id_re': id_re,
        'skip_dirs': set(skip_dirs),
    }


def _read_fields(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        return fm.parse(fm.split(f.read())[0])


def _finding(kind, path, detail):
    return {'kind': kind, 'path': path, 'detail': detail}


def check(root, spec, load=None):
    """→ {ok, blocking, warnings, missing_folders, can_create_folders}. `load(abs_path) -> fields` reads a
    file's frontmatter (the Store passes its cached reader); paths in the answer are relative to `root`."""
    load = load or _read_fields
    blocking, warnings = [], []

    if not os.path.isdir(root):
        blocking.append(_finding('missing_root', '.', 'The vault folder does not exist.'))
        return _result(blocking, warnings, [])

    # 1. The folders the structure needs. Nested ones ("work/tasks") count from their first segment on.
    wanted = {}  # rel folder -> what it is for
    for kind, rel in spec['folders'].items():
        rel = str(rel or '').strip('/')
        if rel:
            wanted.setdefault(rel, kind)
    # A type whose folder is optional (an agent's) is known when its folder is there, never missing when it is not.
    required = {str(rel or '').strip('/') for kind, rel in spec['folders'].items() if kind not in spec.get('optional', ())}
    missing = sorted(rel for rel in wanted if rel in required and not os.path.isdir(os.path.join(root, rel)))
    for rel in missing:
        blocking.append(_finding('missing_folder', rel, f'Missing the "{wanted[rel]}" folder.'))
    top_level = {rel.split('/')[0] for rel in wanted}
    docs = str(spec.get('docs') or '').strip('/')
    if docs:
        top_level.add(docs)

    # 2. Nothing at the top that the structure does not know: hidden folders (.task-manager, .obsidian, .git)
    #    are the app's or a tool's own and are left alone.
    for name in sorted(os.listdir(root)):
        full = os.path.join(root, name)
        if name.startswith('.') or name in spec['skip_dirs'] or name in IGNORED_FILES:
            continue
        if os.path.isdir(full) and name not in top_level:
            blocking.append(_finding('unexpected_folder', name, 'A folder this structure does not have.'))

    # 3. Every file: its type, its id, where it is.
    folder_of = {t: str(spec['folders'].get(t) or '').strip('/') for t in [*spec['types'], *spec['other_types']]}
    seen_ids = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith('.') and d not in spec['skip_dirs'])
        in_docs = bool(docs) and os.path.relpath(dirpath, root).replace(os.sep, '/').split('/')[0] == docs
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root)
            if in_docs:
                _check_doc(full, rel, name, spec, load, warnings)
                continue
            if PLACEHOLDER_RE.search(name):
                blocking.append(_finding('placeholder', rel, 'Not downloaded from iCloud yet: open the vault in Finder so it downloads.'))
                continue
            if name in IGNORED_FILES or name.startswith('.'):
                continue
            if not name.endswith('.md'):
                warnings.append(_finding('not_markdown', rel, 'Not a Markdown file: the app ignores it.'))
                continue
            try:
                fields = load(full)
            except OSError as e:
                blocking.append(_finding('unreadable', rel, f'Cannot be read: {e}'))
                continue
            t = fields.get('type')
            if not t:
                warnings.append(_finding('untyped', rel, 'No `type` in its frontmatter: the app ignores it.'))
                continue
            if t not in spec['types'] and t not in spec['other_types']:
                blocking.append(_finding('unknown_type', rel, f'Type "{t}" is not part of this structure.'))
                continue
            home = folder_of.get(t)
            if home and not (rel == home or rel.startswith(home + os.sep)):
                warnings.append(_finding('outside_folder', rel, f'A {t} outside the "{home}" folder.'))
            if t not in spec['types']:
                continue
            item_id = fields.get('id')
            if not item_id:
                continue  # an item without an id is fine (Maintenance → assign ids)
            m = spec['id_re'].match(str(item_id))
            if not m or m.group(1) != spec['types'][t]:
                blocking.append(_finding('bad_id', rel, f'Id "{item_id}" is not a valid {t} id ({spec["types"][t]}-…).'))
            elif item_id in seen_ids:
                blocking.append(_finding('duplicate_id', rel, f'Id "{item_id}" is also used by {seen_ids[item_id]}.'))
            else:
                seen_ids[item_id] = rel
    return _result(blocking, warnings, missing)


def _check_doc(full, rel, name, spec, load, warnings):
    """A file in the docs folder is a document: only an item there is pointed out, since the app never shows it."""
    if not name.endswith('.md') or name.startswith('.') or PLACEHOLDER_RE.search(name):
        return
    try:
        t = load(full).get('type')
    except OSError:
        return
    if t in spec['types']:
        warnings.append(_finding('item_in_docs', rel, f'A {t} inside the "{spec["docs"]}" folder: the app does not see it there. Move it to its own folder.'))


def _result(blocking, warnings, missing):
    return {
        'ok': not blocking,
        'blocking': blocking,
        'warnings': warnings,
        'missing_folders': missing,
        'can_create_folders': bool(blocking) and all(f['kind'] == 'missing_folder' for f in blocking),
    }
