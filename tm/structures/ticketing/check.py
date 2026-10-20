"""Does a folder have the shape of a Ticketing vault? Pure: it reads, never writes (see tm/structures/check.py for
what blocking and warnings mean, and the shape of the answer).

Blocking: a root type folder missing (Tasks, Notes, Meetings, Inbox, Activities, Work log); a top folder that is
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
from ..check import IGNORED_FILES, PLACEHOLDER_RE, _finding, _result, _read_fields
from .definition import DOCS_FOLDER, ID_RE, INDEX_NOTE, OPTIONAL_ROOT_FOLDERS, PROJECT_KEY_RE, ROOT_FOLDERS, SPEC, WORKLOG_FOLDER, BY_FILE_CLASS

SKIP_DIRS = {'node_modules', '__pycache__', ATTACHMENTS_DIR}  # Attachments/: files, never items (tm/attachments.py)


def _project_folders(enabled):
    """The type folders a project must have: the fixed ones, and Hotfixes / PRDs when it enables them."""
    types = ['initiative', 'support', 'plan', 'analysis', 'error', 'learning']
    types += [t for t in ('hotfix', 'prd') if t in enabled]
    return [SPEC[t]['folder'] for t in types]


# Folders a project may lack: made with its first item (a project from before stories and specs has neither).
MAY_LACK = (SPEC['story']['folder'], SPEC['spec']['folder'])


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
            elif name == INDEX_NOTE or name.endswith('.base'):
                pass
            else:
                warnings.append(_finding('loose_file', name, 'A file at the top of the vault: the app ignores it.'))
            continue
        if name in root_folders or name in OPTIONAL_ROOT_FOLDERS.values() or name == DOCS_FOLDER:  # Agents/, Docs/: known when there
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
        enabled = fields.get('enabled_types') if isinstance(fields.get('enabled_types'), list) else ['initiative', 'support']
        wanted = _project_folders(enabled)
        for folder in wanted:
            if not os.path.isdir(os.path.join(full, folder)):
                rel = f'{name}/{folder}'
                missing.append(rel)
                blocking.append(_finding('missing_folder', rel, f'Missing the "{folder}" folder of project {key}.'))
        known_top = {f.split('/')[0] for f in (*_project_folders(['hotfix', 'prd']), *MAY_LACK)} | {DOCS_FOLDER}
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
            if not spec['code']:
                continue  # plans and analyses have no id
            item_id = str(fields.get('id') or '').strip()
            m = ID_RE.match(item_id)
            if not item_id:
                blocking.append(_finding('missing_id', rel, f'A {t} without an id ({prefix}-NNN).'))
            elif not m or m.group(1) != prefix:
                blocking.append(_finding('bad_id', rel, f'Id "{item_id}" is not a valid id here ({prefix}-NNN).'))
            elif item_id in seen_ids:
                blocking.append(_finding('duplicate_id', rel, f'Id "{item_id}" is also used by {seen_ids[item_id]}.'))
            else:
                seen_ids[item_id] = rel
                if not re.match(re.escape(item_id) + r' .+\.md$', name):
                    blocking.append(_finding('bad_name', rel, f'Its file must be named "{item_id} <Title>.md".'))
    return _result(blocking, warnings, missing)
