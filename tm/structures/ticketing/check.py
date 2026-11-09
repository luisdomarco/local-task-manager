"""Does a folder have the shape of a Ticketing vault? Pure: it reads, never writes (see tm/structures/check.py for
what blocking and warnings mean, and the shape of the answer).

Blocking: a root type folder missing (Tasks, Notes, Meetings, Inbox, Activities, Work log — Agents, Prompts and
Transcriptions may be missing: each is made with its first item); a top folder that is
neither one of those nor a project (a folder with exactly one `00 <Folder>.md` of fileClass Ticket Project and a
valid, unique project_key); a type folder a project needs missing, or one it does not know; a ticket in the
folder of another type; an id that is missing, malformed, of another project or type, or used twice; a ticket
file not named `<ID> <Title>.md`; an iCloud placeholder. Only missing folders can be created by the app. A
project's Stories/ and Specs/ may be missing: each is made with the project's first story or spec.

`Docs/` — at the top and inside a project — holds documents, never items (TSK-039): it is never missing, never
unexpected, and nothing in it is checked, except a ticket put there by hand, which is a warning (the app does not see it).
"""

import os
import re

from ...attachments import DIR as ATTACHMENTS_DIR
from ..check import IGNORED_FILES, PLACEHOLDER_RE, ROOT_GUIDES, _finding, _result, _read_fields
from ..kinds import DEFAULT_KIND, KINDS, PROJECT_FOLDER_TYPES, kind_of
from .. import NUMBER_RE
from .definition import DOCS_FOLDER, ID_RE, INDEX_NOTE, OPTIONAL_ROOT_FOLDERS, PROJECT_KEY_RE, ROOT_FOLDERS, SPEC, WORKLOG_FOLDER, BY_FILE_CLASS

SKIP_DIRS = {'node_modules', '__pycache__', ATTACHMENTS_DIR}  # Attachments/: files, never items (tm/attachments.py)


# Folders a project may lack: made with its first item (a project from before stories and specs has neither).
MAY_LACK = (SPEC['story']['folder'], SPEC['spec']['folder'])


def _project_folders(kind, enabled):
    """The type folders a project must have: those of the types its kind gives it (tm/structures/kinds.py), its
    optional ones only as its enabled_types names them — none when it names none — less those it may lack."""
    return [f for f in (SPEC[t]['folder'] for t in kind_of(kind).project_types(enabled or ())) if f not in MAY_LACK]


# Every folder a project of any kind may have: a project folder holding another is not one of this structure's.
KNOWN_PROJECT_FOLDERS = frozenset(SPEC[t]['folder'] for k in KINDS.values() for t in k.types)


def _check_kind(full, name, key, fields, warnings):
    """Warnings about a project's kind: one its note does not name (or names wrong), which is read as the default; and
    the files of a type its kind has no folder for (a system project's hotfixes, from before kinds decided it), which
    are read but to which nothing new can be added."""
    note = f'{name}/00 {name}.md'
    said = str(fields.get('project_kind') or '').strip()
    if said not in KINDS:
        what = f'project_kind "{said}" is not a kind' if said else 'No project_kind'
        warnings.append(_finding('unknown_kind', note, f'{what} ({", ".join(KINDS)}): read as {DEFAULT_KIND}. '
                                 'Write the one it is in its note; once it names one it is fixed.'))
    kind = kind_of(said)
    for t in PROJECT_FOLDER_TYPES:
        folder = SPEC[t]['folder']
        sub = os.path.join(full, folder)
        if t in kind.types or not os.path.isdir(sub):
            continue
        n = sum(1 for f in os.listdir(sub) if f.endswith('.md'))
        if n:
            warnings.append(_finding('kind_lacks_type', f'{name}/{folder}', f'Project {key} is of kind {kind.id}, which has '
                                     f'no {folder}: its {n} file(s) are read, but no new one can be added.'))


def _check_docs(dirpath, rel_dir, filenames, load, warnings):
    """Files in Docs/ are documents: only a ticket there is pointed out, since the app never shows it."""
    for name in sorted(filenames):
        if not name.endswith('.md') or name.startswith('.') or PLACEHOLDER_RE.search(name):
            continue
        try:
            fields = load(os.path.join(dirpath, name))
        except OSError:
            continue
        t = BY_FILE_CLASS.get(str(fields.get('fileClass') or '').strip())
        if t:
            warnings.append(_finding('item_in_docs', f'{rel_dir}/{name}',
                                     f'A {t} inside a Docs folder: the app does not see it there. Move it to its own folder.'))


def check(root, load=None):
    load = load or _read_fields
    blocking, warnings, missing = [], [], []
    if not os.path.isdir(root):
        blocking.append(_finding('missing_root', '.', 'The vault folder does not exist.'))
        return _result(blocking, warnings, [])

    root_folders = [*ROOT_FOLDERS.values(), WORKLOG_FOLDER]
    for rel in root_folders:
        if not os.path.isdir(os.path.join(root, rel)):
            missing.append(rel)
            blocking.append(_finding('missing_folder', rel, f'Missing the "{rel}" folder.'))

    projects = {}  # folder -> project key
    keys = {}
    for name in sorted(os.listdir(root)):
        full = os.path.join(root, name)
        if name.startswith('.') or name in SKIP_DIRS or name in IGNORED_FILES:
            continue
        if not os.path.isdir(full):
            if PLACEHOLDER_RE.search(name):
                blocking.append(_finding('placeholder', name, 'Not downloaded from iCloud yet: open the vault in Finder so it downloads.'))
            elif name == INDEX_NOTE or name.endswith('.base') or name in ROOT_GUIDES:
                pass
            else:
                warnings.append(_finding('loose_file', name, 'A file at the top of the vault: the app ignores it.'))
            continue
        if name in root_folders or name in OPTIONAL_ROOT_FOLDERS.values() or name == DOCS_FOLDER:  # Agents/, Prompts/, Transcriptions/, Docs/: known when there
            continue
        note = os.path.join(full, f'00 {name}.md')
        fields = None
        if os.path.isfile(note):
            try:
                fields = load(note)
            except OSError as e:
                blocking.append(_finding('unreadable', f'{name}/00 {name}.md', f'Cannot be read: {e}'))
                continue
        if not fields or str(fields.get('fileClass') or '').strip() != 'Ticket Project':
            blocking.append(_finding('unexpected_folder', name,
                                     f'Neither a folder of this structure nor a project (a project has "00 {name}.md" with fileClass: Ticket Project).'))
            continue
        key = str(fields.get('project_key') or '').strip()
        if not PROJECT_KEY_RE.match(key):
            blocking.append(_finding('bad_project', f'{name}/00 {name}.md', f'project_key "{key}" must be 2 to 4 capital letters.'))
            continue
        if key in keys:
            blocking.append(_finding('bad_project', f'{name}/00 {name}.md', f'project_key {key} is also the key of "{keys[key]}".'))
            continue
        keys[key] = name
        projects[name] = key
        enabled = fields.get('enabled_types') if isinstance(fields.get('enabled_types'), list) else None
        wanted = _project_folders(fields.get('project_kind'), enabled)
        for folder in wanted:
            if not os.path.isdir(os.path.join(full, folder)):
                rel = f'{name}/{folder}'
                missing.append(rel)
                blocking.append(_finding('missing_folder', rel, f'Missing the "{folder}" folder of project {key}.'))
        _check_kind(full, name, key, fields, warnings)
        known_top = {f.split('/')[0] for f in KNOWN_PROJECT_FOLDERS} | {DOCS_FOLDER}
        for sub in sorted(os.listdir(full)):
            if sub.startswith('.') or not os.path.isdir(os.path.join(full, sub)):
                continue
            if sub not in known_top:
                blocking.append(_finding('unexpected_folder', f'{name}/{sub}', 'A folder a project does not have.'))

    # Every file: where it is, what it is, its id and its name.
    expected = {}  # type -> function(project folder) -> folder it belongs in
    seen_ids = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith('.') and d not in SKIP_DIRS)
        rel_dir = os.path.relpath(dirpath, root).replace(os.sep, '/')
        if rel_dir == '.':
            continue
        top = rel_dir.split('/')[0]
        if rel_dir.split('/')[:1] == [DOCS_FOLDER] or (top in projects and rel_dir.split('/')[1:2] == [DOCS_FOLDER]):
            _check_docs(dirpath, rel_dir, filenames, load, warnings)
            continue
        for name in sorted(filenames):
            rel = f'{rel_dir}/{name}'
            if PLACEHOLDER_RE.search(name):
                blocking.append(_finding('placeholder', rel, 'Not downloaded from iCloud yet: open the vault in Finder so it downloads.'))
                continue
            if name in IGNORED_FILES or name.startswith('.') or name.endswith('.base'):
                continue
            if not name.endswith('.md'):
                warnings.append(_finding('not_markdown', rel, 'Not a Markdown file: the app ignores it.'))
                continue
            try:
                fields = load(os.path.join(dirpath, name))
            except OSError as e:
                blocking.append(_finding('unreadable', rel, f'Cannot be read: {e}'))
                continue
            if fields.get('type') == 'worklog':
                if rel_dir != WORKLOG_FOLDER and not rel_dir.startswith(WORKLOG_FOLDER + '/'):
                    warnings.append(_finding('outside_folder', rel, f'A work-log day outside "{WORKLOG_FOLDER}".'))
                continue
            t = BY_FILE_CLASS.get(str(fields.get('fileClass') or '').strip())
            if not t:
                warnings.append(_finding('untyped', rel, 'No fileClass of this structure: the app ignores it.'))
                continue
            spec = SPEC[t]
            if spec['scope'] == 'note':
                if top not in projects or rel != f'{top}/00 {top}.md':
                    blocking.append(_finding('wrong_folder', rel, 'A project note outside its own project folder.'))
                continue
            if spec['scope'] == 'root':
                home = spec['folder']
                if rel_dir != home:
                    blocking.append(_finding('wrong_folder', rel, f'A {t} belongs in "{home}".'))
                    continue
                prefix = spec['code']
            else:
                if top not in projects or rel_dir != f"{top}/{spec['folder']}":
                    blocking.append(_finding('wrong_folder', rel, f"A {t} belongs in a project's \"{spec['folder']}\" folder."))
                    continue
                prefix = f"{projects[top]}-{spec['code']}"
            # Its id: a number (a short id, one counter per vault: `id: 482`, the file `STY-482 <Title>.md`) or, in a vault
            # from before short ids, the long one (`ACME-STY-001`, the file named by it).
            item_id = str(fields.get('id') or '').strip()
            if not item_id and spec['legacy_title']:
                continue  # a plan or an analysis from before they had ids: named as it was (tools/migrate_short_ids.py)
            short = bool(NUMBER_RE.match(item_id))
            m = ID_RE.match(item_id)
            if not item_id:
                blocking.append(_finding('missing_id', rel, f"A {t} without an id (a number, drawn {spec['code']}-<n>)."))
            elif not short and (not m or m.group(1) != prefix):
                blocking.append(_finding('bad_id', rel, f"Id \"{item_id}\" is not a valid id here: a number, or {prefix}-NNN from before short ids."))
            elif item_id in seen_ids:
                blocking.append(_finding('duplicate_id', rel, f'Id "{item_id}" is also used by {seen_ids[item_id]}.'))
            else:
                seen_ids[item_id] = rel
                named = f"{spec['code']}-{item_id}" if short else item_id
                if not re.match(re.escape(named) + r' .+\.md$', name):
                    blocking.append(_finding('bad_name', rel, f'Its file must be named "{named} <Title>.md".'))
    return _result(blocking, warnings, missing)
