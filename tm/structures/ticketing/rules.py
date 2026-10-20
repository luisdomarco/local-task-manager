"""The rules of Ticketing's types (docs/ticketing-second-brain 05 and 09): what the app checks or does on its own
when a ticket is created or changes. Each function gets the Store (to read other items and patch them), never the
disk directly.

Kept: a support ticket's level (up, never down without a new reason; at most one above where it was born) and its
due date; a duplicate support ticket (same signature, open) adds an occurrence instead of a new ticket; the
allowed status transitions per type and their gates (discard_reason, on_hold, a hotfix's rollback plan and
post-mortem, an initiative's readiness, a serial project); promote (SUP → INI) and escalate (SUP → HFX); the
support ticket that closes when what it became closes, and the umbrella that closes with its last slice.
Left to the agents and git: commits, branches, shas in production, openspec, frozen owner sections.
"""

from datetime import date, timedelta

from ...frontmatter import split as fm_split
from .definition import CLOSED, CORE_PROJECT_TYPES, EXECUTION_MODES, LEVELS, PROJECT_TYPES

DEFAULT_DUE_DAYS = {'C1': 0, 'C2': 7, 'C3': 30}
LEVEL_PRIORITY = {'C1': 'P0', 'C2': 'P1', 'C3': 'P2'}  # a promoted support ticket's initiative
OPEN = ('Backlog', 'ToDo', 'OnHold', 'InProgress', 'Review')
# Allowed moves (09-ciclo-de-vida). OnHold is allowed from any open status (with why), and back to where work
# can resume; Done → InProgress and Discarded → Backlog reopen.
TRANSITIONS = {
    'initiative': {'Backlog': {'ToDo', 'Discarded'}, 'ToDo': {'InProgress', 'Backlog', 'Discarded'},
                   'InProgress': {'Review', 'ToDo'}, 'Review': {'Done', 'InProgress'},
                   'OnHold': {'Backlog', 'ToDo', 'InProgress', 'Review', 'Discarded'}, 'Done': {'InProgress'}, 'Discarded': {'Backlog'}},
    'support': {'Backlog': {'ToDo', 'InProgress', 'Discarded'}, 'ToDo': {'InProgress', 'Backlog', 'Discarded'},
                'InProgress': {'Review', 'Discarded'}, 'Review': {'Done', 'InProgress'},
                'OnHold': {'InProgress', 'Done', 'Discarded'}, 'Done': {'InProgress'}, 'Discarded': {'Backlog'}},
    'hotfix': {'Backlog': {'ToDo'}, 'ToDo': {'InProgress'}, 'InProgress': {'Review'}, 'Review': {'Done', 'InProgress'},
               'OnHold': {'ToDo', 'InProgress', 'Review'}, 'Done': {'InProgress'}, 'Discarded': {'ToDo'}},
    'prd': {'Backlog': {'Review', 'Discarded'}, 'Review': {'Done', 'Backlog', 'Discarded'}, 'ToDo': {'Review', 'Discarded'},
            'InProgress': {'Review'}, 'OnHold': {'Backlog', 'Review'}, 'Done': {'Discarded', 'Review'}, 'Discarded': {'Backlog'}},
}
HOLDABLE = {'initiative', 'support', 'hotfix', 'prd'}


def _today(stamp):
    return (stamp or '')[:10] or date.today().isoformat()


def _project(r, key):
    return (r.projects.get(key) or {}).get('fields') or {}


def due_for(r, project, level, due_from):
    days = _project(r, project).get('support_due_days')
    days = days if isinstance(days, dict) else DEFAULT_DUE_DAYS
    try:
        start = date.fromisoformat(str(due_from)[:10])
        return (start + timedelta(days=int(days.get(level, DEFAULT_DUE_DAYS.get(level, 7))))).isoformat()
    except (TypeError, ValueError):
        return ''


def _rank(level):
    return LEVELS.index(level) if level in LEVELS else None  # 0 = C1, the most urgent


class RuleError(ValueError):
    """A rule of the structure says no; the Store answers it as a 400 with this message."""


def _err(msg):
    return RuleError(msg)


# ── create ───────────────────────────────────────────────────────────────────
def on_create(store, t, values, r, stamp):
    if t == 'support':
        level = values.get('level') or 'C2'
        if level not in LEVELS:
            raise _err(f'level must be one of {list(LEVELS)}')
        start = _today(stamp)
        values.update(level=level, level_base=level, due_from=start, occurrences=1)
        values.setdefault('due', due_for(r, values.get('project'), level, start))
    if t == 'hotfix':
        values['status'] = 'ToDo'  # born ready: the support ticket it comes from was the triage
    return values


def duplicate_of(store, t, values, items):
    """An open support ticket of the same project with the same signature, if any (its key)."""
    sig = str(values.get('signature') or '').strip()
    if t != 'support' or not sig:
        return None
    for it in items:
        f = it['fields']
        if (it['type'] == 'support' and str(f.get('signature') or '').strip() == sig and f.get('project') == values.get('project')
                and f.get('status') not in CLOSED):
            return it
    return None


def add_occurrence(store, it, evidence, r, stamp):
    """Same signature again: occurrences + 1, the evidence appended under ## Evidence, and at 3 occurrences the
    level rises one step (no more than one above where it was born)."""
    f = it['fields']
    n = int(f.get('occurrences') or 1) + 1
    values = {'occurrences': n}
    rank, base = _rank(f.get('level')), _rank(f.get('level_base'))
    if n >= 3 and rank is not None and rank > 0 and (base is None or rank > base - 1):
        values['level'] = LEVELS[rank - 1]
        values['level_reason'] = f'{n} occurrences'
        values['due'] = due_for(r, f.get('project'), values['level'], f.get('due_from') or _today(stamp))
    line = f"- {_today(stamp)} — {' '.join(str(evidence or 'same signature again').split())}"
    path = store.abs(it['path'])
    with open(path, encoding='utf-8') as fh:
        text = fh.read()
    _, body = fm_split(text)
    lines = body.split('\n')
    at = next((i for i, l in enumerate(lines) if l.strip() == '## Evidence'), None)
    if at is None:
        new_body = body.rstrip('\n') + f'\n\n## Evidence\n\n{line}\n'
    else:
        end = next((j for j in range(at + 1, len(lines)) if lines[j].startswith('## ')), len(lines))
        while end > at + 1 and not lines[end - 1].strip():
            end -= 1
        new_body = '\n'.join([*lines[:end], line, *lines[end:]])
    store.update(it['key'], values, body=new_body.lstrip('\n') if not body.startswith('\n') else new_body)
    return it['key']


# ── update ───────────────────────────────────────────────────────────────────
def on_update(store, it, values, r, stamp):
    t, f = it['type'], it['fields']
    if t == 'project':
        return _project_settings(values)
    if t == 'support' and 'level' in values and values['level'] != f.get('level'):
        new, old, base = _rank(values['level']), _rank(f.get('level')), _rank(f.get('level_base'))
        if new is None:
            raise _err(f'level must be one of {list(LEVELS)}')
        if old is not None and new > old and not (values.get('level_reason') and values['level_reason'] != f.get('level_reason')):
            raise _err('a level goes up, never down: lowering it needs a new level reason')
        if base is not None and new < base - 1:
            raise _err(f"a support ticket rises at most one level above where it was born ({f.get('level_base')})")
        values['due'] = due_for(r, f.get('project'), values['level'], f.get('due_from') or _today(stamp))
    new_status = values.get('status')
    if new_status and new_status != f.get('status') and t in TRANSITIONS:
        _check_transition(store, it, new_status, {**f, **values}, r)
        if t == 'support' and new_status == 'Discarded':
            values.setdefault('disposition', 'discard')
            values.setdefault('resolution', 'discarded')
    return values


def _project_settings(values):
    """A project's settings as its card edits them: a known execution mode; enabled types in their order, the core
    ones always in; a whole number of days (0 or more) per level; the repo and its system as text."""
    if 'execution_mode' in values and values['execution_mode'] not in EXECUTION_MODES:
        raise _err(f'execution_mode must be one of {list(EXECUTION_MODES)}')
    if 'enabled_types' in values:
        given = values['enabled_types'] or []
        unknown = [x for x in given if x not in PROJECT_TYPES]
        if unknown:
            raise _err(f'enabled_types: unknown type {unknown[0]} (one of {list(PROJECT_TYPES)})')
        values['enabled_types'] = [x for x in PROJECT_TYPES if x in CORE_PROJECT_TYPES or x in given]
    if 'support_due_days' in values:
        days = {}
        for level, n in (values['support_due_days'] or {}).items():
            if level not in LEVELS:
                raise _err(f'support_due_days: unknown level {level} (one of {list(LEVELS)})')
            if str(n if n is not None else '').strip() == '':
                continue  # blank: the level's default
            try:
                days[level] = int(str(n).strip())
            except ValueError:
                raise _err(f'support_due_days: {level} must be a whole number of days') from None
            if days[level] < 0:
                raise _err(f'support_due_days: {level} cannot be negative')
        values['support_due_days'] = {level: days.get(level, DEFAULT_DUE_DAYS[level]) for level in LEVELS}
    for key in ('repo', 'managed_by'):
        if key in values:
            values[key] = str(values[key] or '').strip()
    return values


def _check_transition(store, it, new, f, r):
    t, old = it['type'], it['fields'].get('status') or 'Backlog'
    allowed = TRANSITIONS[t].get(old, set())
    if new == 'OnHold' and old in OPEN and t in HOLDABLE:
        hold = f.get('on_hold') if isinstance(f.get('on_hold'), dict) else {}
        if not str(hold.get('why') or '').strip():
            raise _err('putting it on hold needs a reason: fill in On hold → why')
        return
    if new not in allowed:
        raise _err(f'a {t} cannot go from {old} to {new} (from {old}: {", ".join(sorted(allowed)) or "nowhere"})')
    if new == 'Discarded' and not str(f.get('discard_reason') or '').strip():
        raise _err('discarding needs a discard reason')
    if t == 'hotfix' and new == 'InProgress' and not str(f.get('rollback_plan') or '').strip():
        raise _err('a hotfix needs its rollback plan before work starts')
    if t == 'hotfix' and new == 'Done' and not f.get('postmortem'):
        raise _err('a hotfix closes with its post-mortem: link the error record (Post-mortem)')
    if t == 'initiative' and old == 'Backlog' and new == 'ToDo':
        missing = [label for key, label in (('size', 'size'), ('regime', 'regime'), ('plan', 'a linked plan')) if not f.get(key)]
        if missing:
            raise _err(f"an initiative is ready (ToDo) only with {', '.join(missing)}")
        _check_premise(f, r)
    if new == 'InProgress':
        p = _project(r, f.get('project'))
        if p.get('execution_mode') == 'serial':
            busy = [i for i in store.items() if i['key'] != it['key'] and i['fields'].get('project') == f.get('project')
                    and i['type'] in TRANSITIONS and i['fields'].get('status') == 'InProgress']
            if busy:
                raise _err(f"project {f.get('project')} runs one thing at a time: {busy[0]['key']} is in progress")


def _check_premise(f, r):
    if f.get('premise') != 'verified':
        raise _err('an initiative is ready (ToDo) only with its premise verified')
    max_age = _project(r, f.get('project')).get('premise_max_age_days') or 14
    when = str(f.get('premise_verified') or '')[:10]
    try:
        age = (date.today() - date.fromisoformat(when)).days
    except ValueError:
        raise _err('premise verified needs its date first: "<YYYY-MM-DD> @ <sha>"')
    if age > int(max_age):
        raise _err(f'the premise was verified {age} days ago (more than {max_age}): verify it again')


def after_update(store, before, values, stamp):
    """What closes on its own: a support ticket waiting on what it became, an umbrella whose last slice closed."""
    t, f = before['type'], before['fields']
    new_status = values.get('status')
    if not new_status or new_status == f.get('status') or new_status != 'Done':
        return
    items = store.items()
    if t in ('initiative', 'hotfix'):
        field = 'promoted_to' if t == 'initiative' else 'escalated_to'
        for sup in items:
            if sup['type'] == 'support' and sup['fields'].get(field) == before['key'] and sup['fields'].get('status') == 'OnHold':
                store.close_by_rule(sup, 'Done', stamp)
    if t == 'initiative' and f.get('kind') == 'slice' and f.get('related_to'):
        umbrella = next((i for i in items if i['key'] == f['related_to']), None)
        slices = [i for i in items if i['type'] == 'initiative' and i['fields'].get('related_to') == f.get('related_to')
                  and i['fields'].get('kind') == 'slice']
        if umbrella and umbrella['fields'].get('status') not in CLOSED and all(
                (i['fields'].get('status') in CLOSED) or i['key'] == before['key'] for i in slices):
            store.close_by_rule(umbrella, 'Done', stamp)


# ── promote / escalate ───────────────────────────────────────────────────────
def promote(store, key):
    """SUP → INI: the initiative has origin [[SUP]] and the priority its level implies; the ticket waits OnHold."""
    sup = store.find(key)
    _promotable(sup)
    _turned_on(store, 'initiative')
    f = sup['fields']
    ini = store.create('initiative', sup['title'], {'project': f.get('project'), 'origin': sup['key'],
                                                    'priority': LEVEL_PRIORITY.get(f.get('level'), 'P2'), 'labels': f.get('labels') or []})
    store.close_by_rule(sup, 'OnHold', None, {'promoted_to': ini['key'], 'resolution': 'promoted', 'disposition': 'fix',
                                              'on_hold': {'by': 'owner', 'why': f"promoted to {ini['key']}", 'resume_when': f"{ini['key']} is done"}})
    return {'support': store.read(sup['key']), 'created': ini}


def escalate(store, key):
    """SUP → HFX: a hotfix born in ToDo with origin [[SUP]]; the ticket waits OnHold."""
    sup = store.find(key)
    _promotable(sup)
    _turned_on(store, 'hotfix')
    f = sup['fields']
    hfx = store.create('hotfix', sup['title'], {'project': f.get('project'), 'related_to': sup['key'], 'labels': f.get('labels') or []})
    store.close_by_rule(sup, 'OnHold', None, {'escalated_to': hfx['key'], 'resolution': 'escalated', 'disposition': 'fix',
                                              'on_hold': {'by': 'owner', 'why': f"escalated to {hfx['key']}", 'resume_when': f"{hfx['key']} is done"}})
    return {'support': store.read(sup['key']), 'created': hfx}


def _turned_on(store, t):
    """Promote and escalate create a ticket of that type: not while this vault has it turned off."""
    if t not in store.structure.types:
        raise _err(f"{t}s are turned off in this vault (Settings → Vaults)")


def _promotable(sup):
    if sup['type'] != 'support':
        raise _err(f"only a support ticket is promoted or escalated, not a {sup['type']}")
    if sup['fields'].get('status') in CLOSED or sup['fields'].get('promoted_to') or sup['fields'].get('escalated_to'):
        raise _err(f"{sup['key']} was already resolved, promoted or escalated")
