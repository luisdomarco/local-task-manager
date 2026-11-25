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
from ..kinds import KIND_KEY, KINDS, LEGACY_KIND_KEY, NEW_KIND, initiative_kind_of, project_delivers, widens
from . import specs
from .definition import CLOSED, EXECUTION_MODES, LEVELS

DEFAULT_DUE_DAYS = {'C1': 0, 'C2': 7, 'C3': 30}
LEVEL_PRIORITY = {'C1': 'P0', 'C2': 'P1', 'C3': 'P2'}  # a promoted support ticket's initiative
OPEN = ('Backlog', 'ToDo', 'OnHold', 'InProgress', 'Review')
# A readiness gate is a condition of the status reached, never a property of one edge into it: every way into a status
# where the work happens asks for it, unless it comes from one that already passed it. So OnHold, which returns to
# every open status, is no way around the gate, and resuming work after a pause is not asked to verify again.
WORK = ('ToDo', 'InProgress', 'Review')
PASSED = frozenset({'ToDo', 'InProgress', 'Review', 'Done'})  # Done is only reached through Review
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


def _kind(r, f):
    """The kind of an initiative of fields `f` (tm/structures/kinds.py): its own, else its project's from before."""
    return initiative_kind_of(f, _project(r, f.get('project')))


def delivers(store, r, key, items=None):
    """Whether project `key` has delivery work (kinds.project_delivers): its settings and its support tickets follow."""
    inis = [i['fields'] for i in (items if items is not None else store.items())
            if i['type'] == 'initiative' and i['fields'].get('project') == key]
    return project_delivers(_project(r, key), inis)


def _delivering_kind(store, r, key):
    """The kind of an initiative a support ticket of project `key` is promoted to: that of its project's latest
    delivering initiative, else its note's own from before, else the first delivering kind."""
    inis = [i for i in store.items() if i['type'] == 'initiative' and i['fields'].get('project') == key]
    for i in sorted(inis, key=lambda i: str(i['fields'].get('created_at') or ''), reverse=True):
        kind = _kind(r, i['fields'])
        if kind.delivers:
            return kind.id
    legacy = KINDS.get(str(_project(r, key).get(LEGACY_KIND_KEY) or '').strip())
    return legacy.id if legacy and legacy.delivers else next(k.id for k in KINDS.values() if k.delivers)


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
    if t == 'project':  # its settings, as the create form fills them in: checked as an edit of them is
        return _project_settings(values)
    if t == 'initiative':  # what it is: what it says; else what its project said before kinds moved to initiatives
        legacy = str(_project(r, values.get('project')).get(LEGACY_KIND_KEY) or '').strip()  # (as its others read),
        kind = str(values.get(KIND_KEY) or (legacy if legacy in KINDS else NEW_KIND)).strip()  # else Simple
        if kind not in KINDS:
            raise _err(f"{KIND_KEY} must be {' or '.join(KINDS)}")
        values[KIND_KEY] = kind
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
        # The kind it said before kinds moved to initiatives is what its initiatives that say none read: kept as it is.
        if LEGACY_KIND_KEY in values and str(values[LEGACY_KIND_KEY] or '').strip() != str(f.get(LEGACY_KIND_KEY) or '').strip():
            raise _err(f'{LEGACY_KIND_KEY} is kept as it is: each initiative says its own kind ({KIND_KEY})')
        return _project_settings(values)
    if t == 'initiative' and KIND_KEY in values:  # what it is: only widened (simple → product or system)
        old, new = _kind(r, f).id, str(values[KIND_KEY] or '').strip()
        if new not in KINDS:
            raise _err(f"{KIND_KEY} must be {' or '.join(KINDS)}")
        if not widens(old, new):
            raise _err(f'an initiative of kind {old} cannot become {new}: a kind only widens (its stories, PRD and readiness would be left)')
        values[KIND_KEY] = new
        # Widening is a declaration ("this delivers"), so the gate belongs at the declaration. The readiness gate
        # fires once, when the initiative enters work, and it asked what the kind it was then had of it — nothing,
        # for a `simple`. It never fires again, so without this an initiative already in work becomes one that
        # delivers with none of what that asks. Refused rather than sent backwards: it is being worked on.
        # Its story is NOT asked here, and cannot be: a story only hangs from an initiative that already delivers
        # (Store._check_initiative_has), so demanding one before widening would make widening impossible. What is
        # asked is the readiness that a simple one was excused from and that nothing will ask for again.
        if by == 'agent' and KINDS[new].delivers and f.get('status') in PASSED:
            eff = {**f, **values}
            lacks = [k for k in ('size', 'regime') if not eff.get(k)]
            if eff.get('premise') != 'verified':
                lacks.append('its premise verified')
            if lacks:
                raise _err(f'an initiative already in work cannot become {new} without {", ".join(lacks)}: '
                           f'what a {new} delivers was never asked of it')
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


def _project_settings(values):
    """A project's settings as its card edits them: a known execution mode; a whole number of days (0 or more) per
    level; the repo and its system as text."""
    if 'execution_mode' in values and values['execution_mode'] not in EXECUTION_MODES:
        raise _err(f'execution_mode must be one of {list(EXECUTION_MODES)}')
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


def starting_work(old, new):
    """Whether this move is the start of work and so asks for the type's readiness: `new` is a status where work
    happens and `old` is not one that already passed the gate (SUP-392: asking "does it go Backlog → ToDo?" let
    Backlog → OnHold → InProgress through, since OnHold is a status the gate was never written for)."""
    return new in WORK and old not in PASSED


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
    if t == 'initiative' and starting_work(old, new):  # what its kind has of it: a simple one, only its objective
        kind = _kind(r, f)
        # `objective` is asked of every kind, because it is not delivery machinery: it is how the initiative says
        # when it is over, and that is what tells an initiative from an area. No kind hides it, so the same
        # comprehension covers all three.
        missing = [key for key in ('objective', 'size', 'regime') if not kind.hides('initiative', key) and not f.get(key)]
        if kind.delivers and not stories_of(store, it['key']):
            missing.append('at least one story')
        if missing:
            raise _err(f"an initiative is ready ({new}) only with {', '.join(missing)}")
        if not kind.hides('initiative', 'premise'):
            _check_premise(f, r, new)
    if t == 'initiative' and new in ('Review', 'Done'):
        kind = _kind(r, f)
        open_ = [c['key'] for c in delivery_children_of(store, it['key'], kind) if c['fields'].get('status') not in CLOSED]
        if open_:
            what = 'stories' if kind.delivers else 'tasks'
            raise _err(f"an initiative closes with its {what}: {', '.join(open_)} still open")
    if t == 'story' and starting_work(old, new):
        ini = next((i for i in store.items() if i['key'] == f.get('related_to') and i['type'] == 'initiative'), None)
        _check_story_ready(f, ini, store.read(it['key'])['body'], new)  # the body as saved: a status changes on its own
    if new == 'InProgress' and t in SERIAL:
        p = _project(r, f.get('project'))
        if p.get('execution_mode') == 'serial' and delivers(store, r, f.get('project')):
            busy = [i for i in store.items() if i['key'] != it['key'] and i['fields'].get('project') == f.get('project')
                    and i['type'] in SERIAL and i['fields'].get('status') == 'InProgress']
            if busy:
                raise _err(f"project {f.get('project')} runs one thing at a time: {busy[0]['key']} is in progress")


def stories_of(store, ini_key, items=None):
    """The stories of an initiative (its `initiative:` link), closed ones too."""
    return [i for i in (items if items is not None else store.items()) if i['type'] == 'story' and i['fields'].get('related_to') == ini_key]


def _kind_of(store, ini, items=None):
    """The kind of an initiative item without the resolver: `after_update` has no `r` (the Store calls it through
    `_rule`), so the project's fields are read from the items themselves."""
    items = items if items is not None else store.items()
    # Matched on `project_key`, not on the project's own key, which is its note's path: `project` holds the former.
    # It only shows on an initiative from before kinds moved to initiatives, which reads its project's kind — with
    # the wrong fields it would read the default instead.
    pk = ini['fields'].get('project')
    pf = next((i['fields'] for i in items if i['type'] == 'project' and i['fields'].get('project_key') == pk), {})
    return initiative_kind_of(ini['fields'], pf)


def delivery_children_of(store, ini_key, kind, items=None):
    """What an initiative delivers through, closed ones too: its **stories** when its kind delivers, its **tasks**
    when it is `simple`. A `simple` has no stories by design (its kind hides them), so a task is its unit of
    delivery and its state follows them.

    Only children whose parent link points at this initiative: a task of a support, a hotfix or a prd is not one of
    these. Separate from `stories_of` on purpose — the readiness gate asks a delivering kind for a *story*, and
    that must keep meaning story whatever this returns."""
    t = 'story' if kind.delivers else 'task'
    return [i for i in (items if items is not None else store.items())
            if i['type'] == t and i['fields'].get('related_to') == ini_key]


def _check_story_ready(f, ini, body, new='ToDo'):
    """A story's first move into work (`new`, usually ToDo): is it ready to be built? `f` is the story's fields as they
    will be (its own and the change), `ini` its initiative (an item, or None when it hangs from nothing), `body` the
    story's Markdown text.
    Ready: its initiative approved (ToDo or later), at least one acceptance scenario written, its spec impact declared."""
    missing = []
    if not ini:
        missing.append('its initiative')
    elif ini['fields'].get('status') not in PASSED:  # approved is a condition, not "anything but Backlog": OnHold counts
        missing.append(f"its initiative approved ({ini['key']} is in {ini['fields'].get('status')})")
    if not _written_scenarios(body):
        missing.append('a written acceptance scenario (- **WHEN** …)')
    if not str(f.get('spec_impact') or '').strip():
        missing.append('its spec impact (the specs it changes, or "none: <why>")')
    if missing:
        raise _err(f"a story is ready ({new}) only with {', '.join(missing)}")


def _written_scenarios(body):
    """The WHEN lines under `## Acceptance criteria` that say something (the template's `- **WHEN** …` does not)."""
    lines = (body or '').split('\n')
    at = next((i for i, l in enumerate(lines) if l.strip().lower() == '## acceptance criteria'), None)
    if at is None:
        return []
    end = next((j for j in range(at + 1, len(lines)) if lines[j].startswith('## ')), len(lines))
    whens = [WHEN_RE.match(l) for l in lines[at + 1:end]]
    return [m.group(1) for m in whens if m and m.group(1).strip(' .…<>')]


def _check_premise(f, r, new='ToDo'):
    if f.get('premise') != 'verified':
        raise _err(f'an initiative is ready ({new}) only with its premise verified')
    max_age = _project(r, f.get('project')).get('premise_max_age_days') or 14
    when = str(f.get('premise_verified') or '')[:10]
    try:
        age = (date.today() - date.fromisoformat(when)).days
    except ValueError:
        raise _err('premise verified needs its date first: "<YYYY-MM-DD> @ <sha>"')
    if age > int(max_age):
        raise _err(f'the premise was verified {age} days ago (more than {max_age}): verify it again')


def after_update(store, before, values, stamp):
    """What moves on its own, and only ever forward:

    - an initiative follows its delivery children (its stories, or its tasks when it is `simple`): to InProgress
      with the first that starts, to **Review** when the last closes and one of them was done;
    - a project follows its initiatives, to InProgress when one of them starts — and never on a close;
    - a support ticket waiting on what it became closes with it.

    Every one of these fires only from a status that already passed its own gate, which is what keeps a rule from
    walking around one. And none of them closes anything: closing is a decision.
    """
    t, f = before['type'], before['fields']
    new_status = values.get('status')
    if not new_status or new_status == f.get('status'):
        return
    if t in ('story', 'task') and f.get('related_to'):
        _follow_children(store, f['related_to'], before, new_status, stamp)
    if t == 'initiative' and new_status == 'InProgress':
        _follow_initiatives(store, f.get('project'), stamp)
    if new_status == 'Done' and t in ('initiative', 'hotfix'):
        _close_waiting(store, t, before['key'], stamp)


def _close_waiting(store, t, key, stamp):
    """The support tickets on hold until this initiative or hotfix was done (promoted or escalated to it) close with it."""
    field = 'promoted_to' if t == 'initiative' else 'escalated_to'
    for sup in store.items():
        if sup['type'] == 'support' and sup['fields'].get(field) == key and sup['fields'].get('status') == 'OnHold':
            store.close_by_rule(sup, 'Done', stamp)


def _follow_children(store, ini_key, child, new_status, stamp):
    """An initiative follows its delivery children: **ToDo → InProgress** when one starts; **InProgress → Review**
    when the last one closes and one of them was done (all discarded: it stays, for the owner to discard or replan).

    It stops at Review on purpose. Closing is a decision, never a rule, and Review is where the owner is told
    there is something to look at. That is also why nothing is closed here: the support tickets that waited on this
    initiative (`promoted_to`) close when it reaches **Done**, through `after_update` — a rule's move runs no hooks,
    so doing it from here would close them before anyone had looked.

    `child` is the item that moved. Only the shape its kind delivers through counts: a task moves a `simple`, a
    story moves one that delivers, and anything else moves nothing — a task of a support has its own parent, and a
    story under a `simple` is not its unit of delivery.
    """
    items = store.items()
    ini = next((i for i in items if i['key'] == ini_key and i['type'] == 'initiative'), None)
    if not ini or ini['fields'].get('status') in CLOSED:
        return
    kind = _kind_of(store, ini, items)
    if child['type'] != ('story' if kind.delivers else 'task'):
        return
    # Only from ToDo, which already passed the readiness gate. That is what lets the preliminaries of an initiative
    # still in Backlog — its analysis, its prd, its plan, its research tasks — run without declaring it under way.
    if new_status == 'InProgress' and ini['fields'].get('status') == 'ToDo':
        store.close_by_rule(ini, 'InProgress', stamp)
        # A rule's move runs no hooks, so the project it just put to work is told from here — the same reason the
        # support tickets used to be closed inline.
        _follow_initiatives(store, ini['fields'].get('project'), stamp)
        return
    if new_status not in CLOSED or ini['fields'].get('status') == 'Review':
        return
    now = {c['key']: (new_status if c['key'] == child['key'] else c['fields'].get('status'))
           for c in delivery_children_of(store, ini_key, kind, items)}
    if all(st in CLOSED for st in now.values()) and 'Done' in now.values():
        store.close_by_rule(ini, 'Review', stamp)


def _follow_initiatives(store, project_key, stamp):
    """A project follows its initiatives, and only forward: **ToDo → InProgress** when one of them starts.

    Never on a close: a project is a place, not a bet — `SPEC-329` §1b has it closing *"when there is no work left
    to host"*, which is a decision and not the end of a batch. And never from Backlog or OnHold: parking it was a
    decision, so waking it is another one.
    """
    if not project_key:
        return
    # A project is addressed by its own key (its note's path), not by `project_key` — which is what an item's
    # `project` field holds, so that is what has to be matched.
    p = next((i for i in store.items()
              if i['type'] == 'project' and i['fields'].get('project_key') == project_key), None)
    if p and p['fields'].get('status') == 'ToDo':
        store.close_by_rule(p, 'InProgress', stamp)


# ── promote / escalate ───────────────────────────────────────────────────────
def promote(store, key):
    """SUP → INI: the initiative has origin [[SUP]] and the priority its level implies; the ticket waits OnHold."""
    sup = store.find(key)
    _promotable(sup)
    _turned_on(store, 'initiative')
    f = sup['fields']
    ini = store.create('initiative', sup['title'], {'project': f.get('project'), 'origin': sup['key'],
                                                    KIND_KEY: _delivering_kind(store, store._resolver(), f.get('project')),
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
