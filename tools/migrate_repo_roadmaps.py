#!/usr/bin/env python3
"""Bring the project management of ~/github into the owner's Projects vault, and wire its system fichas to it.

    python3 tools/migrate_repo_roadmaps.py --plan VAULT [--github DIR] [--phase projects|items]
    python3 tools/migrate_repo_roadmaps.py --apply PLAN --i-have-a-backup
    python3 tools/migrate_repo_roadmaps.py --check PLAN
    python3 tools/migrate_repo_roadmaps.py --rollback PLAN

docs/migrate-repo-roadmaps.md is the guide. The contract is the one `migrate_structures.py` set, and the owner
already knows how to read it: --plan writes a JSON that proposes everything and asks what only the owner can say;
--apply refuses until every project is `confirmed` and every question `answered`, and refuses if the vault or a
source moved since the plan; --check counts both sides and says whether the vault is whole.

**The sources under ~/github are never written.** Only the vault is.

Two phases, each its own plan and its own apply:

- `projects`: the projects the inventory says have work, and the bridge to the system fichas it points at.
  Three projects already exist and are only reconciled (`repo`, `managed_by`); one is created. Every other
  ficha is marked `sin pool`, so "has no pool" is told apart from "not filled in yet". No items.
- `items`: the `roadmap/` and `work/` trees as tickets. Written through the Projects codec, never through the
  Store: `Store.create` stamps `created_at` with today (`PROTECTED`, store.py:1435) and drops `aliases` and
  `status_log` (`allowed_values`, store.py:376), which is the whole historical record. A project is different —
  it is new and has no history — so it goes through the Store and gets its validation of the key and the folder.

Python stdlib only. It never reads config.json: the caller passes the vault.
"""
import argparse
import collections
import importlib.util
import json
import os
import re
import sys
from datetime import datetime

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_DIR)
from tm import frontmatter as fm  # noqa: E402
from tm.fsutil import VaultBusy, atomic_write, vault_lock  # noqa: E402
from tm.store import META_DIR, Store, StoreError  # noqa: E402
from tm.structures import REGISTRY  # noqa: E402
from tools import _roadmap_dialects as rd  # noqa: E402
from tools._migration_common import PlanError, digest, placeholders, write_once  # noqa: E402


def vault_digest(vault):
    """The vault as the migration cares about it: everything but `.task-manager/`, which the app
    rewrites on its own and which taking the lock touches."""
    return digest(vault, skip=(META_DIR,))

PLAN_VERSION = 1
TARGET = 'ticketing'
PHASES = ('projects', 'items')
# The owner's inventory is NOT in this repo: which tree feeds which project, where the system fichas
# live and what stays behind are the names of private repos and of a vault's project keys, and this
# repo builds a PUBLIC copy of itself (`tools/publish_public.py`). `--sources` points at a module
# that defines the five names `load_sources` checks for; `docs/migrate-repo-roadmaps.md` says what each
# one holds. The plan records the path it used, so --apply and --check read the same inventory.
SOURCES = None


def load_sources(path):
    """The module `--sources` names. It must define FICHAS, PROJECTS, POOL_OF_FICHA, ITEM_SOURCES and LEFT_IN_REPO."""
    full = os.path.abspath(os.path.expanduser(path))
    spec = importlib.util.spec_from_file_location('_migrate_sources', full)
    if spec is None or spec.loader is None:
        raise PlanError(f'not a Python file: {path}')
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:  # a config with a typo must say so here, not half way through a walk
        raise PlanError(f'{path} does not load: {e}') from None
    missing = [n for n in ('FICHAS', 'PROJECTS', 'POOL_OF_FICHA', 'ITEM_SOURCES', 'LEFT_IN_REPO') if not hasattr(mod, n)]
    if missing:
        raise PlanError(f"{path} defines no {', '.join(missing)}")
    mod.__source_path__ = full
    return mod


def inventory():
    """What --sources loaded, or a refusal that says what is missing instead of a NoneType error."""
    if SOURCES is None:
        raise PlanError('this needs --sources <file>: the trees to read and the projects they feed are '
                        'not in this repo')
    return SOURCES
# What a ficha says, and the one key this phase writes.
FICHA_KEYS = ('nombre', 'bucket', 'ruta', 'remote', 'confidencialidad', 'proyecto', 'estado')
PROYECTO_KEY = 'proyecto'
# A ficha whose system has no pool says so, so that "has none" is not read as "not filled in yet".
NO_POOL = 'sin pool'

def _fm_value(text, key):
    """A frontmatter value as the fichas write it: quoted or bare, with a trailing `# comment` to ignore."""
    head = text.split('---', 2)[1] if text.startswith('---') else text
    m = re.search(r'^%s:\s*(.*?)\s*$' % re.escape(key), head, re.M)
    if not m:
        return ''
    v = re.sub(r'\s+#.*$', '', m.group(1)).strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in '"\'':
        v = v[1:-1]
    return v.strip()


def read_fichas(vault):
    """Every system ficha of `<FICHAS>/<bucket>/`: one per unit, plus the ones with no repo. Read only."""
    base = os.path.join(vault, inventory().FICHAS)
    if not os.path.isdir(base):
        raise PlanError(f'no system fichas at {base}')
    out = []
    for bucket in sorted(os.listdir(base)):
        d = os.path.join(base, bucket)
        if not os.path.isdir(d) or bucket.startswith('_'):
            continue
        for name in sorted(os.listdir(d)):
            if not name.endswith('.md'):
                continue
            rel = os.path.join(inventory().FICHAS, bucket, name)
            with open(os.path.join(vault, rel), encoding='utf-8') as fh:
                text = fh.read()
            if _fm_value(text, 'type') != 'sistema':
                continue
            row = {k: _fm_value(text, k) for k in FICHA_KEYS}
            row.update({'bucket': bucket, 'rel': rel, 'nombre': row['nombre'] or name[:-3]})
            out.append(row)
    return out


def projects_in(vault):
    """{key: {'name', 'rel'}} for the projects already in the vault, read from their `00 <Name>.md` notes."""
    out = {}
    for name in sorted(os.listdir(vault)):
        rel = os.path.join(name, f'00 {name}.md')
        if not os.path.isfile(os.path.join(vault, rel)):
            continue
        with open(os.path.join(vault, rel), encoding='utf-8') as fh:
            text = fh.read()
        key = _fm_value(text, 'project_key')
        if key:
            out[key] = {'name': name, 'rel': rel,
                        'repo': _fm_value(text, 'repo'), 'managed_by': _fm_value(text, 'managed_by')}
    return out


def body_for(key, p, fichas):
    """A new project's own text: what it is, and the door to the system ficha(s) it delivers."""
    mine = [f for f in fichas if inventory().POOL_OF_FICHA.get(f['nombre']) == key]
    lines = ['> [!owner] What this project is',
             f"> The pool of work for {p['name']}. Its identity, where it lives and what it depends on are in",
             f'> its system ficha in `{inventory().FICHAS}/`; this project is only the work.', '',
             '## Execution order', '',
             'The order in which approved work runs. Human decision, not computed.', '', '1. ', '',
             '## Related', '']
    for f in mine:
        lines.append(f"- System ficha: [[{os.path.basename(f['rel'])[:-3]}]] (`{f['rel']}`)")
    lines.append(f"- Repo: `{p['repo']}`")
    return '\n'.join(lines) + '\n'


def make_plan(vault, github, phase, only=None):
    if phase == 'items':
        return make_items_plan(vault, github, only)
    store = Store(vault, structure=REGISTRY[TARGET])
    result = store.check()
    if not result['ok']:
        raise PlanError(f"{vault} does not match its structure "
                        f"({len(result.get('blocking') or [])} blocking findings): fix that first")
    stale = placeholders(vault)
    fichas = read_fichas(vault)
    have = projects_in(vault)
    questions = []

    projects = []
    for key, p in inventory().PROJECTS.items():
        missing = [s for s in p['sources'] if not os.path.isdir(os.path.join(github, s))]
        if missing:
            raise PlanError(f'{key}: these sources are not on disk: {", ".join(missing)}')
        row = {'key': key, 'name': p['name'], 'initiative_kind': p['kind'], 'repo': p['repo'],
               'managed_by': p['managed_by'], 'sources': p['sources'],
               'fichas': [f['rel'] for f in fichas if inventory().POOL_OF_FICHA.get(f['nombre']) == key],
               'exists': key in have, 'changes': {}, 'confirmed': False}
        if key in have:
            if have[key]['name'] != p['name']:
                raise PlanError(f"the key {key} is the project {have[key]['name']!r} in the vault, not "
                                f"{p['name']!r}: say which one it is before anything is written")
            for k in ('repo', 'managed_by'):
                if have[key][k] != p[k]:
                    row['changes'][k] = {'from': have[key][k], 'to': p[k]}
        else:
            row['why'] = 'new: the project does not exist in the vault yet'
            questions.append({'id': f'key-{key}', 'answered': False, 'answer': None,
                              'ask': f"{p['name']} would get the key {key}, which is immutable once written. "
                                     f"Confirm it or say another one of 2 to 4 capital letters."})
        if not row['fichas']:
            questions.append({'id': f'ficha-{key}', 'answered': False, 'answer': None,
                              'ask': f'{key} has no system ficha pointing at it: say which ficha it delivers.'})
        projects.append(row)

    # The bridge: every ficha says its project, or says it has no pool. A ficha that already names a project is
    # never overwritten — 15 of them point at a real project of the vault (GADS, LDMA, AGEN, My Plan) or at the
    # right pool, and `sin pool` would have thrown those links away. A bare key is only normalised to the
    # wikilink Obsidian can resolve; anything that names nothing the vault has is asked about.
    name_of_key = {k: v['name'] for k, v in have.items()}
    by_name = {v['name']: k for k, v in have.items()}
    rows = []
    for f in fichas:
        key = inventory().POOL_OF_FICHA.get(f['nombre'])
        said = f['proyecto']
        why = ''
        if key:
            want, why = f"[[00 {inventory().PROJECTS[key]['name']}]]", 'its pool in this migration'
        elif not said:
            want, why = NO_POOL, 'no pool: its management is this ficha'
        else:
            inner = said[2:-2].strip() if said.startswith('[[') and said.endswith(']]') else ''
            if inner.startswith('00 ') and inner[3:] in by_name:
                want, why = said, 'already points at a project of the vault'
            elif said in name_of_key:
                want = f'[[00 {name_of_key[said]}]]'
                why = f'names the project {said} by its key: normalised to a wikilink'
            else:
                want, why = said, 'left as it is'
                questions.append({'id': 'ficha-' + f['nombre'], 'answered': False, 'answer': None,
                                  'ask': f"{f['rel']} says `proyecto: {said}`, which names no project of this "
                                         f"vault. Say the project it means, or {NO_POOL!r}."})
        rows.append({'rel': f['rel'], 'nombre': f['nombre'], 'bucket': f['bucket'], 'why': why,
                     'from': said, 'to': want, 'change': said != want})

    return {
        'plan_version': PLAN_VERSION, 'phase': phase, 'created': datetime.now().strftime('%Y-%m-%d %H:%M'),
        'vault': os.path.abspath(vault), 'github': os.path.abspath(github),
        'vault_digest': vault_digest(vault), 'placeholders': stale,
        'sources': getattr(SOURCES, '__source_path__', None),
        'projects': projects, 'fichas': rows, 'questions': questions,
        'counts': {'projects': len(projects), 'new': sum(0 if p['exists'] else 1 for p in projects),
                   'reconciled': sum(1 for p in projects if p['changes']),
                   'fichas': len(rows), 'fichas_to_change': sum(1 for r in rows if r['change'])},
        'written': [], 'patched': [],
    }


def validate(plan):
    if plan.get('plan_version') != PLAN_VERSION:
        raise PlanError('this plan was written by another version of the tool')
    if plan.get('phase') not in PHASES:
        raise PlanError(f"phase must be one of {', '.join(PHASES)}")
    if plan.get('placeholders'):
        raise PlanError(f"{len(plan['placeholders'])} iCloud files are not downloaded yet "
                        f"(first: {plan['placeholders'][0]}): download them before writing")
    open_ = [p['key'] for p in plan['projects'] if not p.get('confirmed')]
    if open_:
        raise PlanError('ask the owner about these projects and set "confirmed": true: ' + ', '.join(open_))
    unanswered = [q['id'] for q in plan['questions'] if not q.get('answered')]
    if unanswered:
        raise PlanError('these questions need the owner\'s answer ("answered": true): ' + ', '.join(unanswered))


def _patch_file(vault, rel, updates, patched):
    """Patch frontmatter keys in place, keeping every other byte, and record what it was for --rollback."""
    full = os.path.join(vault, rel)
    with open(full, encoding='utf-8') as fh:
        text = fh.read()
    was = {k: _fm_value(text, k) for k in updates}
    if all(was[k] == v for k, v in updates.items()):
        return False
    atomic_write(full, fm.patch(text, updates))
    patched.append({'rel': rel, 'was': was, 'now': dict(updates)})
    return True


def _free_or_say_what_to_close(vault):
    """Refuse up front, with something the owner can act on, when another program holds the vault lock.

    Without this the first write still refuses — `Store.create` waits its 10 s and raises — but its message says
    only "another program has been writing to this vault", which does not say what to close.
    """
    try:
        with vault_lock(os.path.join(vault, META_DIR), timeout=0.2):
            pass
    except VaultBusy:
        raise PlanError('another program holds the vault lock: close the Task Manager app (it runs on :3200) '
                        'and Obsidian, then apply again. Nothing was written.') from None


def apply_plan(plan, out=sys.stdout):
    validate(plan)
    vault = plan['vault']
    if vault_digest(vault) != plan['vault_digest']:
        raise PlanError('the vault changed since the plan was written: write the plan again')
    _free_or_say_what_to_close(vault)
    store = Store(vault, structure=REGISTRY[TARGET])
    made, patched = [], []
    try:
        # A new project goes through the Store, which takes the vault lock itself. Never hold the lock around
        # this: vault_lock is per open file, so a second open in this same process would wait for the first.
        for p in plan['projects']:
            if not p['exists']:
                values = {'project_key': p['key'], 'status': 'Backlog',
                          'repo': p['repo'], 'managed_by': p['managed_by']}
                it = store.create('project', p['name'], values,
                                  body_for(p['key'], inventory().PROJECTS[p['key']], read_fichas(vault)))
                made.append(it['path'])
                print(f"  + {p['key']:5} {p['name']}", file=out)
        # The patches write files directly, so they take the lock: the app at :3200 holds the same flock per
        # write, and a ficha half written while it indexes is exactly what this prevents.
        with vault_lock(os.path.join(vault, META_DIR), timeout=60):
            for p in plan['projects']:
                if p['exists'] and p['changes']:
                    rel = projects_in(vault)[p['key']]['rel']
                    if _patch_file(vault, rel, {k: v['to'] for k, v in p['changes'].items()}, patched):
                        print(f"  ~ {p['key']:5} {', '.join(p['changes'])}", file=out)
            changed = 0
            for r in plan['fichas']:
                if r['change'] and _patch_file(vault, r['rel'], {PROYECTO_KEY: r['to']}, patched):
                    changed += 1
            print(f"  ~ {changed} fichas wired", file=out)
    except VaultBusy:
        plan['written'], plan['patched'] = made, patched
        raise PlanError('another process holds the vault lock: close the Task Manager app (it runs on :3200) '
                        'and Obsidian, then apply again. --rollback undoes what is in the plan.')
    except StoreError as e:
        plan['written'], plan['patched'] = made, patched
        raise PlanError(f'{e}. Nothing more was written; --rollback undoes what is in the plan.')
    plan['written'], plan['patched'] = made, patched
    print(f"{len(made)} projects created, {len(patched)} files patched in {vault}", file=out)
    return plan


def rollback(plan, out=sys.stdout):
    """Put back exactly what --apply changed: the old frontmatter values, then the notes it created."""
    vault = plan['vault']
    with vault_lock(os.path.join(vault, META_DIR), timeout=60):
        return _rollback(plan, vault, out)


def _rollback(plan, vault, out):
    for rec in reversed(plan.get('patched') or []):
        full = os.path.join(vault, rec['rel'])
        if not os.path.isfile(full):
            print(f"  gone, left alone: {rec['rel']}", file=out)
            continue
        with open(full, encoding='utf-8') as fh:
            text = fh.read()
        now = {k: _fm_value(text, k) for k in rec['now']}
        if now != rec['now']:
            print(f"  changed since the apply, left alone: {rec['rel']}", file=out)
            continue
        atomic_write(full, fm.patch(text, rec['was']))
    gone = 0
    for rel in reversed(plan.get('written') or []):
        full = os.path.join(vault, rel)
        folder = os.path.dirname(full)
        if os.path.exists(full):
            os.remove(full)
            gone += 1
        if os.path.isdir(folder) and not os.listdir(folder):
            os.rmdir(folder)
        elif os.path.isdir(folder):
            print(f'  kept {os.path.relpath(folder, vault)}: it holds something else now', file=out)
    print(f"{len(plan.get('patched') or [])} files put back, {gone} project notes removed", file=out)
    plan['written'], plan['patched'] = [], []
    return plan


def check(plan, out=sys.stdout):
    vault = plan['vault']
    store = Store(vault, structure=REGISTRY[TARGET])
    bad = []
    result = store.check()
    if not result['ok']:
        bad.append(f"the vault does not match its structure: {len(result.get('blocking') or [])} blocking findings")
    have = projects_in(vault)
    for p in plan['projects']:
        if p['key'] not in have:
            bad.append(f"{p['key']} ({p['name']}) is not in the vault")
            continue
        got = have[p['key']]
        if got['name'] != p['name']:
            bad.append(f"{p['key']} is {got['name']!r}, the plan says {p['name']!r}")
        for k in ('repo', 'managed_by'):
            if got[k] != p[k]:
                bad.append(f"{p['key']}.{k} is {got[k]!r}, the plan says {p[k]!r}")
    by_rel = {f['rel']: f for f in read_fichas(vault)}
    off = [r['rel'] for r in plan['fichas'] if r['rel'] in by_rel and by_rel[r['rel']]['proyecto'] != r['to']]
    if off:
        bad.append(f"{len(off)} fichas do not say what the plan says (first: {off[0]})")
    missing = [r['rel'] for r in plan['fichas'] if r['rel'] not in by_rel]
    if missing:
        bad.append(f"{len(missing)} fichas of the plan are not in the vault (first: {missing[0]})")
    for line in bad:
        print('  ✗ ' + line, file=out)
    if not bad:
        print(f"  ✓ {len(plan['projects'])} projects as the plan says, {len(plan['fichas'])} fichas wired, "
              f"the vault matches its structure", file=out)
    return not bad


def summary_items(plan, out):
    c = plan['counts']
    print(f"# items · {c['items']} to import, ids {c['ids']}", file=out)
    for k in ('by_source', 'by_type', 'by_status'):
        print(f"  {k[3:]:8} {c[k]}", file=out)
    print(f"  {'no fm':8} {c['no_frontmatter']} files with no frontmatter: title from their H1, date from their name",
          file=out)
    print(f"  {'refs':8} {c['dropped_relations']} relations name nothing; {c['alias_collisions']} aliases the vault "
          f"already answers to", file=out)
    for a in plan['alias_collisions']:
        print(f"    {a['alias']}: {a['why']}", file=out)
    print('\n## left in the repo', file=out)
    for l in plan['left_in_repo']:
        print(f"  {l['path']}\n      {l['why']}", file=out)
    if plan['questions']:
        print(f"\n## questions for the owner ({len(plan['questions'])})", file=out)
        for q in plan['questions']:
            print(f"  [{q['id']}] {q['ask']}", file=out)


def summary(plan, out):
    if plan.get('phase') == 'items':
        return summary_items(plan, out)
    c = plan['counts']
    print(f"# {plan['phase']} · {c['projects']} projects ({c['new']} new, {c['reconciled']} to reconcile) · "
          f"{c['fichas_to_change']} of {c['fichas']} fichas to wire", file=out)
    print('\n## projects', file=out)
    for p in plan['projects']:
        state = 'new' if not p['exists'] else ('reconcile' if p['changes'] else 'as is')
        print(f"  {p['key']:5} {p['name']:24} {p['initiative_kind']:8} {state}", file=out)
        for k, v in p['changes'].items():
            print(f"          {k}: {v['from']!r} → {v['to']!r}", file=out)
        for f in p['fichas']:
            print(f"          ficha: {f}", file=out)
        for s in p['sources']:
            print(f"          source: {s}", file=out)
    pools = sum(1 for r in plan['fichas'] if r['to'] != NO_POOL)
    print(f"\n## fichas\n  {pools} point at a project, {len(plan['fichas']) - pools} say {NO_POOL!r}", file=out)
    by = {}
    for r in plan['fichas']:
        if r['change']:
            by[r['bucket']] = by.get(r['bucket'], 0) + 1
    for b, n in sorted(by.items()):
        print(f"  {b}: {n} to change", file=out)
    if plan['questions']:
        print(f"\n## questions for the owner ({len(plan['questions'])})", file=out)
        for q in plan['questions']:
            print(f"  [{q['id']}] {q['ask']}", file=out)


def main(argv=None, out=sys.stdout):
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--plan', metavar='VAULT')
    g.add_argument('--apply', metavar='PLAN')
    g.add_argument('--check', metavar='PLAN')
    g.add_argument('--rollback', metavar='PLAN')
    ap.add_argument('--github', default=os.path.expanduser('~/github'))
    ap.add_argument('--phase', default='projects', choices=PHASES)
    ap.add_argument('--project', action='append', metavar='KEY',
                    help='only these projects\' sources (repeatable); all of them by default')
    ap.add_argument('--sources', metavar='FILE',
                    help='the module with FICHAS, PROJECTS, POOL_OF_FICHA, ITEM_SOURCES and LEFT_IN_REPO: '
                         'the trees to read and '
                         'the projects they feed. Not in this repo (it names private repos); the plan '
                         'records the path so --apply and --check reuse it')
    ap.add_argument('--plan-file')
    ap.add_argument('--i-have-a-backup', action='store_true')
    a = ap.parse_args(argv)
    global SOURCES
    try:
        if a.sources:
            SOURCES = load_sources(a.sources)
        if a.plan:
            plan = make_plan(a.plan, a.github, a.phase, a.project)
            path = a.plan_file or os.path.join(a.github, f'migrate-roadmaps-{a.phase}.plan.json')
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(plan, f, ensure_ascii=False, indent=1)
            summary(plan, out)
            print(f'\nplan written to {path}', file=out)
            return 0
        which = a.apply or a.check or a.rollback
        with open(which, encoding='utf-8') as fh:
            plan = json.load(fh)
        if SOURCES is None and plan.get('sources'):  # the plan remembers which inventory it was made from
            SOURCES = load_sources(plan['sources'])
        items_phase = plan.get('phase') == 'items'
        if a.apply:
            if not a.i_have_a_backup:
                raise PlanError('--apply needs --i-have-a-backup: take one first, then say so')
            plan = apply_items(plan, out) if items_phase else apply_plan(plan, out)
        elif a.rollback:
            plan = rollback(plan, out)
        else:
            return 0 if (check_items(plan, out) if items_phase else check(plan, out)) else 1
        with open(which, 'w', encoding='utf-8') as f:
            json.dump(plan, f, ensure_ascii=False, indent=1)
        return 0
    except PlanError as e:
        print(f'migrate_repo_roadmaps: {e}', file=sys.stderr)
        return 2



# ── the items phase ────────────────────────────────────────────────────────

# Where a relation of the source goes, per type: its own field when the vault has one, else `relations`, which
# every type has and the codec writes as wikilinks. Nothing is dropped.
REL_FIELD = {
    'initiative': {'depends_on': 'depends_on', 'origin': 'origin', 'plan': 'plan'},
    'story': {'depends_on': 'depends_on', 'origin': 'origin', 'plan': 'plan'},
    'error': {'fixed_by': 'fixed_by', 'resolved_by': 'fixed_by'},
    'support': {'promoted_to': 'promoted_to', 'escalated_to': 'escalated_to'},
    'analysis': {'supersedes': 'supersedes'},
}
# What each of those fields accepts, so a ref of the wrong type goes to `relations` instead of being refused.
REL_TYPES = {'depends_on': ('initiative', 'story', 'support', 'hotfix'), 'origin': ('support', 'task'),
             'fixed_by': ('initiative', 'support', 'hotfix'),
             'plan': ('plan',), 'promoted_to': ('initiative',), 'escalated_to': ('hotfix',),
             'supersedes': ('analysis',)}
# Keys the vault models on the CHILD, not on the parent: a learning names its initiative with `related_to`, and
# the initiative has no field for its learnings. Writing them on the parent too would draw the edge twice.
REL_ON_CHILD = ('related_learnings', 'related_analyses', 'analyses', 'related_errors', 'slices')
# Keys whose value is a path to a file, not a ref: resolved by file name.
REL_BY_PATH = ('plan',)


def relations_of(item, by_ref, by_base):
    """(values for its link fields, notes). A ref with its own field goes there; the rest go to `relations`."""
    fits = REL_FIELD.get(item['type'], {})
    vals, generic, notes = {}, [], []
    for key, raw_ref in item['relations']:
        if key in REL_ON_CHILD:
            continue  # the child carries this edge
        target = None
        if key in REL_BY_PATH:
            # `plan: ../../plans/INI-042-….md` names the plan by its file name; the ref inside it is the
            # initiative's, so resolving that ref would point the initiative at itself.
            for part in (item['fields'].get(key) if isinstance(item['fields'].get(key), list)
                         else [item['fields'].get(key)]):
                base = os.path.basename(str(part or '')).removesuffix('.md')
                if base in by_base:
                    target = by_base[base]
        if target is None:
            target = by_ref.get(raw_ref) or by_base.get(raw_ref)
        if target is None:
            notes.append({'key': key, 'ref': raw_ref, 'why': 'names nothing in the sources'})
            continue
        if target is item:
            continue
        field = fits.get(key)
        if field and target['type'] in REL_TYPES.get(field, ()):
            vals[field] = target['id'] if field != 'depends_on' else [*vals.get(field, []), target['id']]
        else:
            generic.append(target['id'])
    if generic:
        vals['relations'] = sorted(set(generic))
    return vals, notes


def read_items(github, sources):
    """Every item of those sources, with its parent resolved both ways: what it says, and what names it."""
    items = []
    for d in sources:
        for path, status_folder in d.walk(github):
            items.append(rd.map_item(d, path, status_folder))
    # What an initiative or a support ticket declares as its own, by ref and by file name: in these trees the
    # parent is often only written on the parent's side (`related_learnings: [<file name>.md]`).
    owner = {}
    for i in items:
        if i['type'] not in ('initiative', 'support'):
            continue
        for key in ('related_learnings', 'related_analyses', 'analyses', 'plan'):
            raw = i['fields'].get(key)
            for part in (raw if isinstance(raw, list) else [raw]):
                val = str(part or '').strip()
                if not val:
                    continue
                owner.setdefault(os.path.basename(val)[:-3] if val.endswith('.md') else os.path.basename(val),
                                 i['old_ref'])
                for r in rd.REF_RE.findall(val):
                    owner.setdefault(r, i['old_ref'])
    for i in items:
        if not i['parent'] and i['type'] in ('plan', 'analysis', 'learning'):
            i['parent'] = owner.get(i['basename'][:-3]) or owner.get(i['old_ref'] or '') or ''
    return items


def _taken_keys(existing):
    """Every ref and alias the vault already answers to: an imported alias never steals one of them."""
    out = set()
    for it in existing:
        if it.get('ref'):
            out.add(it['ref'])
        for a in (it['fields'].get('aliases') or []):
            out.add(str(a))
    return out


def make_items_plan(vault, github, only=None):
    store = Store(vault, structure=REGISTRY[TARGET])
    result = store.check()
    if not result['ok']:
        raise PlanError(f"{vault} does not match its structure: fix that first")
    stale = placeholders(vault)
    existing, _ = store.scan()
    have = projects_in(vault)
    taken = _taken_keys(existing)
    counter = int(store._id_marks().get('number') or 0)
    codec = REGISTRY[TARGET].codec

    known = inventory().ITEM_SOURCES
    chosen = {k: v for k, v in known.items() if not only or k in only}
    if not chosen:
        raise PlanError(f"no sources for {', '.join(only or [])}: known projects are "
                        f"{', '.join(known)}")
    items, questions, collisions, dropped = [], [], [], []
    for key, sources in chosen.items():
        if key not in have:
            raise PlanError(f'the project {key} is not in the vault: run --phase projects first')
        items += read_items(github, sources)
    # A deterministic order, so two runs hand out the same ids: source, type, date, file name.
    items.sort(key=lambda i: (i['source'], i['type'], i['creation_date'] or '', i['basename']))

    by_ref = {i['old_ref']: i for i in items if i['old_ref']}
    by_base = {i['basename'][:-3]: i for i in items}
    seen_ref = collections.Counter(i['old_ref'] for i in items if i['old_ref'])
    for ref, n in seen_ref.items():
        if n > 1:
            questions.append({'id': f'dupe-{ref}', 'answered': False, 'answer': None,
                              'ask': f'{ref} names {n} files in the sources: say which one is the item.'})

    # Ids first, so a relation can name an item that comes later in the walk.
    n = counter
    for i in items:
        n += 1
        i['id'] = n
    rows, n = [], counter
    for i in items:
        n += 1
        stamp = f"{i['creation_date'] or datetime.now().strftime('%Y-%m-%d')}T00:00"
        aliases = []
        for a in i['aliases']:
            if a in taken:
                collisions.append({'alias': a, 'item': i['basename'],
                                   'why': 'the vault already answers to it: only the qualified alias is written'})
            else:
                aliases.append(a)
                taken.add(a)
        if i['old_ref'] and f"{i['source'].split('-')[0]}/{i['old_ref']}" not in aliases:
            aliases.append(f"{i['source'].split('-')[0]}/{i['old_ref']}")
        rows.append({'source': i['source'], 'type': i['type'], 'project': i['project'],
                     'path': os.path.relpath(i['path'], github), 'basename': i['basename'],
                     'old_ref': i['old_ref'], 'subject': i['subject'], 'id': n, 'stamp': stamp,
                     'stem': codec.file_name(i['type'], n, i['subject'], stamp)[:-3],
                     'aliases': aliases, 'parent': i['parent'],
                     'status': i['values'].get('status', ''), 'notes': i['notes']})
        for u in i['unmapped']:
            questions.append({'id': f"value-{u['key']}-{abs(hash(u['value'])) % 10000}", 'answered': False,
                              'answer': None, 'ask': f"{i['basename']}: `{u['key']}: {u['value']}` is not a value "
                                                     f"the vault has. Say the one it means, or 'drop'."})
        links, notes = relations_of(i, by_ref, by_base)
        rows[-1]['links'] = {k: v for k, v in links.items()}
        for nt in notes:
            dropped.append({'item': i['basename'], **nt})
    # One question per distinct unanswerable value, not one per file.
    uniq = {}
    for q in questions:
        uniq.setdefault(q['ask'].split(': ', 1)[-1], q)
    questions = list(uniq.values())

    return {
        'plan_version': PLAN_VERSION, 'phase': 'items', 'created': datetime.now().strftime('%Y-%m-%d %H:%M'),
        'vault': os.path.abspath(vault), 'github': os.path.abspath(github),
        'vault_digest': vault_digest(vault), 'placeholders': stale,
        'sources': getattr(SOURCES, '__source_path__', None),
        'sources_digest': {d.root: digest(os.path.join(github, d.root))
                           for ss in chosen.values() for d in ss},
        'projects': [{'key': k, 'name': have[k]['name'], 'confirmed': False} for k in chosen],
        'counter_was': counter, 'items': rows, 'alias_collisions': collisions,
        'dropped_relations': dropped,
        'left_in_repo': [{'path': p, 'why': w} for p, w in inventory().LEFT_IN_REPO],
        'only': sorted(chosen),
        'questions': questions,
        'counts': {'items': len(rows), 'ids': f'{counter + 1}..{counter + len(rows)}',
                   'by_type': dict(collections.Counter(r['type'] for r in rows)),
                   'by_status': dict(collections.Counter(r['status'] or '(none)' for r in rows)),
                   'by_source': dict(collections.Counter(r['source'] for r in rows)),
                   'no_frontmatter': sum(1 for r in rows if any('no frontmatter' in n for n in r['notes'])),
                   'dropped_relations': len(dropped), 'alias_collisions': len(collisions)},
        'written': [], 'patched': [],
    }


def validate_items(plan):
    if plan.get('placeholders'):
        raise PlanError(f"{len(plan['placeholders'])} iCloud files are not downloaded yet: download them first")
    open_ = [p['key'] for p in plan['projects'] if not p.get('confirmed')]
    if open_:
        raise PlanError('confirm the projects that receive the items ("confirmed": true): ' + ', '.join(open_))
    unanswered = [q['id'] for q in plan['questions'] if not q.get('answered')]
    if unanswered:
        raise PlanError('these questions need the owner\'s answer ("answered": true): ' + ', '.join(unanswered))


def apply_items(plan, out=sys.stdout):
    validate_items(plan)
    vault, github = plan['vault'], plan['github']
    if vault_digest(vault) != plan['vault_digest']:
        raise PlanError('the vault changed since the plan was written: write the plan again')
    for root, want in plan['sources_digest'].items():
        if digest(os.path.join(github, root)) != want:
            raise PlanError(f'{root} changed since the plan was written: write the plan again')
    _free_or_say_what_to_close(vault)
    store = Store(vault, structure=REGISTRY[TARGET])
    codec = REGISTRY[TARGET].codec

    items = []
    known = inventory().ITEM_SOURCES
    for key in (plan.get('only') or list(known)):
        items += read_items(github, known[key])
    items.sort(key=lambda i: (i['source'], i['type'], i['creation_date'] or '', i['basename']))
    rows = plan['items']
    if len(items) != len(rows):
        raise PlanError(f'the sources now hold {len(items)} items, the plan {len(rows)}: write the plan again')
    for i, row in zip(items, rows):
        if i['basename'] != row['basename']:
            raise PlanError(f"the walk no longer matches the plan at {row['basename']}: write the plan again")
        i['id'] = row['id']

    # Who is who before the first byte: the vault as it is, plus every stem this apply will write.
    r = store._resolver()
    for row in rows:
        r.key_to_stem[row['id']] = row['stem']
        r.stem_to_key[row['stem']] = row['id']
    by_ref = {i['old_ref']: i for i in items if i['old_ref']}
    by_base = {i['basename'][:-3]: i for i in items}
    by_id = {i['id']: i for i in items}

    written = []
    try:
        with vault_lock(os.path.join(vault, META_DIR), timeout=60):
            for i, row in zip(items, rows):
                parent = by_ref.get(i['parent']) or by_base.get(i['parent'] or '')
                pdict = ({'type': parent['type'], 'id': parent['id'], 'title': parent['subject']}
                         if parent else None)
                links, _ = relations_of(i, by_ref, by_base)
                vals = {**i['values'], 'project': row['project'], **links}
                # The Store always writes this key and says why (tm/store.py `_create_coded`): "a file without
                # the key is a favourite". Writing through the codec skips that, so an imported item would land in
                # the owner's favourites. Only the two types that declare it; elsewhere the key means nothing.
                if 'sidebar' in REGISTRY[TARGET].types[i['type']].fields:
                    vals.setdefault('sidebar', False)
                if parent:
                    vals['related_to'] = parent['id']
                rel, text = codec.new_file(i['type'], i['subject'], vals, i['body'],
                                           r, row['id'], row['stamp'], parent=pdict)
                patch = {'aliases': row['aliases'], 'updated_date': i['updated_date'] or row['stamp'][:10]}
                if i['status_log']:
                    patch['status_log'] = i['status_log']
                written.append(rel)
                write_once(vault, rel, fm.patch(text, patch))
            # The counter last but before anything else can draw from it: a number skipped is harmless, an
            # item the counter does not know about is not (tm/store.py `_mark_ids`).
            marks_path = os.path.join(vault, META_DIR, 'ids.json')
            marks = {}
            if os.path.isfile(marks_path):   # a vault the app has never written to has none yet
                with open(marks_path, encoding='utf-8') as fh:
                    marks = json.load(fh)
            os.makedirs(os.path.dirname(marks_path), exist_ok=True)
            marks['number'] = max(int(marks.get('number') or 0), max(row['id'] for row in rows))
            atomic_write(marks_path, json.dumps(marks, ensure_ascii=False, indent=1) + '\n')
            # And the old ref → new id map, merged into what the short-id migration left.
            legacy = os.path.join(vault, META_DIR, 'legacy-ids.json')
            old = {}
            if os.path.isfile(legacy):
                with open(legacy, encoding='utf-8') as fh:
                    old = json.load(fh)
            for row in rows:
                for a in row['aliases']:
                    old.setdefault(a, row['id'])
            atomic_write(legacy, json.dumps(old, ensure_ascii=False, indent=1) + '\n')
    except VaultBusy:
        plan['written'] = written
        raise PlanError('another program holds the vault lock: close the app (:3200) and Obsidian, then apply '
                        'again. --rollback undoes what is in the plan.') from None
    except (StoreError, PlanError) as e:
        plan['written'] = written
        raise PlanError(f'{e}. {len(written)} items are in; --rollback undoes them.')
    plan['written'] = written
    print(f'{len(written)} items written to {vault}', file=out)
    return plan


def check_items(plan, out=sys.stdout):
    vault = plan['vault']
    store = Store(vault, structure=REGISTRY[TARGET])
    bad = []
    result = store.check()
    if not result['ok']:
        bad.append(f"the vault does not match its structure: {len(result.get('blocking') or [])} blocking findings")
    items, _ = store.scan()
    # `scan` gives every id as text (a project's id is its key, `VIDA`): compare as text, not as numbers.
    by_id = {str(it['id']): it for it in items}
    missing = [row for row in plan['items'] if str(row['id']) not in by_id]
    if missing:
        bad.append(f"{len(missing)} items of the plan are not in the vault (first: {missing[0]['stem']})")
    wrong = [row for row in plan['items'] if str(row['id']) in by_id
             and os.path.splitext(os.path.basename(by_id[str(row['id'])]['path']))[0] != row['stem']]
    if wrong:
        bad.append(f"{len(wrong)} items are not named as the plan says (first: {wrong[0]['stem']})")
    # Every closed item has a log that ends where its status says, so completed_at is not blank.
    nolog = [row for row in plan['items'] if row['status'] in ('Done', 'Discarded') and str(row['id']) in by_id
             and not by_id[str(row['id'])]['fields'].get('completed_at')]
    if nolog:
        bad.append(f"{len(nolog)} closed items have no completed_at: their status_log did not land")
    # The aliases answer.
    unfound = []
    for row in plan['items'][:: max(1, len(plan['items']) // 60)]:
        for a in row['aliases']:
            try:
                got = store.find(a)
            except StoreError:
                got = None
            if not got or str(got['id']) != str(row['id']):
                unfound.append(a)
    if unfound:
        bad.append(f"{len(unfound)} aliases do not resolve to their item (first: {unfound[0]})")
    for root, want in plan['sources_digest'].items():
        if digest(os.path.join(plan['github'], root)) != want:
            bad.append(f'{root} was written: the sources must be untouched')
    for line in bad:
        print('  ✗ ' + line, file=out)
    if not bad:
        print(f"  ✓ {len(plan['items'])} items in, named as planned, closed ones with their history, "
              f"aliases resolving, sources untouched", file=out)
    return not bad

if __name__ == '__main__':
    sys.exit(main())
