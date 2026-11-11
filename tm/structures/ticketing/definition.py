"""The Ticketing structure: the native format of ~/github/docs/ticketing-second-brain.

    Tickets/
    ├── 00 Index Tickets.md            (optional)
    ├── Tasks/ Notes/ Meetings/ Inbox/ Activities/ Work log/      ← the app's own types, outside projects
    ├── Docs/                          ← documents with no project, never items (optional, TSK-039)
    ├── Initiatives/ Stories/ Specs/ Support/ Hotfixes/ PRDs/ Plans/ Analyses/ Records/Errors/ Records/Learnings/
    │                                  ← tickets in no project, each in its type's folder (optional: made with the first)
    └── <Project>/
        ├── 00 <Project>.md            ← fileClass: Ticket Project (project_key, enabled_types, support_due_days…)
        ├── Initiatives/ Support/ Plans/ Analyses/ Records/Errors/ Records/Learnings/
        ├── Stories/                   ← an initiative's deliveries (made with the first story)
        ├── Specs/                     ← what the project's system does today (made with the first spec)
        ├── Hotfixes/ PRDs/            ← when the project enables them (product projects)
        └── Docs/                      ← the project's documents (optional)

A ticket is `<REF> <Title>.md`, its type is its `fileClass`, its id a number from the vault's one counter, drawn
`STY-482` (plans/short-ids.md; a vault from before keeps its long ids, `KEY-TYPE-NNN` or `TSK-NNN`), its status
`status_ticket: "4. InProgress"` (an error: `status_error`), its dates `creation_date`/`updated_date`, its links
wikilinks. `SPEC` says, per type, how its file maps to the app's item (codec.py); `TYPES` is what the app
shows of it (tm/structures TypeDef).
"""

import re

from ...attachments import DIR as ATTACHMENTS_DIR
from .. import Structure, TypeDef, agents
from ..kinds import ENABLEABLE, KINDS, LISTED
from ..relations import relation_kinds
from ..traits import PROJECT_CLOSED, PROJECT_STATUSES, fields_for, parent_label, plannable, with_parent_heading

STATUSES = ('Backlog', 'ToDo', 'OnHold', 'InProgress', 'Review', 'Done', 'Discarded')
CLOSED = frozenset({'Done', 'Discarded'})
ERROR_STATUSES = ('open', 'mitigated', 'resolved')
SPEC_STATUSES = ('draft', 'active', 'retired')  # a spec is active once its text is valid (specs.py)
# A goal's: the basic ones, as the tickets name them (so they read and colour alike), closed by hand.
GOAL_STATUSES = ('ToDo', 'InProgress', 'Done', 'Discarded')
PRIORITIES = ('P0', 'P1', 'P2', 'P3')
LEVELS = ('C1', 'C2', 'C3')
EXECUTION_MODES = ('parallel', 'serial')  # serial: one InProgress at a time in the project, all types
# The types a project's enabled_types names: the core ones every project has, then those it may leave out. Which a
# project has comes from its kind (tm/structures/kinds.py).
CORE_PROJECT_TYPES = LISTED
PROJECT_TYPES = ENABLEABLE
# A long id from before short ids: KEY-TYPE-NNN (a project's ticket) or TYPE-NNN (a root type): group 1 is the prefix,
# group 2 the number. A short id is a bare number (tm/structures NUMBER_RE).
ID_RE = re.compile(r'^((?:[A-Z]{2,4}-)?[A-Z]{3,4})-(\d{3,})$')
PROJECT_KEY_RE = re.compile(r'^[A-Z]{2,4}$')
ROOT_FOLDERS = {'task': 'Tasks', 'note': 'Notes', 'meeting': 'Meetings', 'inbox': 'Inbox', 'activity': 'Activities'}
# Root types whose folder may be missing (the vault still matches; it is made with the first item): the agents, the
# prompts and the transcriptions (types this format gained later, so a vault from before has none of their folders).
OPTIONAL_ROOT_FOLDERS = {'agent': 'Agents', 'prompt': 'Prompts', 'transcription': 'Transcriptions', 'goal': 'Goals'}
WORKLOG_FOLDER = 'Work log'
# Docs (TSK-039): documents, never items — at the top of the vault and inside each project's folder.
DOCS_FOLDER = 'Docs'
INDEX_NOTE = '00 Index Tickets.md'

# How each type's file maps to an item. scope: 'project' (in a project's folder — or, for one in no project, in the
# folder of the same name at the vault's top: PROJECT_ROOT_FOLDERS), 'root' (outside projects) or 'note' (the project
# note itself). title: how the file is named ('id': "<REF> <Title>", 'note': "00 <Project>");
# legacy_title: how a file of that type from before it had ids is named, read when it has none ('plan': "<REF of its
# item> Plan", 'date': "<date> <Title>"). parent: the field that is its `related_to`.
# links / multi_links: fields that hold one wikilink / a list of them (shown to the app as item keys).
# optional: a type the project may leave out (enabled_types).
SPEC = {
    # A project's status is the app's (traits.PROJECT_STATUSES, as a Tasks project's), kept as it is in `status_project`.
    'project': dict(file_class='Ticket Project', scope='note', folder='', code='', title='note', status_key='status_project'),
    'initiative': dict(file_class='Ticket Initiative', scope='project', folder='Initiatives', code='INI', title='id',
                       status_key='status_ticket',
                       links=('prd', 'plan', 'origin'), multi_links=('depends_on', 'related_analyses', 'related_errors', 'related_learnings')),
    # A story is what gets delivered: one branch, one PR, under its initiative. It replaced the initiative's
    # `kind: umbrella / slice` (an initiative now groups stories and closes with the last of them).
    'story': dict(file_class='Ticket Story', scope='project', folder='Stories', code='STY', title='id', status_key='status_ticket',
                  parent='initiative', links=('plan', 'origin'), multi_links=('depends_on',)),
    # A spec: one capability's requirements, as they are in production. A story's Spec delta is merged into it when
    # the story ships; it never has a status of the tickets' kind.
    'spec': dict(file_class='Ticket Spec', scope='project', folder='Specs', code='SPEC', title='id', status_key='status_spec',
                 multi_links=('stories',)),
    'support': dict(file_class='Ticket Support', scope='project', folder='Support', code='SUP', title='id', status_key='status_ticket',
                    links=('promoted_to', 'escalated_to'), multi_links=('caused_by', 'caused_by_candidates', 'depends_on')),
    'hotfix': dict(file_class='Ticket Hotfix', scope='project', folder='Hotfixes', code='HFX', title='id', status_key='status_ticket',
                   parent='origin', links=('postmortem',), optional=True),
    'prd': dict(file_class='Ticket PRD', scope='project', folder='PRDs', code='PRD', title='id', status_key='status_ticket',
                parent='initiative', links=('supersedes', 'superseded_by'), optional=True),
    # A plan and an analysis are named by their id as every ticket is (`PLN-482 <Title>.md`). One from before they had
    # ids has none and keeps its old name (`legacy_title`): a plan after its item (`STY-12 Plan.md`), an analysis after
    # its date (`2026-10-12 <Title>.md`); tools/migrate_short_ids.py numbers them with the rest.
    'plan': dict(file_class='Ticket Plan', scope='project', folder='Plans', code='PLN', title='id', legacy_title='plan', parent='item'),
    'analysis': dict(file_class='Ticket Analysis', scope='project', folder='Analyses', code='ANL', title='id', legacy_title='date',
                     parent='item', links=('supersedes',)),
    'error': dict(file_class='Ticket Error', scope='project', folder='Records/Errors', code='ERR', title='id', status_key='status_error',
                  parent='item', links=('fixed_by',)),
    'learning': dict(file_class='Ticket Learning', scope='project', folder='Records/Learnings', code='LRN', title='id', parent='item'),
    **{t: dict(file_class=f'Ticket {t.capitalize()}', scope='root', folder=folder,
               code={'task': 'TSK', 'note': 'NOTE', 'meeting': 'MTG', 'inbox': 'INB', 'activity': 'ACT'}[t], title='id',
               status_key='status_ticket' if t == 'task' else None, parent=None if t == 'inbox' else 'related_to')
       for t, folder in ROOT_FOLDERS.items()},
    'agent': dict(file_class='Ticket Agent', scope='root', folder=OPTIONAL_ROOT_FOLDERS['agent'], code='AGT', title='id',
                  status_key='status_agent', parent='related_to'),
    # A reusable prompt (its body is the prompt): no status, no parent, no project; active until archived.
    'prompt': dict(file_class='Ticket Prompt', scope='root', folder=OPTIONAL_ROOT_FOLDERS['prompt'], code='PRM', title='id'),
    # A meeting's text: its body is the transcript, its parent the meeting.
    'transcription': dict(file_class='Ticket Transcription', scope='root', folder=OPTIONAL_ROOT_FOLDERS['transcription'], code='TRN',
                          title='id', parent='related_to'),
    # A goal: what a set of projects, initiatives, stories and tasks is for, across projects (Goals view). It hangs from
    # nothing; each of them names it in its own `goal:` (one goal at most), and keeps its place in it in `goal_order`.
    'goal': dict(file_class='Ticket Goal', scope='root', folder=OPTIONAL_ROOT_FOLDERS['goal'], code='GOL', title='id',
                 status_key='status_goal'),
}
for _spec in SPEC.values():
    _spec.setdefault('status_key', None)
    _spec.setdefault('parent', None)
    _spec.setdefault('links', ())
    _spec.setdefault('multi_links', ())
    _spec.setdefault('optional', False)
    _spec.setdefault('legacy_title', None)
BY_FILE_CLASS = {s['file_class']: t for t, s in SPEC.items()}
# A parent written under its old name, still read (never written): a PRD's `umbrella:`, from before stories.
LEGACY_PARENT = {'prd': 'umbrella'}


def _opts(*values):
    return [[v, v] for v in values]


# The fields shown on an item's card beyond the app's own (status, priority, plan, due, labels…), in order.
# kind: text · textarea · select · checks (several of `options`; `fixed` always on) · number · date · link (one item, of
# `types`) · links (several) · readonly · map (`keys`, as numbers with `number`; with `key_labels`, a row per key).
P = dict
# Why it is paused: who holds it, why, and when to pick it up again; each key a row of its own under its own name
# (`key_labels`), as every other field of its group.
# What makes an item part of a goal: the goal it names (one at most) and its place among the goal's items (the Goals view).
IN_GOAL = (P(key='goal', label='Goal', kind='link', types=['goal']),
           P(key='goal_order', label='Goal order', kind='number', tab='hidden'))
ON_HOLD = P(key='on_hold', label='On hold', kind='map', keys=['by', 'why', 'resume_when'],
            key_labels={'by': 'On hold by', 'why': 'Why on hold', 'resume_when': 'Resume when'})
PROPS = {
    # Its kind is chosen once, on creation (`once`: the create form offers `options`; read-only after).
    'project': (P(key='project_key', label='Key', kind='readonly'),
                P(key='project_kind', label='Kind', kind='readonly', once=True,
                  options=[[k.id, k.label] for k in KINDS.values()]),
                P(key='execution_mode', label='Execution', kind='select', options=_opts(*EXECUTION_MODES)),
                P(key='enabled_types', label='Types', kind='checks', options=_opts(*PROJECT_TYPES), fixed=list(CORE_PROJECT_TYPES)),
                P(key='support_due_days', label='Support due days', kind='map', keys=list(LEVELS), number=True),
                P(key='repo', label='Repo', kind='text', placeholder='~/github/…'),
                P(key='managed_by', label='Managed by', kind='text', placeholder='~/github/…/.claude'), *IN_GOAL),
    'initiative': (P(key='size', label='Size', kind='select', options=_opts('S', 'M', 'L')),
                   P(key='regime', label='Regime', kind='select', options=_opts('standard', 'critical')),
                   P(key='premise', label='Premise', kind='select', options=_opts('unverified', 'verified', 'reframed', 'refuted')),
                   P(key='premise_verified', label='Premise verified', kind='text', placeholder='<date> @ <sha>; …'),
                   P(key='origin', label='Origin', kind='link', types=['support']),
                   P(key='prd', label='PRD', kind='link', types=['prd']),
                   P(key='plan', label='Plan', kind='link', types=['plan']),
                   P(key='depends_on', label='Depends on', kind='links', types=['initiative', 'support', 'hotfix']),
                   ON_HOLD,
                   P(key='discard_reason', label='Discard reason', kind='text', placeholder='Why it was dropped'), *IN_GOAL),
    'story': (P(key='size', label='Size', kind='select', options=_opts('S', 'M', 'L')),
              P(key='spec_impact', label='Spec impact', kind='text', placeholder='the specs it changes, or "none: <why>"'),
              P(key='origin', label='Origin', kind='link', types=['support', 'task']),
              P(key='plan', label='Plan', kind='link', types=['plan']),
              P(key='depends_on', label='Depends on', kind='links', types=['story', 'support', 'hotfix']),
              ON_HOLD,
              P(key='discard_reason', label='Discard reason', kind='text', placeholder='Why it was dropped'),
              P(key='executor', label='Executor', kind='select', options=_opts('', 'claude', 'codex', 'owner')),
              P(key='branch', label='Branch', kind='text', placeholder='feat/<topic>'), P(key='baseline', label='Baseline', kind='text', placeholder='<sha> it started from'),
              P(key='changelog_ref', label='Changelog', kind='text', placeholder='The changelog entry, or "none"'), *IN_GOAL),
    'task': IN_GOAL,
    # Its description is this field (Markdown; the file's body is not used), drawn as every item's description block.
    'goal': (P(key='description', label='Description', kind='textarea', placeholder='What it is for, and how you will know it is met',
               tab='hidden'),),
    'spec': (P(key='capability', label='Capability', kind='text', placeholder='checkout · weekly report · …'),
             P(key='stories', label='Stories', kind='links', types=['story']),
             P(key='synced_sha', label='Synced at sha', kind='text', placeholder='the commit in production it describes'),
             P(key='synced_date', label='Synced on', kind='date')),
    # Its level and why stand in a priority's slot (`slot`): Status · Level · Due, as Status · Priority · Due elsewhere.
    'support': (P(key='level', label='Level', kind='select', options=_opts(*LEVELS), default='C2', slot='priority'),
                P(key='level_base', label='Level at birth', kind='readonly'),
                P(key='level_reason', label='Level reason', kind='text', slot='priority'),
                P(key='due_from', label='Due from', kind='readonly'),
                P(key='origin', label='Origin', kind='select', options=_opts('manual', 'user', 'judge', 'auditor', 'gate', 'ci', 'monitor', 'curation')),
                P(key='signature', label='Signature', kind='text', placeholder='<origin>|…'),
                P(key='occurrences', label='Occurrences', kind='readonly'),
                P(key='disposition', label='Disposition', kind='select', options=_opts('pending', 'fix', 'discard', 'owner')),
                P(key='resolution', label='Resolution', kind='select', options=_opts('', 'fixed_in_place', 'promoted', 'escalated', 'discarded')),
                P(key='promoted_to', label='Promoted to', kind='link', types=['initiative'], readonly=True),
                P(key='escalated_to', label='Escalated to', kind='link', types=['hotfix'], readonly=True),
                P(key='area', label='Area', kind='text'),
                P(key='should_have_caught', label='Should have caught', kind='text', placeholder='The check that should have caught it'),
                ON_HOLD,
                P(key='discard_reason', label='Discard reason', kind='text', placeholder='Why it was dropped'),
                P(key='executor', label='Executor', kind='select', options=_opts('', 'claude', 'codex', 'owner')),
                P(key='branch', label='Branch', kind='text', placeholder='feat/<topic>'), P(key='subject_sha', label='Observed at sha', kind='text', placeholder='<sha> where it was seen')),
    'hotfix': (P(key='severity', label='Severity', kind='select', options=_opts('critical', 'high', 'medium')),
               P(key='affected', label='Affected', kind='text', placeholder='Who or what it hits'),
               P(key='rollback_plan', label='Rollback plan', kind='textarea'),
               P(key='base_branch', label='Base branch', kind='text', placeholder='main'), P(key='branch', label='Branch', kind='text', placeholder='feat/<topic>'),
               P(key='observation_window', label='Observation window', kind='text', placeholder='How long to watch it after release'),
               P(key='postmortem', label='Post-mortem', kind='link', types=['error']),
               P(key='owner_review', label='Owner review', kind='text', placeholder='Who reviewed it, and when'), P(key='changelog_ref', label='Changelog', kind='text', placeholder='The changelog entry, or "none"')),
    'prd': (P(key='supersedes', label='Supersedes', kind='link', types=['prd']),
            P(key='superseded_by', label='Superseded by', kind='link', types=['prd'])),
    'plan': (P(key='written', label='Written', kind='date'), P(key='base', label='Base', kind='text', placeholder='<branch> @ <sha>'),
             P(key='branch', label='Branch', kind='text', placeholder='feat/<topic>'), P(key='worktree', label='Worktree', kind='text', placeholder="The worktree's folder"),
             P(key='executor', label='Executor', kind='select', options=_opts('', 'claude', 'codex', 'owner')),
             P(key='verifier', label='Verifier', kind='text', placeholder='Who or what checks it'),
             P(key='lane', label='Lane', kind='select', options=_opts('fast', 'normal', 'full'))),
    'analysis': (P(key='kind', label='Kind', kind='select', options=_opts('diagnosis', 'decision', 'review', 'research', 'retro', 'ux', 'brief', 'report')),
                 P(key='base', label='Base', kind='text', placeholder='<branch> @ <sha>'), P(key='author', label='Author', kind='text', placeholder='Who wrote it'),
                 P(key='supersedes', label='Supersedes', kind='link', types=['analysis'])),
    'error': (P(key='severity', label='Severity', kind='select', options=_opts('low', 'medium', 'high', 'critical')),
              P(key='impact', label='Impact', kind='select', options=_opts('1', '2', '3', '4', '5'), default='3'),
              P(key='area', label='Area', kind='text'),
              P(key='fixed_by', label='Fixed by', kind='link', types=['initiative', 'support', 'hotfix'])),
    'learning': (P(key='impact', label='Impact', kind='select', options=_opts('1', '2', '3', '4', '5'), default='3'),
                 P(key='applies_to', label='Applies to', kind='select', options=_opts('project', 'all-projects')),
                 P(key='area', label='Area', kind='text')),
    'agent': agents.PROPS,
}

# Where an item shows each of its own fields besides its properties (TypeDef.props `tab`): 'delivery', how it is
# carried out (execution and git), drawn in its Settings tab after its own; 'settings', a project's settings (a section of the page's own, above its area and
# objective, its kind, types, execution, support due days and where its code lives). Links go to Relations on their own.
TABS = {
    'project': {'settings': ('project_kind', 'execution_mode', 'enabled_types', 'support_due_days', 'repo', 'managed_by'),
                'hidden': ('project_key',)},  # its key heads its page
    # Its PRD and plan are in their own tabs of its page (what hangs from it), not again in Relations; what it depends
    # on is the "Blocked by" kind of its relations (relations.py).
    'initiative': {'delivery': ('size', 'regime', 'premise', 'premise_verified', 'on_hold', 'discard_reason'), 'hidden': ('prd', 'plan', 'depends_on')},
    'spec': {'delivery': ('synced_sha', 'synced_date')},
    'story': {'delivery': ('size', 'spec_impact', 'executor', 'branch', 'baseline', 'changelog_ref', 'on_hold', 'discard_reason'), 'hidden': ('plan', 'depends_on')},
    'support': {'delivery': ('executor', 'branch', 'subject_sha', 'signature', 'should_have_caught', 'on_hold', 'discard_reason')},
    'hotfix': {'delivery': ('base_branch', 'branch', 'observation_window', 'owner_review', 'changelog_ref')},
    'plan': {'delivery': ('base', 'branch', 'worktree', 'executor', 'verifier')},
    'analysis': {'delivery': ('base',)},
}
# The Delivery tab in groups, each under its title and in this order, one field per row (a key is in one group
# whatever its type).
DELIVERY_GROUPS = (
    ('Readiness', 'check', ('regime', 'size', 'premise', 'premise_verified')),
    ('Execution', 'terminal', ('executor', 'base', 'base_branch', 'branch', 'baseline', 'worktree', 'verifier', 'subject_sha')),
    ('Spec and release', 'tag', ('spec_impact', 'synced_sha', 'synced_date', 'observation_window', 'owner_review', 'changelog_ref')),
    ('Triage', 'search', ('signature', 'should_have_caught')),
    ('Paused or discarded', 'ban', ('on_hold', 'discard_reason')),
)
# A project's Settings, the same way: Global (its kind, types and execution), where its code lives and who works it, then
# its support due days.
SETTINGS_GROUPS = (
    ('Global', 'settings', ('project_kind', 'enabled_types', 'execution_mode')),
    ('Code', 'code', ('repo', 'managed_by')),
    ('Support due days', 'clock', ('support_due_days',)),
)
GROUPED_TABS = {'delivery': DELIVERY_GROUPS, 'settings': SETTINGS_GROUPS}
_GROUP = {tab: {key: (n, title, ico, keys.index(key)) for n, (title, ico, keys) in enumerate(groups) for key in keys}
          for tab, groups in GROUPED_TABS.items()}
for _name, _tabs in TABS.items():
    _where = {key: tab for tab, keys in _tabs.items() for key in keys}
    _props = [{**p, 'tab': _where[p['key']]} if p['key'] in _where else p for p in PROPS[_name]]
    _props = [{**p, 'group': _GROUP[p['tab']][p['key']][1], 'group_icon': _GROUP[p['tab']][p['key']][2]} if p.get('tab') in _GROUP else p
              for p in _props]
    # A grouped tab's fields in their groups' order; every other tab keeps the order they are declared in.
    for _tab, _g in _GROUP.items():
        _slots = [i for i, p in enumerate(_props) if p.get('tab') == _tab]
        for _i, _p in zip(_slots, sorted((_props[i] for i in _slots), key=lambda p: _g[p['key']][::3])):
            _props[_i] = _p
    PROPS[_name] = tuple(_props)

# What a later step writes, not whoever opens the ticket (`later`: the create form leaves it out; the card and the page
# show it as before): how it is carried out, released and triaged, a pause, and its outcome. A new file takes the
# template's value for each (disposition: pending, premise: unverified…).
LATER_GROUPS = ('Execution', 'Spec and release', 'Triage', 'Paused or discarded')
LATER = frozenset({key for title, _, keys in DELIVERY_GROUPS if title in LATER_GROUPS for key in keys}
                  | {'premise', 'premise_verified', 'disposition', 'resolution', 'fixed_by', 'postmortem', 'superseded_by'})
PROPS = {name: tuple({**p, 'later': True} if p['key'] in LATER else p for p in props) for name, props in PROPS.items()}

# The types that always hang from another item, never from their project alone: a plan, from what it executes. It is
# created under it (its Parent is required), listed there, not on its project's page, and moved, never let go.
NEEDS_PARENT = ('plan',)
# The sub-documents of an item (its plan, analyses, errors, learnings): they never choose nor drop their project on
# their own. Their project is their item's, and when their item moves (to another project, or to none) they go with it.
SUB_DOCUMENTS = ('plan', 'analysis', 'error', 'learning')
# The tickets that may be in no project, and change or drop theirs (with short ids: a long one carries its project's
# key): every type of a project's folders but the sub-documents. One in no project lives in its type's folder at the
# vault's top (PROJECT_ROOT_FOLDERS), as a task lives in Tasks/.
LEAVES_PROJECT = tuple(t for t, s in SPEC.items() if s['scope'] == 'project' and t not in SUB_DOCUMENTS)
# Where a ticket in no project lives: its type's own folder, at the vault's top (Initiatives/, Records/Errors/…). Each
# is optional, made with its first file; a sub-document of an item in no project is there too. PROJECT_ROOT_TOPS: the
# top folders they make, never a project's name (store._create_project) nor a project's for Docs.
PROJECT_ROOT_FOLDERS = {t: s['folder'] for t, s in SPEC.items() if s['scope'] == 'project'}
PROJECT_ROOT_TOPS = frozenset(f.split('/')[0] for f in PROJECT_ROOT_FOLDERS.values())
# The types that open as a page of their own, and the tables of what hangs from each there, in order.
# Tasks come first on a project's and an initiative's page, in every structure. A project's lists what lives in it,
# whatever it hangs from (a story under an initiative, or under none), but a plan: that is its item's.
PAGES = {
    'project': tuple(t for t in ('task', 'initiative', 'story', 'spec', 'support', 'hotfix', 'prd', 'plan', 'analysis', 'error',
                                 'learning', 'note', 'meeting') if t not in NEEDS_PARENT),
    'initiative': ('task', 'story', 'prd', 'plan', 'analysis', 'error', 'learning', 'note', 'meeting'),
    'prd': ('task', 'analysis', 'note', 'meeting'),
    # What it is made of (each names it in `goal:`), then its notes.
    'goal': ('project', 'initiative', 'story', 'task', 'note'),
}
# The app's own fields of each type (planning, ticket, watchers, comments, Claude sessions…) come from its traits
# (tm/structures/traits.py), the same in every structure; a type adds its props. A type whose props take priority's
# slot (a support ticket's level) has no priority. docs and watchers are written only once used (the codec writes
# only the keys it is given).
EXTERNAL_REF = {'id_key': 'ticket_id', 'url_key': 'ticket_url', 'label': 'Ticket', 'id_placeholder': 'ACME-INI-094', 'url_placeholder': 'https://…'}
INSTEAD = {name: ('priority', 'priority_reason') for name, props in PROPS.items() if any(p.get('slot') == 'priority' for p in props)}
PARENTS = {
    'project': (), 'support': (), 'inbox': (),
    'initiative': (), 'story': ('initiative',), 'spec': (), 'hotfix': ('support',), 'prd': ('initiative',),
    'plan': ('initiative', 'story', 'support'), 'analysis': ('initiative', 'story', 'support', 'hotfix', 'prd'),
    'error': ('initiative', 'story', 'support', 'hotfix'), 'learning': ('initiative', 'story', 'support', 'hotfix'),
    'task': ('initiative', 'story', 'support', 'hotfix', 'prd'),
    'note': ('initiative', 'story', 'support', 'hotfix', 'prd', 'task', 'goal'),
    'meeting': ('initiative', 'story', 'support', 'hotfix', 'prd', 'task'),
    'activity': ('initiative', 'story', 'support', 'hotfix', 'prd', 'task', 'note', 'meeting'),
    'agent': ('initiative',),
    'prompt': (),
    'transcription': ('meeting',),
    'goal': (),
}
# What an inbox item will be filed under once converted (its card's "Related to"): any item a converted one can hang
# from. Kept as `file_under`, not `related_to`: that key is the parent everywhere else, and an inbox item has none.
# Convert to carries it over as the new item's `related_to` when the new type can hang from it (store.convert).
FILE_UNDER_TYPES = sorted({t for name in ('task', 'note', 'meeting') for t in PARENTS[name]})
PROPS['inbox'] = (P(key='file_under', label='Related to', kind='link', types=FILE_UNDER_TYPES, tab='main', becomes='related_to'),)

# The columns follow the folder-per-type structure's order (id · subject · status · priority · planned · due · … · labels · parent), with
# the project right before the parent column: which project, then which ticket in it. Where a type may hang from an
# initiative or from something else, the parent is two columns, as its forms have it: Initiative, then the rest.
# Every list groups by project, and by initiative where its items can reach one (directly, or through what they hang
# from: a note → its task → that task's initiative); a support ticket and a hotfix never do.
LIST_COLS = ['id', 'subject', 'status']
LISTS = {
    # A project's id is its key (ACME): the ID column draws it.
    'project': {'sort': {'col': 'subject', 'dir': 1}, 'relation': None, 'scopes': 'status',
                'columns': [*LIST_COLS, 'priority', 'plan', 'start', 'due', 'labels', 'prop:project_kind:Kind',
                            'prop:execution_mode:Execution', 'goal', 'updated'],
                'group_by': ['status', 'priority', 'plan', 'goal']},
    'initiative': {'sort': {'col': 'priority', 'dir': 1}, 'relation': None, 'scopes': 'status',
                   'columns': [*LIST_COLS, 'priority', 'plan', 'due', 'prop:size:Size', 'extref', 'labels', 'progress', 'project', 'goal', 'updated'],
                   'group_by': ['project', 'status', 'priority', 'plan', 'goal']},
    'story': {'sort': {'col': 'status', 'dir': -1}, 'relation': ['initiative'], 'scopes': 'status',
              'columns': [*LIST_COLS, 'priority', 'plan', 'due', 'prop:size:Size', 'labels', 'progress', 'project', 'parent:Initiative', 'goal', 'updated'],
              'group_by': ['initiative', 'project', 'status', 'priority', 'plan', 'goal']},
    'spec': {'sort': {'col': 'subject', 'dir': 1}, 'relation': None, 'scopes': 'status',
             'columns': [*LIST_COLS, 'prop:capability:Capability', 'prop:synced_date:Synced', 'labels', 'project', 'updated'],
             'group_by': ['project', 'status']},
    'support': {'sort': {'col': 'due', 'dir': 1}, 'relation': None, 'scopes': 'status',
                'columns': [*LIST_COLS, 'prop:level:Level', 'plan', 'due', 'prop:origin:Origin', 'prop:occurrences:×', 'prop:disposition:Disposition', 'labels', 'project', 'updated'],
                'group_by': ['project', 'status', 'plan']},
    'hotfix': {'sort': {'col': 'status', 'dir': -1}, 'relation': ['support'], 'scopes': 'status',
               'columns': [*LIST_COLS, 'prop:severity:Severity', 'plan', 'due', 'labels', 'project', 'parent:Origin', 'updated'], 'group_by': ['project', 'status']},
    'prd': {'sort': {'col': 'status', 'dir': -1}, 'relation': ['initiative'], 'scopes': 'status',
            'columns': [*LIST_COLS, 'labels', 'project', 'parent:Initiative', 'updated'], 'group_by': ['initiative', 'project', 'status']},
    'plan': {'sort': {'col': 'updated_at', 'dir': -1}, 'relation': ['initiative', 'story', 'support'], 'scopes': None,
             'columns': ['id', 'subject', 'prop:lane:Lane', 'project', 'initiative', 'prop:executor:Executor', 'related:Item', 'updated'], 'group_by': ['initiative', 'project']},
    'analysis': {'sort': {'col': 'created_at', 'dir': -1}, 'relation': ['initiative', 'story', 'support', 'hotfix', 'prd'], 'scopes': None,
                 'columns': ['id', 'subject', 'prop:kind:Kind', 'project', 'initiative', 'related:Item', 'created', 'updated'], 'group_by': ['initiative', 'project']},
    'error': {'sort': {'col': 'status', 'dir': 1}, 'relation': ['initiative', 'story', 'support', 'hotfix'], 'scopes': 'status',
              'columns': [*LIST_COLS, 'prop:severity:Severity', 'prop:impact:Impact', 'project', 'initiative', 'related:Found in', 'updated'], 'group_by': ['initiative', 'project']},
    'learning': {'sort': {'col': 'created_at', 'dir': -1}, 'relation': ['initiative', 'story', 'support', 'hotfix'], 'scopes': None,
                 'columns': ['id', 'subject', 'prop:impact:Impact', 'prop:applies_to:Applies to', 'project', 'initiative', 'related:From', 'created'], 'group_by': ['initiative', 'project']},
    'task': {'sort': {'col': 'status', 'dir': -1}, 'relation': ['initiative', 'story', 'support', 'hotfix', 'prd'], 'scopes': 'status',
             'relation_label': 'Ticket', 'relation_any': 'Any ticket',
             'columns': [*LIST_COLS, 'priority', 'plan', 'due', 'labels', 'project', 'initiative', 'related:Related to', 'goal', 'updated'],
             'group_by': ['initiative', 'project', 'status', 'priority', 'plan', 'goal']},
    'note': {'sort': {'col': 'updated_at', 'dir': -1}, 'relation': ['initiative', 'story', 'support', 'hotfix', 'prd', 'task'], 'scopes': None,
             'columns': ['id', 'subject', 'labels', 'project', 'initiative', 'related:Related to', 'created', 'updated'], 'group_by': ['initiative', 'project']},
    'meeting': {'sort': {'col': 'date', 'dir': -1}, 'relation': ['initiative', 'story', 'support', 'hotfix', 'prd', 'task'], 'scopes': 'date',
                'columns': ['id', 'subject', 'labels', 'date', 'time', 'duration', 'attendees', 'project', 'initiative', 'related:Related to', 'updated'], 'group_by': ['initiative', 'project']},
    'activity': {'sort': {'col': 'created_at', 'dir': -1}, 'relation': ['initiative', 'story', 'support', 'hotfix', 'prd', 'task', 'note', 'meeting'],
                 'scopes': 'resolution', 'columns': ['id', 'subject', 'source', 'from', 'priority', 'labels', 'date', 'time', 'related:About', 'project', 'initiative', 'resolved', 'updated', 'created'], 'group_by': ['initiative', 'project']},
    'agent': {'sort': {'col': 'status', 'dir': -1}, 'relation': ['initiative'], 'scopes': 'status',
              'columns': [*LIST_COLS, 'priority', 'prop:platform:Platform', 'prop:trigger:Trigger', 'labels', 'project', 'initiative', 'updated'],
              'group_by': ['initiative', 'project', 'status', 'priority']},
    'transcription': {'sort': {'col': 'updated_at', 'dir': -1}, 'relation': ['meeting'], 'scopes': None, 'relation_any': 'Any meeting',
                      'columns': ['id', 'subject', 'labels', 'meetingOf', 'project', 'created', 'updated'], 'group_by': ['initiative', 'project']},
    'goal': {'sort': {'col': 'priority', 'dir': 1}, 'relation': None, 'scopes': 'status',
             'columns': [*LIST_COLS, 'priority', 'plan', 'start', 'due', 'labels', 'progress', 'updated'],
             'group_by': ['status', 'priority', 'plan']},
    'prompt': {'sort': {'col': 'subject', 'dir': 1}, 'relation': None, 'scopes': 'archive',
               'columns': ['id', 'subjectPlain', 'state', 'labels', 'created', 'updated']},
}
# [label, plural, icon, route, nav, counted, go key, quick-add tokens], in the order the create form offers them. The type
# lists carry no count in the sidebar; only the capture links (Inbox, Activity) do.
# The sidebar: the work (projects, initiatives, tasks) | notes (and Docs), each `section` split from the next by a line, then
# NAV_SECTIONS. A type in one of those has no link of its own: it is a tab of its section's page. Agents and prompts sit
# with the tools (the work log, labels, contacts) under More. Prompts have no "g then" key: Ticketing's types and the app's
# views take every letter theirs has.
SHOWN = {
    'support': ['Support', 'Support', 'lifebuoy', 'support', {'group': 'types', 'order': 5, 'section': 2}, '', 'u', ['/sup', '/support']],
    'initiative': ['Initiative', 'Initiatives', 'target', 'initiatives', {'group': 'types', 'order': 2, 'section': 1}, '', 'n', ['/ini', '/initiative']],
    'story': ['Story', 'Stories', 'flag', 'stories', {'group': 'types', 'order': 3, 'section': 1}, '', 'p', ['/sty', '/story']],
    'task': ['Task', 'Tasks', 'task', 'tasks', {'group': 'types', 'order': 4, 'section': 1}, '', 'k', ['/task']],
    'spec': ['Spec', 'Specs', 'checklist', 'specs', {'group': 'types', 'order': 7, 'section': 3}, '', '', ['/spec']],
    'hotfix': ['Hotfix', 'Hotfixes', 'flame', 'hotfixes', {'group': 'types', 'order': 6, 'section': 2}, '', 'f', ['/hfx', '/hotfix']],
    'prd': ['PRD', 'PRDs', 'book', 'prds', {'group': 'types', 'order': 8, 'section': 4}, '', 'v', ['/prd']],
    'plan': ['Plan', 'Plans', 'list', 'plans', {'group': 'types', 'order': 9, 'section': 4}, '', 'y', ['/plan']],
    'analysis': ['Analysis', 'Analyses', 'search', 'analyses', {'group': 'types', 'order': 10, 'section': 4}, '', 's', ['/analysis']],
    'error': ['Error', 'Errors', 'alert', 'errors', {'group': 'types', 'order': 14, 'section': 6}, '', 'x', ['/err', '/error']],
    'learning': ['Learning', 'Learnings', 'lightbulb', 'learnings', {'group': 'types', 'order': 15, 'section': 6}, '', 'z', ['/lrn', '/learning']],
    'meeting': ['Meeting', 'Meetings', 'users', 'meetings', {'group': 'types', 'order': 11, 'section': 5}, '', 'm', ['/meeting', '/mtg']],
    'transcription': ['Transcription', 'Transcriptions', 'mic', 'transcriptions', {'group': 'types', 'order': 12, 'section': 5}, '', '',
                      ['/transcription', '/trn']],
    'note': ['Note', 'Notes', 'note', 'notes', {'group': 'types', 'order': 13, 'section': 2}, '', 'o', ['/note']],
    'agent': [agents.LABEL, agents.PLURAL, agents.ICON, agents.ROUTE, {'group': 'tools', 'order': 0}, '', '', list(agents.TOKENS)],
    'activity': ['Activity', 'Activity', 'mail', 'activity', {'group': 'capture', 'order': 2, 'always': True}, 'open', 'c', ['/activity', '/act']],
    'inbox': ['Inbox', 'Inbox', 'inbox', 'inbox', {'group': 'capture', 'order': 1, 'always': True}, 'all', 'i', ['/inbox']],
    'prompt': ['Prompt', 'Prompts', 'sparkles', 'prompts', {'group': 'tools', 'order': 1}, 'all', '', []],
    'project': ['Project', 'Projects', 'folder', 'projects', {'group': 'types', 'order': 1, 'section': 1}, '', 'j', []],
    # Goals sit with the views, right under Planning (index.html's "views" box): prioritising, beside planning.
    'goal': ['Goal', 'Goals', 'goal', 'goals', {'group': 'views', 'order': 1}, '', 'r', ['/goal']],
}
# The sidebar's sections: one link each, after the types, that opens a page with a tab per type, in this order (static/js/
# sections.js); each tab is the type's list, at its own address (#/prds). Only the types the vault has are tabs.
NAV_SECTIONS = (
    {'key': 'meetings', 'label': 'Meetings', 'icon': 'users', 'types': ['meeting', 'transcription']},
    {'key': 'brief', 'label': 'Brief', 'icon': 'book', 'types': ['analysis', 'spec', 'prd', 'plan']},
    {'key': 'issues', 'label': 'Issues', 'icon': 'flag', 'types': ['story', 'support', 'hotfix']},
    {'key': 'records', 'label': 'Records', 'icon': 'lightbulb', 'types': ['learning', 'error']},
)
# The types whose detail has a Canvas tab (panel.js canvasTab): whiteboards of their own, kept by their ref.
CANVAS_TYPES = ('project', 'initiative', 'story', 'task', 'meeting')
PLANNABLE = {name for name in SPEC if plannable(name)}  # initiative, story, support, hotfix, prd, task: `work`
# The types with statuses of their own, not the tickets' "1. Backlog" … "7. Discarded": written to disk as they are.
OWN_STATUSES = {'error': ERROR_STATUSES, 'agent': agents.STATUSES, 'spec': SPEC_STATUSES, 'project': PROJECT_STATUSES, 'goal': GOAL_STATUSES}
OWN_CLOSED = {'error': frozenset({'resolved'}), 'agent': agents.CLOSED, 'spec': frozenset({'retired'}), 'project': PROJECT_CLOSED,
              'goal': CLOSED}


LABELS = {name: shown[0] for name, shown in SHOWN.items()}


def _type(name):
    label, plural, icon, route, nav, counted, go_key, tokens = SHOWN[name]
    spec = SPEC[name]
    statuses = OWN_STATUSES[name] if name in OWN_STATUSES else STATUSES if spec['status_key'] else ()
    closed = OWN_CLOSED.get(name, CLOSED)
    props = PROPS.get(name, ())
    readonly = tuple(p['key'] for p in props if p['kind'] == 'readonly')  # read, never written by the app
    # A project has no id of its own but is known by its key (store._item): it relates to others like any ticket.
    fields = fields_for(name, [p['key'] for p in props], ext=EXTERNAL_REF, projects=True, has_id=bool(spec['code']) or name == 'project',
                        drop=(*readonly, *INSTEAD.get(name, ())))
    parents = PARENTS[name]
    lst = LISTS.get(name)
    if lst:
        lst = {**lst, 'columns': with_parent_heading(lst['columns'], parent_label(parents, LABELS))}
    return TypeDef(
        name=name, prefix=spec['code'], folder=spec['folder'] or ROOT_FOLDERS.get(name, ''), label=label, plural=plural, icon=icon,
        route=route, fields=fields, parents=parents, statuses=statuses, closed=closed,
        closed_when='resolved_at' if name == 'activity' else '', nav=nav, list=lst,
        has_id=bool(spec['code']), creatable=name != 'inbox', convertible=name not in ('inbox', 'project', 'prompt'),
        plannable=name in PLANNABLE, counted=counted, go_key=go_key, tokens=tuple(tokens), props=props,
        extra_fields=tuple(p['key'] for p in props if p['kind'] == 'readonly'),
        page=name in PAGES, children=PAGES.get(name, ()), parent_label=parent_label(parents, LABELS),
        folder_optional=name in OPTIONAL_ROOT_FOLDERS, canvas=name in CANVAS_TYPES,
    )


def build(codec, checker):
    types = {name: _type(name) for name in SHOWN}
    return Structure(
        id='ticketing', label='Projects',  # the id config.json names it by; the label, what Settings → Vaults shows
        types=types,
        priorities=PRIORITIES, id_re=ID_RE, id_pad=3, numbered=True,
        external_ref=dict(EXTERNAL_REF),
        statuses=STATUSES, closed=CLOSED, worklog_folder=WORKLOG_FOLDER,
        defaults={'status': 'Backlog', 'priority': 'P2'},
        codec=codec, checker=checker, required=('project',), statuses_locked=True,
        kinds=dict(KINDS), kind_key='project_kind',
        docs_folder=DOCS_FOLDER, docs_in_projects=True,
        docs_not_projects=frozenset({*ROOT_FOLDERS.values(), *OPTIONAL_ROOT_FOLDERS.values(), *PROJECT_ROOT_TOPS, WORKLOG_FOLDER,
                                     ATTACHMENTS_DIR}),
        extras={'levels': list(LEVELS), 'project_scoped': [t for t, s in SPEC.items() if s['scope'] == 'project'],
                'needs_parent': list(NEEDS_PARENT),
                # The tickets that may be in no project and change or drop theirs (with short ids); the other types of a
                # project's folders (the sub-documents) follow their item's.
                'leaves_project': list(LEAVES_PROJECT),
                'sections': [dict(sec, types=list(sec['types'])) for sec in NAV_SECTIONS],
                # The types a project may leave out (its note's enabled_types): a system project has no hotfixes nor PRDs.
                'optional_types': [t for t, s in SPEC.items() if s['optional']],
                # The project's field that turns its kind's optional types on and off (the page narrows it by kind).
                'types_key': 'enabled_types',
                # How a project's and an initiative's page sorts what hangs from it, beside its work (tasks, notes,
                # meetings): a tab per group, of its types' tables (one table: no bar of its own).
                'child_groups': [['initiatives', 'Initiatives', ['initiative']],
                                 ['issues', 'Issues', ['story', 'support', 'hotfix']],
                                 ['briefs', 'Briefs', ['prd', 'spec', 'plan', 'analysis']],
                                 ['records', 'Records', ['error', 'learning']]],
                # The same relation kinds as every structure; "Blocked by" is kept in `depends_on` where a type has it
                # (an initiative, a story: its templates and devflow read it), in `relation_kinds` elsewhere.
                'relation_kinds': relation_kinds(types, {'blocked': 'depends_on'})},
    )
