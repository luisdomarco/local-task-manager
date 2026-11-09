#!/usr/bin/env python3
"""Move a folder-per-type vault (Initiatives or Tasks) to the Projects structure, into a NEW folder.

    python3 tools/migrate_structures.py --plan SOURCE --structure folders|tasks [--out NEW] [--plan-file PLAN]
    python3 tools/migrate_structures.py --apply PLAN [--rewrite-bodies]
    python3 tools/migrate_structures.py --check PLAN

docs/migrate-structures.md is the guide, written for Claude: what to ask the user and in which order.

--plan reads SOURCE and writes PLAN (JSON, by default next to the new folder): the projects it proposes, where each
initiative and story goes, the id map and the questions only the user can answer. Nothing is written into SOURCE.
--apply writes the new vault from PLAN once every project is confirmed and every question answered; it refuses if
SOURCE changed since the plan, or if NEW exists and is not empty. --check reads both and says whether the new vault is
whole: it matches the Projects structure, every item is there, every link resolves, no id is above its high-water
mark, and SOURCE is as it was.

The source is read through the app's own Store; the new files are written through the Projects codec, so they are
what the app would have written. Python stdlib only. It never reads config.json: the caller passes the vault.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_DIR)
from tm import attachments, frontmatter as fm  # noqa: E402
from tm.fsutil import atomic_write  # noqa: E402
from tm.store import META_DIR, Store  # noqa: E402
from tm.structures import REGISTRY  # noqa: E402
from tm.structures.check import PLACEHOLDER_RE  # noqa: E402
from tm.structures.kinds import KINDS  # noqa: E402
from tm.structures.ticketing import codec as tcodec  # noqa: E402
from tm.structures.ticketing.definition import (DOCS_FOLDER, OPTIONAL_ROOT_FOLDERS, PROJECT_KEY_RE, ROOT_FOLDERS,  # noqa: E402
                                                SPEC, WORKLOG_FOLDER)

PLAN_VERSION = 1
TARGET = 'ticketing'
SOURCES = ('folders', 'tasks')
# A priority as the Projects structure names it.
PRIORITY = {'Urgent': 'P0', 'High': 'P1', 'Normal': 'P2', 'Low': 'P3'}
# The one status the Projects structure has not: an item that waits on something is On hold, and says why.
BLOCKED = 'Blocked'
BLOCKED_HOLD = {'by': 'owner', 'why': 'Blocked (migrated)', 'resume_when': ''}
# Types whose id gains the project key (KEY-INI-0001); a story's code changes too (US → STY).
SCOPED = ('initiative', 'story')
# The default project for initiatives (and stories) nothing else places: the user says where they go.
GENERAL = {'key': 'GEN', 'name': 'General'}
# What --apply never carries over from .task-manager: the trash (old files; their ids still count) and backups.
META_SKIPPED = ('trash', 'backup')
META_ID_LISTS = ('pins.md', 'sidebar.md')
IGNORED = {'.DS_Store', 'Icon\r', '.gitkeep'}
# An id as text: not inside a longer one (WEB-INI-0001 holds INI-0001, which is not an old id there).
OLD_ID_RE = re.compile(r'(?<![\w-])([A-Z]+)-(\d+)\b')
# A wikilink's target: [[Target]], [[Target|alias]], [[Target#heading]] (Obsidian names a note by its file name).
LINK_TARGET_RE = re.compile(r'\[\[([^\]|#\n]+)(?=[\]|#])')
WIKILINK_RE = re.compile(r'\[\[[^\]\n]*\]\]')
# Top-level folders of a Projects vault: no project may be named as one (its folder would be that one).
RESERVED_NAMES = {n.casefold() for n in (*ROOT_FOLDERS.values(), *OPTIONAL_ROOT_FOLDERS.values(), DOCS_FOLDER, WORKLOG_FOLDER,
                                         attachments.DIR, META_DIR)}


class PlanError(Exception):
    """Something the plan or the folders do not allow: said to the user as it is, exit 2."""


# ── reading the source ───────────────────────────────────────────────────────

def source_store(path, structure, folders=None):
    return Store(path, folders=folders or None, structure=REGISTRY[structure])


def body_of(store, it):
    return store._read(store.abs(it['path']))[1]


def digest(root):
    """A hash of every file under `root` (path and bytes): --apply and --check refuse a source that changed."""
    h = hashlib.sha256()
    for here, dirs, files in os.walk(root):
        dirs.sort()
        for name in sorted(files):
            if name in IGNORED:
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


def old_stem(it):
    """The name an item's file has in SOURCE, without .md: what a wikilink to it says."""
    return os.path.splitext(os.path.basename(it['path']))[0]


def relink(text, stems):
    """`text` with every wikilink to a file SOURCE renames pointing at its new name (`stems`: {old: new})."""
    return LINK_TARGET_RE.sub(lambda m: '[[' + stems.get(m.group(1), m.group(1)), text)


def links_to(text, stems):
    """The old names `text` links to."""
    return sorted({m.group(1) for m in LINK_TARGET_RE.finditer(text) if m.group(1) in stems})


def high_water(store, items, days):
    """{old prefix: highest number it ever used}: live items, the trash, the work log, converted inbox items and
    ids.json. The new vault's marks start there, so no id is handed out twice."""
    marks = dict(store._id_marks())
    used = [*(it['id'] for it in items), *(it['fields'].get('converted_from') for it in items), *store._trashed_ids(),
            *(e.get('id') for _, f in days.values() for e in f.get('entries') or [] if isinstance(e, dict))]
    for i in used:
        m = store.structure.id_re.match(str(i or ''))
        if m:
            marks[m.group(1)] = max(marks.get(m.group(1), 0), int(m.group(2)))
    return marks


def loose_files(store, items, days, structure):
    """Files of SOURCE that are no item, work-log day, doc or attachment: --apply leaves them out (listed in the plan)."""
    known = {it['path'] for it in items} | {os.path.relpath(p, store.root) for p, _ in days.values()}
    docs = store.folders.get('docs', 'docs')
    out = []
    for here, dirs, files in os.walk(store.root):
        rel_dir = os.path.relpath(here, store.root)
        top = rel_dir.split(os.sep)[0]
        if top in (META_DIR, docs, attachments.DIR):
            dirs[:] = []
            continue
        if rel_dir == '.':
            out += [f'{d}/' for d in sorted(dirs) if d.startswith('.') and d != META_DIR]
            dirs[:] = [d for d in dirs if not d.startswith('.')]
        for name in sorted(files):
            rel = os.path.normpath(os.path.join(rel_dir, name))
            if name not in IGNORED and rel not in known:
                out.append(rel)
    return out


# ── the plan ─────────────────────────────────────────────────────────────────

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


def ancestors(it, by_id):
    """The items `it` hangs from, nearest first (a loop is cut where it closes)."""
    out, seen = [], {it['id']}
    cur = by_id.get(it['fields'].get('related_to'))
    while cur and cur['id'] not in seen:
        out.append(cur)
        seen.add(cur['id'])
        cur = by_id.get(cur['fields'].get('related_to'))
    return out


def top_initiative(it, by_id):
    """The initiative at the top of `it`'s initiatives (itself when it hangs from none)."""
    top = it if it['type'] == 'initiative' else None
    for a in ancestors(it, by_id):
        if a['type'] == 'initiative':
            top = a
    return top


def make_plan(source, structure, target=None, folders=None):
    """The plan for moving SOURCE (a vault of `structure`) to TARGET: a dict, written as JSON by --plan."""
    if structure not in SOURCES:
        raise PlanError(f'--structure must be one of {", ".join(SOURCES)}')
    source = os.path.realpath(os.path.expanduser(source))
    if not os.path.isdir(source):
        raise PlanError(f'not a folder: {source}')
    target = os.path.realpath(os.path.expanduser(target or f'{source.rstrip(os.sep)}-projects'))
    if target == source or target.startswith(source + os.sep):
        raise PlanError('the new vault cannot be the source folder or inside it')
    stubs = placeholders(source)
    if stubs:
        raise PlanError(f'{source} has files not downloaded from iCloud yet (open the folder in Finder, or right-click → '
                        f'Download Now, then plan again): {", ".join(stubs[:5])}{" …" if len(stubs) > 5 else ""}')
    store = source_store(source, structure, folders)
    found = store.check()
    if not found.get('ok', True) and found.get('blocking'):
        raise PlanError(f'{source} does not match the {structure} structure: ' + '; '.join(
            f"{b['path']}: {b['detail']}" for b in found['blocking'][:5]))
    items, days = store.scan()
    no_id = [it['path'] for it in items if not it['id']]
    if no_id:
        raise PlanError('items without an id (give them one in the app: Settings → Maintenance → assign ids, then plan '
                        f'again): {", ".join(no_id[:5])}{" …" if len(no_id) > 5 else ""}')
    by_id = {it['id']: it for it in items if it['id']}
    projects, assign, questions = [], {}, []
    taken = set()

    def add_project(name, kind, source_id, why, key=None):
        k = key if key and PROJECT_KEY_RE.match(key) and key not in taken else key_for(name, taken)
        taken.add(k)
        projects.append({'key': k, 'name': tcodec.safe_title(name), 'kind': kind, 'from': source_id, 'confirmed': False, 'why': why})
        return k

    inis = [it for it in items if it['type'] == 'initiative']
    stories = [it for it in items if it['type'] == 'story']
    if structure == 'tasks':
        # Each project becomes a project of its own, by its key (a Tasks key is already 2-4 capital letters).
        for p in sorted((it for it in items if it['type'] == 'project'), key=lambda i: i['id'] or ''):
            add_project(p['title'], 'simple', p['id'], 'a project of the Tasks vault', key=p['fields'].get('project_key'))
        by_key = {p['fields'].get('project_key'): next(x['key'] for x in projects if x['from'] == p['id'])
                  for p in items if p['type'] == 'project'}
        for ini in inis:
            top = top_initiative(ini, by_id)
            home = by_key.get(ini['fields'].get('project')) or by_key.get(top['fields'].get('project'))
            if home:
                assign[ini['id']] = home
    else:
        # An initiative with sub-initiatives (its epics) proposes a project; its tree goes there.
        for top in sorted(inis, key=lambda i: i['id'] or ''):
            if top_initiative(top, by_id) is not top:
                continue
            tree = [i for i in items if i['type'] in SCOPED and top_initiative(i, by_id) is top]
            if any(i['type'] == 'initiative' and i is not top for i in tree):
                kind = 'product' if any(i['type'] == 'story' for i in tree) else 'simple'
                k = add_project(top['title'], kind, top['id'], f"{top['id']} has sub-initiatives: it and they become this project's initiatives")
                for i in tree:
                    if i['type'] == 'initiative':
                        assign[i['id']] = k
    # What nothing placed goes to General, and the user is asked.
    for ini in sorted(inis, key=lambda i: i['id'] or ''):
        if ini['id'] not in assign:
            top = top_initiative(ini, by_id)
            if top is not ini and top['id'] in assign:
                assign[ini['id']] = assign[top['id']]
    loose = sorted((i for i in inis if i['id'] not in assign), key=lambda i: i['id'] or '')
    for st in stories:
        ini = next((a for a in ancestors(st, by_id) if a['type'] == 'initiative'), None)
        if ini and ini['id'] in assign:
            assign[st['id']] = assign[ini['id']]
    loose_stories = [s for s in stories if s['id'] not in assign]
    if loose or loose_stories:
        has_stories = bool(loose_stories) or any(s for s in stories if any(a in loose for a in ancestors(s, by_id)))
        g = add_project(GENERAL['name'], 'product' if has_stories else 'simple', None,
                        'initiatives (and stories) no project took', key=GENERAL['key'])
        for i in loose:
            assign[i['id']] = g
            questions.append({'about': i['id'], 'ask': f"Which project does {i['id']} “{i['title']}” go to? (proposed: {g})",
                              'answered': False})
        for s in stories:
            if s['id'] not in assign:
                ini = next((a for a in ancestors(s, by_id) if a['type'] == 'initiative'), None)
                assign[s['id']] = assign.get(ini['id'], g) if ini else g
                if not ini:
                    questions.append({'about': s['id'], 'ask': f"{s['id']} “{s['title']}” hangs from no initiative: which project does it go to? "
                                      f'(proposed: {g}; it will hang from no initiative there either)', 'answered': False})
    # A status the Projects structure does not have (one the vault added: Waiting…; Blocked is On hold): the user says
    # which of its statuses each becomes.
    projects_structure = REGISTRY[TARGET]
    status_map = {}
    for it in items:
        st = it['fields'].get('status')
        if st and st != BLOCKED and it['type'] in projects_structure.types and st not in projects_structure.statuses_of(it['type']):
            status_map.setdefault(st, None)
    for st in sorted(status_map):
        users = sorted({it['type'] for it in items if it['fields'].get('status') == st})
        questions.append({'about': f'status {st}', 'ask': f"Which status does “{st}” become (on {', '.join(users)}: one of "
                          f"{', '.join(dict.fromkeys(x for t in users for x in projects_structure.statuses_of(t)))})? Write it in status_map.",
                          'answered': False})
    plan = {
        'version': PLAN_VERSION,
        'source': source, 'structure': structure, 'folders': folders or {},
        'target': target,
        'source_digest': digest(source),
        'projects': projects,
        'assign': dict(sorted(assign.items())),
        'questions': questions,
        'counts': counts(items),
        'high_water': high_water(store, items, days),
        'not_migrated': loose_files(store, items, days, structure),
    }
    plan['status_map'] = status_map
    plan['id_map'] = id_map(plan, items)
    plan['mentions'] = mentions(store, items, plan['id_map'])
    # A title is a file name in the Projects structure: what it cannot hold (: / ? # [ ] …) is dropped, and the title as
    # it was is kept in the item's aliases.
    plan['retitled'] = [{'id': it['id'], 'title': it['title'], 'as': tcodec.safe_title(it['title'])} for it in items
                        if it['type'] != 'project' and tcodec.safe_title(it['title']) != it['title']]
    stems = {old_stem(it): None for it in items}
    plan['linked'] = sum(1 for it in items if links_to(body_of(store, it), stems))
    return plan


def counts(items):
    out = {}
    for it in items:
        out[it['type']] = out.get(it['type'], 0) + 1
    return dict(sorted(out.items()))


def new_id(old, item_type, project):
    """INI-0001 → WEB-INI-0001, US-0003 → WEB-STY-0003 (the number kept, the key put in front); others unchanged."""
    m = re.match(r'^[A-Z]+-(\d+)$', old or '')
    if item_type in SCOPED and m:
        return f"{project}-{SPEC[item_type]['code']}-{m.group(1)}"
    return old


def id_map(plan, items):
    """{old id: new id} for every item whose id changes; a Tasks project's id names its key."""
    out = {}
    projects = {p['from']: p['key'] for p in plan['projects'] if p.get('from')}
    for it in items:
        if not it['id']:
            continue
        if it['type'] == 'project':
            out[it['id']] = projects.get(it['id'], it['id'])
        elif it['type'] in SCOPED:
            out[it['id']] = new_id(it['id'], it['type'], plan['assign'].get(it['id']))
    return {k: v for k, v in sorted(out.items()) if k != v}


def replace_ids(text, ids):
    """`text` with every old id (whole word) as its new one, outside wikilinks (relink renames those by file name)."""
    parts = WIKILINK_RE.split(text)
    links = WIKILINK_RE.findall(text)
    out = [OLD_ID_RE.sub(lambda m: ids.get(m.group(0), m.group(0)), part) for part in parts]
    return ''.join(x for pair in zip(out, [*links, '']) for x in pair)


def mentions(store, items, ids):
    """Bodies that name an old id that changes: listed, left as written unless --rewrite-bodies."""
    out = []
    for it in items:
        found = sorted({m.group(0) for m in OLD_ID_RE.finditer(body_of(store, it)) if m.group(0) in ids})
        if found:
            out.append({'path': it['path'], 'ids': found})
    return out


def validate(plan):
    """Refuses a plan that is not ready: unconfirmed projects, open questions, bad keys, kinds or names, a status with
    nowhere to go, a story in a project of a kind without stories (validate_items: an item with no project, a story in
    another project than its initiative)."""
    if plan.get('version') != PLAN_VERSION:
        raise PlanError(f'not a plan of this tool (version {plan.get("version")})')
    keys = [p['key'] for p in plan['projects']]
    bad = [k for k in keys if not PROJECT_KEY_RE.match(str(k))]
    if bad:
        raise PlanError(f'a project key is 2 to 4 capital letters: {", ".join(map(str, bad))}')
    if len(set(keys)) != len(keys):
        raise PlanError('two projects share a key')
    names = [tcodec.safe_title(p['name']).casefold() for p in plan['projects']]
    if len(set(names)) != len(names):  # casefolded: on macOS "Web" and "web" are one folder
        raise PlanError('two projects share a name (each is a folder; capitals do not count)')
    reserved = [p['name'] for p in plan['projects'] if tcodec.safe_title(p['name']).casefold() in RESERVED_NAMES]
    if reserved:
        raise PlanError(f'a project cannot be named as a folder of the vault (Tasks, Notes, Docs…): {", ".join(reserved)}')
    for p in plan['projects']:
        if p['kind'] not in KINDS:
            raise PlanError(f"{p['key']}: kind must be one of {', '.join(KINDS)}")
    todo = [p['key'] for p in plan['projects'] if not p.get('confirmed')]
    if todo:
        raise PlanError(f'ask the user about these projects and set "confirmed": true: {", ".join(todo)}')
    open_q = [q['about'] for q in plan['questions'] if not q.get('answered')]
    if open_q:
        raise PlanError(f'answer these questions with the user and set "answered": true: {", ".join(open_q)}')
    statuses = set(REGISTRY[TARGET].statuses) | {s for t in REGISTRY[TARGET].types.values() for s in (t.statuses or ())}
    unmapped = [k for k, v in (plan.get('status_map') or {}).items() if v not in statuses]
    if unmapped:
        raise PlanError(f'status_map: say which status each of these becomes: {", ".join(unmapped)}')
    kind = {p['key']: KINDS[p['kind']] for p in plan['projects']}
    for old, k in plan['assign'].items():
        if k not in kind:
            raise PlanError(f'{old} goes to {k}, which is not one of the projects')
        t = 'story' if old.startswith('US-') else 'initiative'
        if t not in kind[k].types:
            raise PlanError(f'{old} is a {t}, and a project of kind {kind[k].id} ({k}) has none')


def validate_items(plan, items, by_id):
    """What the plan says of the items themselves: every initiative and story has a project, a story the one of its
    initiative, and every mapped status is one its type has."""
    assign = plan['assign']
    missing = [it['id'] for it in items if it['type'] in SCOPED and it['id'] not in assign]
    if missing:
        raise PlanError(f'assign: say which project these go to: {", ".join(missing[:10])}')
    for it in items:
        if it['type'] != 'story':
            continue
        ini = next((a for a in ancestors(it, by_id) if a['type'] == 'initiative'), None)
        if ini and assign[ini['id']] != assign[it['id']]:
            raise PlanError(f"{it['id']} goes to {assign[it['id']]} and its initiative {ini['id']} to {assign[ini['id']]}: "
                            'a story goes to the project of its initiative')
    smap = plan.get('status_map') or {}
    for it in items:
        st = smap.get(it['fields'].get('status'))
        if st and st not in REGISTRY[TARGET].statuses_of(it['type']):
            raise PlanError(f"status_map: {it['id']} is a {it['type']}, which has no status {st}")


# ── writing the new vault ────────────────────────────────────────────────────

def _empty(v):
    return v is None or v == '' or v == [] or v == {}


def _stem(item_type, item_id, subject, stamp):
    return os.path.splitext(tcodec.TicketingCodec().file_name(item_type, item_id, subject, stamp))[0]


def item_values(it, ids, project, project_of_key, by_id, status_map=None):
    """The source item's fields as the Projects structure keeps them (still ids: the codec writes the links)."""
    f = it['fields']
    t = it['type']
    v = {k: x for k, x in f.items() if k not in ('id', 'type', 'subject', 'title', 'project', 'project_key', 'completed_at',
                                                  'related_to', 'relations', 'relation_kinds', 'priority', 'status')
         and not k.startswith('_') and not _empty(x)}
    if f.get('priority') in PRIORITY and 'priority' in REGISTRY[TARGET].types[t].fields:
        v['priority'] = PRIORITY[f['priority']]
    status = f.get('status')
    if status:
        status = (status_map or {}).get(status) or status
        if status == BLOCKED:
            status = 'OnHold'
            hold = f.get('on_hold') if isinstance(f.get('on_hold'), dict) else {}
            v['on_hold'] = {**BLOCKED_HOLD, **{k: x for k, x in hold.items() if x}}
        v['status'] = status
    parent = f.get('related_to')
    relations = [ids.get(r, r) for r in (f.get('relations') or [])]
    kinds = {ids.get(k, k): x for k, x in (f.get('relation_kinds') or {}).items() if x != 'relates'}
    if parent and by_id.get(parent, {}).get('type') == 'initiative' and t == 'initiative':
        # An epic: the Projects structure has no sub-initiatives. It relates to the one it hung from.
        relations.append(ids.get(parent, parent))
        parent = None
    if parent:
        v['related_to'] = ids.get(parent, parent)
    # "Blocked by" towards a type its depends_on takes is kept there, as the app writes it.
    dep = next((p for p in REGISTRY[TARGET].types[t].props if p['key'] == 'depends_on'), None)
    if dep:
        new_types = {ids.get(i['id'], i['id']): i['type'] for i in by_id.values()}
        blocked = [r for r in relations if kinds.get(r) == 'blocked' and new_types.get(r) in (dep.get('types') or ())]
        if blocked:
            v['depends_on'] = [*(v.get('depends_on') or []), *blocked]
            relations = [r for r in relations if r not in blocked]
            kinds = {k: x for k, x in kinds.items() if k not in blocked}
    if relations:
        v['relations'] = list(dict.fromkeys(relations))
    kinds = {k: x for k, x in kinds.items() if k in relations}
    if kinds:
        v['relation_kinds'] = kinds
    if f.get('converted_from'):
        v['converted_from'] = ids.get(f['converted_from'], f['converted_from'])
    if project:
        v['project'] = project
    keep = []
    if it['id'] and ids.get(it['id'], it['id']) != it['id']:
        keep.append(it['id'])  # its old id: a search for it still finds it
    if t != 'project' and tcodec.safe_title(it['title']) != it['title']:
        keep.append(it['title'])  # its title as it was, before the file name dropped what it cannot hold
    if keep:  # where the format keeps them (`aliases`, as Obsidian reads it)
        v['aliases'] = [*(x for x in (f.get('aliases') or []) if x not in keep), *keep]
    return v


def apply_plan(plan, rewrite_bodies=False, out=sys.stdout):
    """Writes the new vault the plan describes. → the number of files written. It is written in a folder of its own
    next to it (`<new>.partial`) and moved into place only once whole: an error leaves nothing behind."""
    validate(plan)
    source, final = plan['source'], plan['target']
    if digest(source) != plan['source_digest']:
        raise PlanError(f'{source} changed since the plan: run --plan again')
    if os.path.exists(final) and os.listdir(final):
        raise PlanError(f'{final} exists and is not empty: the new vault goes in a new folder')
    partial = final.rstrip(os.sep) + '.partial'
    if os.path.lexists(partial):
        raise PlanError(f'{partial} is left from a run that stopped: delete it, then apply again')
    store = source_store(source, plan['structure'], plan.get('folders'))
    items, days = store.scan()
    by_id = {it['id']: it for it in items if it['id']}
    validate_items(plan, items, by_id)
    try:
        written = _apply(plan, store, items, days, by_id, partial, rewrite_bodies)
        if os.path.isdir(final):
            os.rmdir(final)  # empty (checked above)
        os.rename(partial, final)
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise
    print(f'Wrote {written} files to {final}', file=out)
    return written


def _apply(plan, store, items, days, by_id, target, rewrite_bodies):
    source = plan['source']
    ids = id_map(plan, items)
    codec = tcodec.TicketingCodec()
    stamp = datetime.now().strftime('%Y-%m-%dT%H:%M')
    projects = {p['key']: p for p in plan['projects']}
    tasks_projects = {it['fields'].get('project_key'): ids.get(it['id'], it['id']) for it in items if it['type'] == 'project'}

    # Who is who before anything is written: each project's note and folder, each item's new file name.
    r = tcodec.Resolver()
    for key, p in projects.items():
        name = tcodec.safe_title(p['name'])
        r.projects[key] = {'stem': f'00 {name}', 'dir': name, 'name': name, 'fields': {}}
        r.project_by_stem[f'00 {name}'] = key
        r.project_by_dir[name] = key
        r.key_to_stem[key] = f'00 {name}'
    def project_of(it):
        if it['type'] in SCOPED:
            return plan['assign'][it['id']]
        own = it['fields'].get('project')
        if own:
            return tasks_projects.get(own) if tasks_projects.get(own) in projects else None
        for a in ancestors(it, by_id):  # a task, a note…: the project of what it hangs from
            if a['type'] in SCOPED:
                return plan['assign'][a['id']]
            if a['fields'].get('project') and tasks_projects.get(a['fields']['project']) in projects:
                return tasks_projects[a['fields']['project']]
        return None

    work = [it for it in items if it['type'] != 'project']
    stems = {}  # {old file name: new}, for the wikilinks that name them
    for it in work:
        nid = ids.get(it['id'], it['id'])
        stem = _stem(it['type'], nid, it['title'], it['fields'].get('created_at') or stamp)
        r.key_to_stem[nid] = stem
        r.stem_to_key[stem] = nid
        stems[old_stem(it)] = stem
    src_projects = {it['id']: it for it in items if it['type'] == 'project'}
    for p in projects.values():
        if src_projects.get(p.get('from')):
            stems[old_stem(src_projects[p['from']])] = f"00 {tcodec.safe_title(p['name'])}"
    stems = {k: v for k, v in stems.items() if k != v}

    def text_of(text):  # a body, a day, a doc: its ids (when asked) and its wikilinks as the new vault names them
        return relink(replace_ids(text, ids) if rewrite_bodies else text, stems)

    written = 0
    os.makedirs(target, exist_ok=True)
    for folder in [*ROOT_FOLDERS.values(), WORKLOG_FOLDER]:
        os.makedirs(os.path.join(target, folder), exist_ok=True)

    # The projects: a note from the template (a Tasks project's text and fields carried over) and its type folders.
    smap = plan.get('status_map') or {}
    for key, p in projects.items():
        kind = KINDS[p['kind']]
        src = src_projects.get(p.get('from'))
        vals = item_values(src, ids, None, tasks_projects, by_id, smap) if src else {}
        vals.pop('aliases', None)
        vals['enabled_types'] = kind.default_enabled()
        rel, text = codec.new_file('project', p['name'], vals, text_of(body_of(store, src)) if src else '', r, None, stamp)
        text = fm.drop(text, kind.hidden.get('project', ()))  # the settings its kind has no use for
        text = fm.patch(text, {'project_key': key, 'project_kind': kind.id, **({'aliases': [src['id']]} if src else {})})
        for sub in codec.project_folders(kind.id, vals['enabled_types']):
            os.makedirs(os.path.join(target, r.projects[key]['dir'], sub), exist_ok=True)
        written += _write(target, rel, text)

    # Every other item: its template's frontmatter, patched with its fields; its body as it was.
    for it in work:
        t = it['type']
        nid = ids.get(it['id'], it['id'])
        vals = item_values(it, ids, project_of(it), tasks_projects, by_id, smap)
        rel, text = codec.new_file(t, it['title'], vals, '', r, nid, it['fields'].get('created_at') or stamp)
        body = text_of(body_of(store, it))
        head = text[:len(text) - len(fm.split(text)[1])]
        text = head + (body if body.startswith('\n') or not body else '\n' + body)
        status_key = SPEC[t]['status_key']
        done = it['fields'].get('completed_at')
        if done and status_key and vals.get('status'):
            text = fm.patch(text, {'status_log': [{'date': str(done)[:10], 'from': '', 'to': tcodec.disk_status(t, vals['status']),
                                                   'by': 'migration'}]})
        written += _write(target, rel, text)

    # The work log: each day where the Projects vault keeps it, its ids renamed.
    for date, (path, _) in sorted(days.items()):
        rel = os.path.relpath(path, store.root)
        sub = os.path.join(*rel.split(os.sep)[1:]) if os.sep in rel else os.path.basename(rel)
        with open(path, encoding='utf-8') as f:
            written += _write(target, os.path.join(WORKLOG_FOLDER, sub), relink(replace_ids(f.read(), {**ids, **_project_ids(items, ids)}), stems))
    # Docs and attachments, as they are; a doc's wikilinks to an item renamed follow it.
    docs = store.folders.get('docs', 'docs')
    for src_dir, dst_dir in ((docs, DOCS_FOLDER), (attachments.DIR, attachments.DIR)):
        if os.path.isdir(os.path.join(source, src_dir)):
            shutil.copytree(os.path.join(source, src_dir), os.path.join(target, dst_dir), dirs_exist_ok=True)
    for here, _, files in os.walk(os.path.join(target, DOCS_FOLDER)):
        for name in files:
            if name.endswith('.md'):
                full = os.path.join(here, name)
                with open(full, encoding='utf-8') as f:
                    before = f.read()
                after = relink(before, stems)
                if after != before:
                    atomic_write(full, after)
    written += _meta(source, target, plan, items, ids)
    return written


def _project_ids(items, ids):
    """A Tasks project named by its id in the work log (PRJ-0001) is named by its key there."""
    return {it['id']: ids.get(it['id'], it['id']) for it in items if it['type'] == 'project' and it['id']}


def _write(root, rel, text):
    full = os.path.join(root, rel)
    if os.path.exists(full):
        raise PlanError(f'two items would be written to {rel}: rename one in the source first')
    os.makedirs(os.path.dirname(full), exist_ok=True)
    atomic_write(full, text)
    return 1


def _meta(source, target, plan, items, ids):
    """.task-manager: ids.json rebuilt from the high-water marks, pins and sidebar through the id map, the board's
    lists without Blocked, statuses.json down to its colours, each history under its new id, the rest copied; and
    legacy-ids.json, the id map."""
    src, dst = os.path.join(source, META_DIR), os.path.join(target, META_DIR)
    os.makedirs(dst, exist_ok=True)
    n = 0
    hw = plan['high_water']
    # A root type keeps its prefix (TSK); an initiative's and a story's are each project's (WEB-INI), all starting at
    # the old mark, so a number is never handed out again in any of them. A Tasks project's (PRJ) has no ids any more.
    marks = {old: top for old, top in hw.items() if old not in ('INI', 'US', 'PRJ')}
    for p in plan['projects']:
        for t, old in (('initiative', 'INI'), ('story', 'US')):
            if hw.get(old):
                marks[f"{p['key']}-{SPEC[t]['code']}"] = hw[old]
    n += _write(dst, 'ids.json', json.dumps(dict(sorted(marks.items())), indent=2) + '\n')
    n += _write(dst, 'legacy-ids.json', json.dumps(ids, indent=2, ensure_ascii=False) + '\n')
    if not os.path.isdir(src):
        return n
    for name in sorted(os.listdir(src)):
        full = os.path.join(src, name)
        if name in IGNORED or name in META_SKIPPED or name in ('ids.json',):
            continue
        if name == 'history' and os.path.isdir(full):
            for h in sorted(os.listdir(full)):
                stem, ext = os.path.splitext(h)
                with open(os.path.join(full, h), encoding='utf-8') as f:
                    n += _write(dst, os.path.join('history', f'{ids.get(stem, stem)}{ext}'), f.read())
            continue
        if os.path.isdir(full):
            shutil.copytree(full, os.path.join(dst, name))
            continue
        with open(full, encoding='utf-8', errors='replace') as f:
            text = f.read()
        if name in META_ID_LISTS:
            text = replace_ids(text, {**ids, **_project_ids(items, ids)})
        elif name == 'board.md':
            text = _board(text)
        elif name == 'statuses.json':
            try:
                colors = (json.loads(text) or {}).get('colors') or {}
            except ValueError:
                colors = {}
            statuses = set(REGISTRY[TARGET].statuses)
            text = json.dumps({'colors': {k: v for k, v in colors.items() if k in statuses}}, indent=2) + '\n'
        n += _write(dst, name, text)
    return n


def _board(text):
    """The Board's lists, the Blocked one dropped (its cards are On hold now), or renamed when there is no On hold."""
    head, body = fm.split(text)
    lists = fm.parse(head).get('lists') if head is not None else None
    if not isinstance(lists, list):
        return text
    has_hold = any(isinstance(l, dict) and l.get('status') == 'OnHold' for l in lists)
    out = []
    for l in lists:
        if isinstance(l, dict) and l.get('status') == BLOCKED:
            if has_hold:
                continue
            l = {**l, 'status': 'OnHold'}
        out.append(l)
    return fm.patch(text, {'lists': out})


# ── checking it ──────────────────────────────────────────────────────────────

def check(plan, out=sys.stdout):
    """→ the problems found ([] when the new vault is whole), each printed."""
    problems = []
    source, target = plan['source'], plan['target']
    if digest(source) != plan['source_digest']:
        problems.append(f'{source} changed since the plan')
    new = Store(target, structure=REGISTRY[TARGET])
    found = new.check()
    problems += [f"structure: {b['path']}: {b['detail']}" for b in found.get('blocking') or []]
    items, _ = new.scan()
    got = counts(items)
    want = dict(plan['counts'])
    want['project'] = len(plan['projects'])
    for t in sorted(set(got) | set(want)):
        if got.get(t, 0) != want.get(t, 0):
            problems.append(f'{t}: {want.get(t, 0)} in the source, {got.get(t, 0)} in the new vault')
    keys = {it['key'] for it in items} | {it['id'] for it in items if it['id']}
    marks = new._id_marks()
    for it in items:
        f = it['fields']
        if f.get('related_to') and f['related_to'] not in keys:
            problems.append(f"{it['path']}: hangs from {f['related_to']}, which is not in the new vault")
        if f.get('_unresolved_relations'):
            problems.append(f"{it['path']}: relations to nothing: {', '.join(f['_unresolved_relations'])}")
        if SPEC[it['type']]['scope'] == 'project' and not f.get('project'):
            problems.append(f"{it['path']}: in no project")
        m = new.structure.id_re.match(it['id'] or '') if it['type'] != 'project' else None
        if m and int(m.group(2)) > marks.get(m.group(1), 0):
            problems.append(f"{it['id']}: above the high-water mark of {m.group(1)} in ids.json")
    # A wikilink that still names a file of SOURCE by its old name (that name is no file of the new vault).
    src_store = source_store(source, plan['structure'], plan.get('folders'))
    src_items, _ = src_store.scan()
    gone = {old_stem(it): None for it in src_items}
    for it in items:
        gone.pop(os.path.splitext(os.path.basename(it['path']))[0], None)
    if gone:
        for here, dirs, files in os.walk(target):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for name in files:
                if name.endswith('.md'):
                    with open(os.path.join(here, name), encoding='utf-8', errors='replace') as f:
                        stale = links_to(f.read(), gone)
                    if stale:
                        problems.append(f"{os.path.relpath(os.path.join(here, name), target)}: links to {', '.join(stale[:3])}, a file of the old vault")
    for p in problems:
        print(f'✗ {p}', file=out)
    if not problems:
        print(f'✓ {target}: matches the Projects structure, {sum(got.values())} items as in the source, every link resolves', file=out)
    return problems


# ── command line ─────────────────────────────────────────────────────────────

def summary(plan, out):
    print(f"Plan for {plan['source']} ({plan['structure']}) → {plan['target']}", file=out)
    for p in plan['projects']:
        n = sum(1 for k in plan['assign'].values() if k == p['key'])
        print(f"  project {p['key']} “{p['name']}” — {p['kind']}, {n} initiatives and stories ({p['why']})", file=out)
    print(f"  {len(plan['id_map'])} ids change; {len(plan['mentions'])} bodies name one (left as written unless --rewrite-bodies)", file=out)
    if plan.get('linked'):
        print(f"  {plan['linked']} bodies have wikilinks to items, rewritten to their new file names", file=out)
    for x in plan.get('retitled') or []:
        print(f"  title of {x['id']} becomes “{x['as']}” (was “{x['title']}”, kept in its aliases)", file=out)
    for st, to in (plan.get('status_map') or {}).items():
        print(f"  status “{st}” → {to or '?'}", file=out)
    for q in plan['questions']:
        print(f"  ? {q['ask']}", file=out)
    if plan['not_migrated']:
        print(f"  not carried over: {', '.join(plan['not_migrated'][:10])}{' …' if len(plan['not_migrated']) > 10 else ''}", file=out)


def main(argv=None, out=sys.stdout):
    p = argparse.ArgumentParser(description=__doc__.split('\n', 1)[0])
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument('--plan', metavar='SOURCE', help='read SOURCE and write the plan')
    g.add_argument('--apply', metavar='PLAN', help='write the new vault the plan describes')
    g.add_argument('--check', metavar='PLAN', help='check the new vault against the plan')
    p.add_argument('--structure', choices=SOURCES, help="SOURCE's structure (its vault's `structure` in config.json)")
    p.add_argument('--folders', default='{}', help="SOURCE's own folder names, as its vault's `folders` in config.json (JSON)")
    p.add_argument('--out', help='the new vault folder (default: SOURCE-projects, next to it)')
    p.add_argument('--plan-file', help='where to write the plan (default: NEW.migration-plan.json, next to it)')
    p.add_argument('--rewrite-bodies', action='store_true', help='with --apply: rewrite old ids in the items’ text too')
    a = p.parse_args(argv)
    try:
        if a.plan:
            if not a.structure:
                raise PlanError('--plan needs --structure (folders or tasks)')
            plan = make_plan(a.plan, a.structure, a.out, json.loads(a.folders or '{}'))
            path = os.path.abspath(os.path.expanduser(a.plan_file or f"{plan['target']}.migration-plan.json"))
            atomic_write(path, json.dumps(plan, indent=2, ensure_ascii=False) + '\n')
            summary(plan, out)
            print(f'Plan written to {path}', file=out)
            return 0
        path = a.apply or a.check
        with open(os.path.expanduser(path), encoding='utf-8') as f:
            plan = json.load(f)
        if a.apply:
            apply_plan(plan, a.rewrite_bodies, out)
            return 0
        return 1 if check(plan, out) else 0
    except PlanError as e:
        print(f'migrate_structures: {e}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
