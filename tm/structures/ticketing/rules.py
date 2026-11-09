"""The rules of Ticketing's types (docs/ticketing-second-brain 05 and 09): what the app checks or does on its own
when a ticket is created or changes. Each function gets the Store (to read other items and patch them), never the
disk directly.

Kept: a support ticket's level (up, never down without a new reason; at most one above where it was born) and its
due date; a duplicate support ticket (same signature, open) adds an occurrence instead of a new ticket; the
allowed status transitions per type and their gates (discard_reason, on_hold, a hotfix's rollback plan and
post-mortem, an initiative's and a story's readiness, a spec's valid text, a serial project); promote (SUP → INI) and escalate (SUP → HFX);
the support ticket that closes when what it became closes; the initiative that starts with its first story and closes
with the last. Transitions and gates bind an agent's change only (Store.update `by`): the owner moves freely.
Left to the agents and git: commits, branches, shas in production, openspec, frozen owner sections.
"""

import re
from datetime import date, timedelta

from ...frontmatter import split as fm_split
from ..kinds import KINDS, kind_of
from . import specs
from .definition import CLOSED, EXECUTION_MODES, LEVELS

DEFAULT_DUE_DAYS = {'C1': 0, 'C2': 7, 'C3': 30}
LEVEL_PRIORITY = {'C1': 'P0', 'C2': 'P1', 'C3': 'P2'}  # a promoted support ticket's initiative
OPEN = ('Backlog', 'ToDo', 'OnHold', 'InProgress', 'Review')
WHEN_RE = re.compile(r'^\s*[-*]\s*\*\*WHEN\*\*\s*(.*)$')  # a scenario's "- **WHEN** …" line
# Allowed moves (09-ciclo-de-vida). OnHold is allowed from any open status (with why), and back to where work
# can resume; Done → InProgress and Discarded → Backlog reopen.
TRANSITIONS = {
    'initiative': {'Backlog': {'ToDo', 'Discarded'}, 'ToDo': {'InProgress', 'Backlog', 'Discarded'},
                   'InProgress': {'Review', 'ToDo'}, 'Review': {'Done', 'InProgress'},
                   'OnHold': {'Backlog', 'ToDo', 'InProgress', 'Review', 'Discarded'}, 'Done': {'InProgress'}, 'Discarded': {'Backlog'}},
    'story': {'Backlog': {'ToDo', 'Discarded'}, 'ToDo': {'InProgress', 'Backlog', 'Discarded'},
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
HOLDABLE = {'initiative', 'story', 'support', 'hotfix', 'prd'}
# What a serial project runs one at a time: the work itself, never the initiative that groups it.
SERIAL = ('story', 'support', 'hotfix', 'prd')


def _today(stamp):
    return (stamp or '')[:10] or date.today().isoformat()


def _project(r, key):
    return (r.projects.get(key) or {}).get('fields') or {}


def _kind(r, key):
    """The kind of project `key` (tm/structures/kinds.py): what it has decides which of these rules apply."""
    return kind_of(_project(r, key).get('project_kind'))


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
    if t == 'project':  # its settings, as the create form fills them in: checked as an edit of them is, less those
        kind = kind_of(values.get('project_kind'))  # its kind has no use for (the form fills in every one it shows)
        return _project_settings({k: v for k, v in values.items() if not kind.hides('project', k)}, kind)
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
def on_update(store, it, values, r, stamp, by='agent'):
    """A change's rules. The allowed transitions and their gates bind an agent's change (`by='agent'`: a script, a
    /dev:* command); the owner, in the app, moves a status anywhere. The rest (a level that only goes up, a discarded
    support ticket's resolution) is everyone's."""
    t, f = it['type'], it['fields']
    if t == 'project':
        old, new = str(f.get('project_kind') or '').strip(), str(values.get('project_kind') or '').strip()
        # Its kind is fixed once it says one; a note that names none, or one not known (written by hand), may be given one.
        if 'project_kind' in values and new != old:
            if old in KINDS:
                raise _err('a project keeps the kind it was made with: its types and folders follow from it')
            if new not in KINDS:
                raise _err(f"project_kind must be {' or '.join(KINDS)}")
        kind = kind_of(f.get('project_kind'))
        hidden = [k for k in values if kind.hides('project', k)]
        if hidden:
            raise _err(f'a project of kind {kind.id} has no {hidden[0]}')
        return _project_settings(values, kind)
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
    if by == 'agent' and t == 'spec' and new_status == 'active' and f.get('status') != 'active':
        wrong = specs.problems(store.read(it['key'])['body'])
        if wrong:
            raise _err(f"a spec is active only with valid requirements: {'; '.join(wrong[:3])}")
    if new_status and new_status != f.get('status') and t in TRANSITIONS:
        if by == 'agent':
            _check_transition(store, it, new_status, {**f, **values}, r)
        if t == 'support' and new_status == 'Discarded':
            values.setdefault('disposition', 'discard')
            values.setdefault('resolution', 'discarded')
    return values


def _project_settings(values, kind):
    """A project's settings as its card edits them: a known execution mode; enabled types in their order, the core
    ones always in, only those its `kind` has (kinds.Kind.enabled); a whole number of days (0 or more) per level; the
    repo and its system as text."""
    if 'execution_mode' in values and values['execution_mode'] not in EXECUTION_MODES:
        raise _err(f'execution_mode must be one of {list(EXECUTION_MODES)}')
    if 'enabled_types' in values:
        try:
            values['enabled_types'] = kind.enabled(values['enabled_types'])
        except ValueError as e:
            raise _err(str(e)) from None
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
    if t == 'initiative' and old == 'Backlog' and new == 'ToDo':  # what its kind has of it: a simple one, nothing
        kind = _kind(r, f.get('project'))
        missing = [key for key in ('size', 'regime') if not kind.hides('initiative', key) and not f.get(key)]
        if 'story' in kind.types and not stories_of(store, it['key']):
            missing.append('at least one story')
        if missing:
            raise _err(f"an initiative is ready (ToDo) only with {', '.join(missing)}")
        if not kind.hides('initiative', 'premise'):
            _check_premise(f, r)
    if t == 'initiative' and new in ('Review', 'Done'):
        open_ = [s['key'] for s in stories_of(store, it['key']) if s['fields'].get('status') not in CLOSED]
        if open_:
            raise _err(f"an initiative closes with its stories: {', '.join(open_)} still open")
    if t == 'story' and old == 'Backlog' and new == 'ToDo':
        ini = next((i for i in store.items() if i['key'] == f.get('related_to') and i['type'] == 'initiative'), None)
        _check_story_ready(f, ini, store.read(it['key'])['body'])  # the body as saved: a status changes on its own
    if new == 'InProgress' and t in SERIAL:
        p = _project(r, f.get('project'))
        if p.get('execution_mode') == 'serial' and not _kind(r, f.get('project')).hides('project', 'execution_mode'):
            busy = [i for i in store.items() if i['key'] != it['key'] and i['fields'].get('project') == f.get('project')
                    and i['type'] in SERIAL and i['fields'].get('status') == 'InProgress']
            if busy:
                raise _err(f"project {f.get('project')} runs one thing at a time: {busy[0]['key']} is in progress")


def stories_of(store, ini_key, items=None):
    """The stories of an initiative (its `initiative:` link), closed ones too."""
    return [i for i in (items if items is not None else store.items()) if i['type'] == 'story' and i['fields'].get('related_to') == ini_key]


def _check_story_ready(f, ini, body):
    """Backlog → ToDo of a story: is it ready to be built? `f` is the story's fields as they will be (its own and the
    change), `ini` its initiative (an item, or None when it hangs from nothing), `body` the story's Markdown text.
    Ready: its initiative approved (ToDo or later), at least one acceptance scenario written, its spec impact declared."""
    missing = []
    if not ini:
        missing.append('its initiative')
    elif ini['fields'].get('status') in ('Backlog', 'Discarded'):
        missing.append(f"its initiative approved ({ini['key']} is in {ini['fields'].get('status')})")
    if not _written_scenarios(body):
        missing.append('a written acceptance scenario (- **WHEN** …)')
    if not str(f.get('spec_impact') or '').strip():
        missing.append('its spec impact (the specs it changes, or "none: <why>")')
    if missing:
        raise _err(f"a story is ready (ToDo) only with {', '.join(missing)}")


def _written_scenarios(body):
    """The WHEN lines under `## Acceptance criteria` that say something (the template's `- **WHEN** …` does not)."""
    lines = (body or '').split('\n')
    at = next((i for i, l in enumerate(lines) if l.strip().lower() == '## acceptance criteria'), None)
    if at is None:
        return []
    end = next((j for j in range(at + 1, len(lines)) if lines[j].startswith('## ')), len(lines))
    whens = [WHEN_RE.match(l) for l in lines[at + 1:end]]
    return [m.group(1) for m in whens if m and m.group(1).strip(' .…<>')]


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
    """What moves on its own: an initiative starts with its first story and closes with the last (when at least one
    was done); a support ticket waiting on what it became closes with it."""
    t, f = before['type'], before['fields']
    new_status = values.get('status')
    if not new_status or new_status == f.get('status'):
        return
    if t == 'story' and f.get('related_to'):
        _follow_stories(store, f['related_to'], before['key'], new_status, stamp)
    if new_status == 'Done' and t in ('initiative', 'hotfix'):
        _close_waiting(store, t, before['key'], stamp)


def _close_waiting(store, t, key, stamp):
    """The support tickets on hold until this initiative or hotfix was done (promoted or escalated to it) close with it."""
    field = 'promoted_to' if t == 'initiative' else 'escalated_to'
    for sup in store.items():
        if sup['type'] == 'support' and sup['fields'].get(field) == key and sup['fields'].get('status') == 'OnHold':
            store.close_by_rule(sup, 'Done', stamp)


def _follow_stories(store, ini_key, story_key, new_status, stamp):
    """Its initiative follows a story: ToDo → InProgress when one starts; Done when the last one closes and one of
    them was done (all discarded: the initiative stays, for the owner to discard or replan)."""
    items = store.items()
    ini = next((i for i in items if i['key'] == ini_key and i['type'] == 'initiative'), None)
    if not ini or ini['fields'].get('status') in CLOSED:
        return
    if new_status == 'InProgress' and ini['fields'].get('status') == 'ToDo':
        store.close_by_rule(ini, 'InProgress', stamp)
        return
    if new_status not in CLOSED:
        return
    now = {s['key']: (new_status if s['key'] == story_key else s['fields'].get('status')) for s in stories_of(store, ini_key, items)}
    if all(st in CLOSED for st in now.values()) and 'Done' in now.values():
        store.close_by_rule(ini, 'Done', stamp)
        _close_waiting(store, 'initiative', ini_key, stamp)  # a rule's close runs no hooks: what waited on it, here


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
