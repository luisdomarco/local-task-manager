#!/usr/bin/env python3
"""Move a Projects vault from long ids (ACME-INI-001, TSK-001) to short ones (a number per item, drawn INI-482), into
a NEW folder. plans/short-ids.md is the design; docs/migrate-short-ids.md the guide, written for Claude.

    python3 tools/migrate_short_ids.py --plan SOURCE [--out NEW] [--start N] [--plan-file PLAN]
    python3 tools/migrate_short_ids.py --apply PLAN [--rewrite-bodies]
    python3 tools/migrate_short_ids.py --check PLAN

--plan reads SOURCE through the app's Store and writes PLAN (JSON, by default next to the new folder): each item's new
number, oldest first, starting above every number an old id ever used (so an old id and a new one never read alike);
the files it renames, the files whose wikilinks change, and the texts that name an old id in passing. Nothing is
written into SOURCE.

--apply copies SOURCE to NEW and, in the copy only:
- each item's frontmatter: `id` becomes its number and its old id goes to `aliases` (tm/frontmatter.patch: only those
  two lines change; key order, comments, unknown keys and the body stay byte for byte);
- its file `ACME-STY-001 Title.md` → `STY-482 Title.md`, and every wikilink to it in the vault, Docs included;
- a plan or an analysis from before they had ids (no `id`, named after its item or its date) gets a number too, in the
  same oldest-first order, and the name of every ticket: `ACME-INI-001 Plan.md` → `PLN-490 INI-482 Plan.md`,
  `2026-10-12 Revisión P1.md` → `ANL-491 Revisión P1.md` (an `id` line after its fileClass; nothing else of it changes);
- its first heading when it is the template's (`# ACME-STY-001 — Title`); other mentions only with --rewrite-bodies;
- the work log's entries, each history file, the pins and the sidebar, by the id map;
- ids.json gains the number's mark (the old marks stay), legacy-ids.json the id map.
It refuses if SOURCE changed since the plan, if NEW exists and is not empty, or if SOURCE already has short ids. It
writes into NEW.partial and moves it into place once whole: a run that stops leaves nothing behind.

--check reads both and says whether NEW is whole: it matches the Projects structure with short ids, every item is
there, every old id finds its item, no wikilink was left dangling that was not already, and SOURCE is as it was.

Python stdlib only. It never reads config.json: the caller passes the vault folder.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import sys

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_DIR)
from tm import frontmatter as fm  # noqa: E402
from tm.fsutil import atomic_write  # noqa: E402
from tm.history import path_of as history_path  # noqa: E402
from tm.store import IDS_FILE, META_DIR, NUMBER_MARK, Store, StoreError  # noqa: E402
from tm.structures.check import PLACEHOLDER_RE  # noqa: E402
from tm.structures.ticketing import codec as tcodec  # noqa: E402
from tm.structures.ticketing.definition import SPEC, WORKLOG_FOLDER  # noqa: E402

PLAN_VERSION = 2  # 2: plans and analyses from before they had ids (`annexes`) get a number too
STRUCTURE = 'ticketing'
LEGACY_IDS = 'legacy-ids.json'
META_ID_LISTS = ('pins.md', 'sidebar.md')
HISTORY_DIR = 'history'
IGNORED = {'.DS_Store', 'Icon\r'}
# Not carried over from .task-manager: copies the app made before renames (old files, by their old names).
META_SKIPPED = ('backup',)
# A wikilink's target: [[Target]], [[Target|alias]], [[Target#heading]] (Obsidian names a note by its file name).
LINK_TARGET_RE = re.compile(r'\[\[([^\]|#\n]+)(?=[\]|#])')
WIKILINK_RE = re.compile(r'\[\[[^\]\n]*\]\]')
# An id as text, not inside a longer one (ACME-INI-001 holds INI-001, which is not an id there).
OLD_ID_RE = re.compile(r'(?<![\w-])((?:[A-Z]{2,4}-)?[A-Z]{2,4}-\d+)\b')
# The comment the templates gave an id line before short ids (`# KEY-STY-NNN`, `# TSK-NNN: a task has…`).
OLD_ID_COMMENT_RE = re.compile(r'# (?:KEY-)?([A-Z]{3,4})-NNN')


class PlanError(Exception):
    """Something the plan or the folders do not allow: said to the user as it is, exit 2."""


# ── reading the source ───────────────────────────────────────────────────────

def open_store(path):
    return Store(path, structure=STRUCTURE)


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


def markdown_files(root):
    """Every .md file of the vault, relative to it, outside hidden folders (.task-manager, .obsidian, .trash…)."""
    for here, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if not d.startswith('.'))
        for name in sorted(files):
            if name.endswith('.md') and name not in IGNORED:
                yield os.path.relpath(os.path.join(here, name), root).replace(os.sep, '/')


def read(root, rel):
    with open(os.path.join(root, rel), encoding='utf-8', newline='') as f:
        return f.read()


def stem_of(rel):
    return os.path.splitext(os.path.basename(rel))[0]


def history_name(key):
    """The name (no extension) of the history file of an item known by `key` (tm/history.py)."""
    return stem_of(history_path('', key))


def high_water(store, items, days):
    """The highest number any id of the vault ever used, under any prefix: ids.json's marks, live items, the trash, the
    work log and converted inbox items. The first short id goes above it, so `TSK-12` never names an old `TSK-012`."""
    top = max([0, *(v for v in store._id_marks().values())])
    used = [*(it['id'] for it in items), *(it['fields'].get('converted_from') for it in items), *store._trashed_ids(),
            *(e.get('id') for _, f in days.values() for e in f.get('entries') or [] if isinstance(e, dict))]
    for u in used:
        parsed = store.structure.parse_id(u)
        if parsed:
            top = max(top, parsed[1])
    return top


def links_to(text, stems):
    """The names in `stems` that `text` links to."""
    return sorted({m.group(1) for m in LINK_TARGET_RE.finditer(text) if m.group(1) in stems})


def relink(text, stems):
    """`text` with every wikilink to a renamed file pointing at its new name (`stems`: {old: new})."""
    return LINK_TARGET_RE.sub(lambda m: '[[' + stems.get(m.group(1), m.group(1)), text)


def replace_ids(text, refs):
    """`text` with every old id (whole word) as its new ref, outside wikilinks (relink renames those by file name)."""
    parts = WIKILINK_RE.split(text)
    links = WIKILINK_RE.findall(text)
    out = [OLD_ID_RE.sub(lambda m: refs.get(m.group(1), m.group(1)), part) for part in parts]
    return ''.join(x for pair in zip(out, [*links, '']) for x in pair)


def heading_of(text, old):
    """The template's first heading of an item named `old` (`# ACME-STY-001 — …`), or None."""
    _, body = fm.split(text)
    for line in (body or '').split('\n'):
        if line.strip():
            return line if line.startswith(f'# {old} — ') else None
    return None


# ── plan ─────────────────────────────────────────────────────────────────────

def make_plan(source, target=None, start=None):
    source = os.path.abspath(os.path.expanduser(source))
    if not os.path.isdir(source):
        raise PlanError(f'not a folder: {source}')
    target = os.path.abspath(os.path.expanduser(target or f'{source}-short-ids'))
    waiting = [os.path.relpath(os.path.join(h, f), source) for h, _, fs in os.walk(source) for f in fs if PLACEHOLDER_RE.search(f)]
    if waiting:
        raise PlanError(f"not downloaded from iCloud yet: {', '.join(sorted(waiting)[:5])}: open the folder in Finder first")
    store = open_store(source)
    found = store.check()
    if not found.get('ok'):
        raise PlanError(f"{source} does not match the Projects structure: {'; '.join(b['path'] + ': ' + b['detail'] for b in found['blocking'][:5])}")
    items, days = store.scan()
    if store.numbered():
        raise PlanError(f'{source} has short ids already: nothing to move')
    numbered = [it for it in items if it['id'] and store.structure.parse_id(it['id'])]
    if not numbered:
        raise PlanError(f'{source} has no item with a long id: a new vault numbers its items from the start')
    # A plan or an analysis from before they had ids: numbered with the rest, by age.
    annexed = [it for it in items if not it['id'] and SPEC[it['type']]['legacy_title']]
    annexed_paths = {it['path'] for it in annexed}
    first = high_water(store, items, days) + 1
    if start is not None:
        if start < first:
            raise PlanError(f'--start {start} is not above the highest number an id used ({first - 1})')
        first = start
    ordered = sorted([*numbered, *annexed], key=lambda it: (str(it['fields'].get('created_at') or ''), it['id'] or it['path']))
    number = {it['path']: str(first + i) for i, it in enumerate(ordered)}
    ids = {it['id']: number[it['path']] for it in ordered if it['id']}
    owner = {it['id']: it['type'] for it in numbered}
    refs = {old: tcodec.ref(owner[old], n) for old, n in ids.items()}
    # Every file named after a long id: an item (`ACME-STY-001 Title`) or a plan from before plans had ids, named after
    # its item (`ACME-STY-001 Plan`); then every plan and analysis that gets its first id, named by it.
    renames, stems, annexes = [], {}, []
    for it in items:
        stem = stem_of(it['path'])
        old = next((o for o in (it['id'], *ids) if o and o in ids and stem.startswith(o + ' ')), None)
        new_stem = refs[old] + stem[len(old):] if old else stem
        if it['path'] in annexed_paths:
            n = number[it['path']]
            # A plan keeps its name after its ref (`INI-482 Plan`): what it executes; an analysis, its title.
            new_stem = f"{tcodec.ref(it['type'], n)} {new_stem if it['type'] == 'plan' else tcodec.safe_title(it['title'])}"
            annexes.append({'path': it['path'], 'type': it['type'], 'number': n})
        if new_stem != stem:
            stems[stem] = new_stem
            renames.append([it['path'], f"{os.path.dirname(it['path'])}/{new_stem}.md".lstrip('/')])
    annexes.sort(key=lambda a: int(a['number']))  # in the order they are numbered, whatever order the disk lists them in
    named = named_by(renames, ids)
    linked, mentions = [], []
    for rel in markdown_files(source):
        text = read(source, rel)
        if links_to(text, stems):
            linked.append(rel)
        head, body = fm.split(text)
        first_line = heading_of(text, named[rel]) if rel in named else None
        rest = (body or '').replace(first_line, '', 1) if first_line else (body or '')
        if fm.parse(head or '').get('type') == 'worklog':
            continue  # its lines are the app's, rewritten with its entries
        said = sorted({m.group(1) for m in OLD_ID_RE.finditer(WIKILINK_RE.sub('', rest)) if m.group(1) in ids})
        if said:
            mentions.append({'path': rel, 'ids': said})
    return {
        'version': PLAN_VERSION, 'source': source, 'target': target, 'source_digest': digest(source),
        'start': first, 'top': first + len(ordered) - 1, 'id_map': ids, 'refs': refs, 'annexes': annexes, 'renames': renames,
        'linked': linked, 'mentions': mentions, 'counts': counts(items),
        'dangling': sorted(dangling(source)),
    }


def named_by(renames, ids):
    """{file: the old id its name starts with}: an item's own (`ACME-STY-001 Title`) or a plan's item (`… Plan`). An
    analysis numbered for the first time is named after its date: it has none."""
    out = {}
    for old_rel, _ in renames:
        stem = stem_of(old_rel)
        old = next((o for o in ids if stem.startswith(o + ' ')), None)
        if old:
            out[old_rel] = old
    return out


def counts(items):
    out = {}
    for it in items:
        out[it['type']] = out.get(it['type'], 0) + 1
    return out


def dangling(root):
    """The wikilink targets of the vault that name no file of it: --check refuses any it did not have before."""
    files = list(markdown_files(root))
    names = {stem_of(r) for r in files} | {r[:-3] for r in files}
    out = set()
    for rel in files:
        for m in LINK_TARGET_RE.finditer(read(root, rel)):
            t = m.group(1).strip()
            if t and t not in names and not os.path.splitext(t)[1]:
                out.add(t)
    return out


# ── apply ────────────────────────────────────────────────────────────────────

def apply_plan(plan, rewrite_bodies=False, out=sys.stdout):
    """Writes the new vault the plan describes. → the number of files written. It is written in a folder of its own
    next to it (`<new>.partial`) and moved into place only once whole: an error leaves nothing behind."""
    source, final = plan['source'], plan['target']
    if plan.get('version') != PLAN_VERSION:
        raise PlanError('this plan was written by another version of the tool: run --plan again')
    if digest(source) != plan['source_digest']:
        raise PlanError(f'{source} changed since the plan: run --plan again')
    if os.path.exists(final) and os.listdir(final):
        raise PlanError(f'{final} exists and is not empty: the new vault goes into a new folder')
    if open_store(source).numbered():
        raise PlanError(f'{source} has short ids already')
    partial = final.rstrip(os.sep) + '.partial'
    if os.path.lexists(partial):
        raise PlanError(f'{partial} is left from a run that stopped: delete it, then apply again')
    try:
        n = _write(plan, partial, rewrite_bodies)
        if os.path.isdir(final):
            os.rmdir(final)  # empty (checked above)
        os.rename(partial, final)
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise
    print(f"✓ {final}: {len(plan['id_map']) + len(plan['annexes'])} items numbered {plan['start']}–{plan['top']}, "
          f"{len(plan['renames'])} files renamed, {n} files written", file=out)
    return n


def _write(plan, target, rewrite_bodies):
    source = plan['source']
    os.makedirs(target)
    for name in os.listdir(source):
        src, dst = os.path.join(source, name), os.path.join(target, name)
        if name == META_DIR:
            shutil.copytree(src, dst, ignore=lambda d, names: [n for n in names if d == src and n in META_SKIPPED])
        elif os.path.isdir(src):
            shutil.copytree(src, dst)
        elif name not in IGNORED:
            shutil.copy2(src, dst)
    ids, refs = plan['id_map'], plan['refs']
    stems = {stem_of(a): stem_of(b) for a, b in plan['renames']}
    store = open_store(source)
    items, _ = store.scan()
    own = {it['path']: it for it in items if it['id'] in ids}
    annexes = {a['path']: a for a in plan['annexes']}
    named = named_by(plan['renames'], ids)
    n = 0
    for rel in markdown_files(target):
        before = read(target, rel)
        text = relink(before, stems)
        head, body = fm.split(text)
        fields = fm.parse(head) if head is not None else {}
        if fields.get('type') == 'worklog':
            text = _worklog(text, fields, ids, refs)
        elif rel in own:
            text = _item(text, fields, own[rel]['id'], ids, refs, rewrite_bodies)
        elif rel in annexes:  # a plan or an analysis given its first id
            text = _annex(text, annexes[rel])
            if rel in named:
                text = _retitle(text, named[rel], refs, rewrite_bodies)
            elif rewrite_bodies:
                text = with_body(text, replace_ids(fm.split(text)[1], refs))
        elif rel in named:  # a plan: named after its item, its heading the template's
            text = _retitle(text, named[rel], refs, rewrite_bodies)
        elif rewrite_bodies:
            text = with_body(text, replace_ids(body, refs))
        if text != before:
            atomic_write(os.path.join(target, rel), text)
            n += 1
    for old_rel, new_rel in plan['renames']:
        os.rename(os.path.join(target, old_rel), os.path.join(target, new_rel))
    return n + _meta(target, plan)


def with_body(text, body):
    """`text` with its body (all after the frontmatter) replaced by `body`, every byte before it as it was."""
    _, old = fm.split(text)
    return text[:len(text) - len(old)] + body


def _item(text, fields, old, ids, refs, rewrite_bodies):
    """One item's file: its number in `id`, its old id in `aliases` (after those it had), the template's id comment
    and first heading as the new ones; other mentions of old ids only when asked."""
    aliases = [str(a) for a in fields.get('aliases') or [] if a] if isinstance(fields.get('aliases'), list) else []
    text = fm.patch(text, {'id': int(ids[old]), 'aliases': [*(a for a in aliases if a != old), old]})
    code = refs[old].rsplit('-', 1)[0]
    head, body = fm.split(text)
    lines = head.split('\n')
    at = next((i for i, line in enumerate(lines) if line.startswith('id:')), None)
    if at is not None:
        lines[at] = OLD_ID_COMMENT_RE.sub(f'# its number, drawn {code}-<n>', lines[at])
        start = text.index(head)
        text = text[:start] + '\n'.join(lines) + text[start + len(head):]
    return _retitle(text, old, refs, rewrite_bodies)


def _annex(text, annex):
    """A plan or an analysis from before they had ids: its number on an `id` line right after its fileClass, as the
    templates have it now; every other byte as it was."""
    code = SPEC[annex['type']]['code']
    head, _ = fm.split(text)
    lines = head.split('\n')
    at = next((i + 1 for i, line in enumerate(lines) if line.startswith('fileClass:')), 0)
    lines.insert(at, f"id: {annex['number']}".ljust(39) + f'# its number, drawn {code}-<n>')
    start = text.index(head)
    return text[:start] + '\n'.join(lines) + text[start + len(head):]


def _retitle(text, old, refs, rewrite_bodies):
    """The template's first heading (`# ACME-STY-001 — …`) by the new ref; other mentions only when asked."""
    _, body = fm.split(text)
    first = heading_of(text, old)
    new_body = body.replace(first, f'# {refs[old]}' + first[len(f'# {old}'):], 1) if first else body
    if rewrite_bodies:
        new_body = replace_ids(new_body, refs)
    return with_body(text, new_body) if new_body != body else text


def _worklog(text, fields, ids, refs):
    """A work-log day: each entry by its item's number, and its lines (the app's own) by the ref."""
    entries = fields.get('entries') or []
    new = [{**e, 'id': ids.get(e.get('id'), e.get('id'))} if isinstance(e, dict) else e for e in entries]
    if new == entries:
        return text
    text = fm.patch(text, {'entries': new})
    return with_body(text, replace_ids(fm.split(text)[1], refs))


def _meta(target, plan):
    """.task-manager: ids.json with the number's mark, legacy-ids.json with the id map, each history under its number,
    the pins and the sidebar by number. → how many files were written."""
    meta = os.path.join(target, META_DIR)
    ids, refs = plan['id_map'], plan['refs']
    # A plan or an analysis with no id was known by its path (its key), and its history file named after it. (The pins
    # and the sidebar hold ids only: it was never in them.)
    by_history = {**ids, **{history_name(a['path']): a['number'] for a in plan['annexes']}}
    os.makedirs(meta, exist_ok=True)
    n = 0
    marks_path = os.path.join(meta, IDS_FILE)
    try:
        with open(marks_path, encoding='utf-8') as f:
            marks = json.load(f)
    except (OSError, ValueError):
        marks = {}
    marks = {**(marks if isinstance(marks, dict) else {}), NUMBER_MARK: plan['top']}
    atomic_write(marks_path, json.dumps(dict(sorted(marks.items())), indent=2) + '\n')
    legacy_path = os.path.join(meta, LEGACY_IDS)
    try:
        with open(legacy_path, encoding='utf-8') as f:
            legacy = json.load(f)
    except (OSError, ValueError):
        legacy = {}
    # An id from an older migration (INI-0001 → ACME-INI-0001) now leads to the number too.
    legacy = {k: ids.get(v, v) for k, v in (legacy if isinstance(legacy, dict) else {}).items()}
    atomic_write(legacy_path, json.dumps({**legacy, **ids}, indent=2, ensure_ascii=False) + '\n')
    n += 2
    history = os.path.join(meta, HISTORY_DIR)
    if os.path.isdir(history):
        for name in sorted(os.listdir(history)):
            stem, ext = os.path.splitext(name)
            if stem not in by_history:
                continue
            text = read(history, name)
            head, _ = fm.split(text)
            if head is not None and 'item' in fm.parse(head):
                text = fm.patch(text, {'item': by_history[stem]})
            atomic_write(os.path.join(history, by_history[stem] + ext), text)
            os.remove(os.path.join(history, name))
            n += 1
    for name in META_ID_LISTS:
        path = os.path.join(meta, name)
        if not os.path.isfile(path):
            continue
        text = read(meta, name)
        head, body = fm.split(text)
        fields = fm.parse(head) if head is not None else {}
        if isinstance(fields.get('items'), list):
            text = fm.patch(text, {'items': [ids.get(str(i), str(i)) for i in fields['items']]})
            text = with_body(text, replace_ids(fm.split(text)[1], refs))
            atomic_write(path, text)
            n += 1
    return n


# ── check ────────────────────────────────────────────────────────────────────

def check(plan, out=sys.stdout):
    """→ the problems found ([] when the new vault is whole), each printed."""
    problems = []
    source, target = plan['source'], plan['target']
    if digest(source) != plan['source_digest']:
        problems.append(f'{source} changed since the plan')
    new = open_store(target)
    found = new.check()
    problems += [f"structure: {b['path']}: {b['detail']}" for b in found.get('blocking') or []]
    if not new.numbered():
        problems.append(f'{target} does not number its items (ids.json has no "{NUMBER_MARK}")')
    items, _ = new.scan()
    got = counts(items)
    for t in sorted(set(got) | set(plan['counts'])):
        if got.get(t, 0) != plan['counts'].get(t, 0):
            problems.append(f"{t}: {plan['counts'].get(t, 0)} in the source, {got.get(t, 0)} in the new vault")
    top = new._id_marks().get(NUMBER_MARK, 0)
    for it in items:
        if new.structure.parse_id(it['id']):
            problems.append(f"{it['path']}: still has its long id {it['id']}")
        if new.structure.is_number(it['id']) and int(it['id']) > top:
            problems.append(f"{it['ref']}: above the number's mark in ids.json ({top})")
        if it['fields'].get('_unresolved_relations'):
            problems.append(f"{it['path']}: relations to nothing: {', '.join(it['fields']['_unresolved_relations'])}")
    for old, number in plan['id_map'].items():
        try:
            hit = new.find(old)
        except StoreError:
            hit = None
        if not hit or hit['id'] != number:
            problems.append(f'{old}: does not find {plan["refs"][old]} (its old id should be in its aliases)')
    for a in plan['annexes']:
        try:
            hit = new.find(a['number'])
        except StoreError:
            hit = None
        if not hit or hit['type'] != a['type']:
            problems.append(f"{a['path']}: does not find {tcodec.ref(a['type'], a['number'])}")
    for t in sorted(dangling(target) - set(plan['dangling'])):
        problems.append(f'a wikilink to "{t}" leads nowhere (it did in the source)')
    for p in problems:
        print(f'✗ {p}', file=out)
    if not problems:
        print(f"✓ {target}: short ids {plan['start']}–{plan['top']}, {sum(got.values())} items as in the source, "
              'every old id finds its item, no new dangling link', file=out)
    return problems


# ── command line ─────────────────────────────────────────────────────────────

def summary(plan, out):
    print(f"Plan for {plan['source']} → {plan['target']}", file=out)
    print(f"  {len(plan['id_map']) + len(plan['annexes'])} items get a number, {plan['start']} to {plan['top']} (oldest first), "
          f"{len(plan['annexes'])} of them plans or analyses that had no id; "
          f"{len(plan['renames'])} files renamed; {len(plan['linked'])} files have wikilinks that follow them", file=out)
    sample = list(plan['refs'].items())[:5]
    print('  ' + ', '.join(f'{old} → {ref}' for old, ref in sample) + (' …' if len(plan['refs']) > 5 else ''), file=out)
    print(f"  {len(plan['mentions'])} texts name an old id in passing: left as written unless --rewrite-bodies "
          '(the old id stays in the item\'s aliases, so it is still found)', file=out)
    for m in plan['mentions'][:10]:
        print(f"    {m['path']}: {', '.join(m['ids'])}", file=out)


def main(argv=None, out=sys.stdout):
    p = argparse.ArgumentParser(description=__doc__.split('\n', 1)[0])
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument('--plan', metavar='SOURCE', help='read SOURCE and write the plan')
    g.add_argument('--apply', metavar='PLAN', help='write the new vault the plan describes')
    g.add_argument('--check', metavar='PLAN', help='check the new vault against the plan')
    p.add_argument('--out', help='the new vault folder (default: SOURCE-short-ids, next to it)')
    p.add_argument('--start', type=int, help='the first number (default: one above the highest an old id used)')
    p.add_argument('--plan-file', help='where to write the plan (default: NEW.short-ids-plan.json, next to it)')
    p.add_argument('--rewrite-bodies', action='store_true', help='with --apply: rewrite old ids in the texts too')
    a = p.parse_args(argv)
    try:
        if a.plan:
            plan = make_plan(a.plan, a.out, a.start)
            path = os.path.abspath(os.path.expanduser(a.plan_file or f"{plan['target']}.short-ids-plan.json"))
            atomic_write(path, json.dumps(plan, indent=2, ensure_ascii=False) + '\n')
            summary(plan, out)
            print(f'Plan written to {path}', file=out)
            return 0
        with open(os.path.abspath(os.path.expanduser(a.apply or a.check)), encoding='utf-8') as f:
            plan = json.load(f)
        if a.apply:
            apply_plan(plan, a.rewrite_bodies, out)
            return 0
        return 1 if check(plan, out) else 0
    except PlanError as e:
        print(f'✗ {e}', file=out)
        return 2


if __name__ == '__main__':
    sys.exit(main())
