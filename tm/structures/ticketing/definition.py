"""The Ticketing structure: the native format of ~/github/docs/ticketing-second-brain.

    Tickets/
    ├── 00 Index Tickets.md            (optional)
    ├── Tasks/ Notes/ Meetings/ Inbox/ Activities/ Work log/      ← the app's own types, outside projects
    ├── Docs/                          ← documents with no project, never items (optional, TSK-039)
    └── <Project>/
        ├── 00 <Project>.md            ← fileClass: Ticket Project (project_key, enabled_types, support_due_days…)
        ├── Initiatives/ Support/ Plans/ Analyses/ Records/Errors/ Records/Learnings/
        ├── Stories/                   ← an initiative's deliveries (made with the first story)
        ├── Specs/                     ← what the project's system does today (made with the first spec)
        ├── Hotfixes/ PRDs/            ← when the project enables them (product projects)
        └── Docs/                      ← the project's documents (optional)

A ticket is `<ID> <Title>.md`, its type is its `fileClass`, its id `KEY-TYPE-NNN` (a root type: `TSK-NNN`), its
status `status_ticket: "4. InProgress"` (an error: `status_error`), its dates `creation_date`/`updated_date`, its
links wikilinks. `SPEC` says, per type, how its file maps to the app's item (codec.py); `TYPES` is what the app
shows of it (tm/structures TypeDef).
"""

import re

from ...attachments import DIR as ATTACHMENTS_DIR
from .. import Structure, TypeDef, agents

STATUSES = ('Backlog', 'ToDo', 'OnHold', 'InProgress', 'Review', 'Done', 'Discarded')
CLOSED = frozenset({'Done', 'Discarded'})
ERROR_STATUSES = ('open', 'mitigated', 'resolved')
SPEC_STATUSES = ('draft', 'active', 'retired')  # a spec is active once its text is valid (specs.py)
PRIORITIES = ('P0', 'P1', 'P2', 'P3')
LEVELS = ('C1', 'C2', 'C3')
EXECUTION_MODES = ('parallel', 'serial')  # serial: one InProgress at a time in the project, all types
# The types a project's enabled_types names: the core ones every project has, then those it may leave out.
CORE_PROJECT_TYPES = ('initiative', 'story', 'support', 'spec')
PROJECT_TYPES = (*CORE_PROJECT_TYPES, 'hotfix', 'prd')
# KEY-TYPE-NNN (a project's ticket) or TYPE-NNN (a root type): group 1 is the prefix, group 2 the number.
ID_RE = re.compile(r'^((?:[A-Z]{2,4}-)?[A-Z]{3,4})-(\d{3,})$')
PROJECT_KEY_RE = re.compile(r'^[A-Z]{2,4}$')
ROOT_FOLDERS = {'task': 'Tasks', 'note': 'Notes', 'meeting': 'Meetings', 'inbox': 'Inbox', 'activity': 'Activities'}
# Root types whose folder may be missing (the vault still matches; it is made with the first item): the agents.
OPTIONAL_ROOT_FOLDERS = {'agent': 'Agents'}
WORKLOG_FOLDER = 'Work log'
# Docs (TSK-039): documents, never items — at the top of the vault and inside each project's folder.
DOCS_FOLDER = 'Docs'
INDEX_NOTE = '00 Index Tickets.md'

# How each type's file maps to an item. scope: 'project' (in a project's folder), 'root' (outside projects) or
# 'note' (the project note itself). title: how the file is named ('id': "<ID> <Title>", 'plan': "<ID of its
# item> Plan", 'date': "<date> <Title>", 'note': "00 <Project>"). parent: the field that is its `related_to`.
# links / multi_links: fields that hold one wikilink / a list of them (shown to the app as item keys).
# optional: a type the project may leave out (enabled_types).
SPEC = {
    'project': dict(file_class='Ticket Project', scope='note', folder='', code='', title='note'),
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
    'plan': dict(file_class='Ticket Plan', scope='project', folder='Plans', code='', title='plan', parent='item'),
    'analysis': dict(file_class='Ticket Analysis', scope='project', folder='Analyses', code='', title='date', parent='item',
                     links=('supersedes',)),
    'error': dict(file_class='Ticket Error', scope='project', folder='Records/Errors', code='ERR', title='id', status_key='status_error',
                  parent='item', links=('fixed_by',)),
    'learning': dict(file_class='Ticket Learning', scope='project', folder='Records/Learnings', code='LRN', title='id', parent='item'),
    **{t: dict(file_class=f'Ticket {t.capitalize()}', scope='root', folder=folder,
               code={'task': 'TSK', 'note': 'NOTE', 'meeting': 'MTG', 'inbox': 'INB', 'activity': 'ACT'}[t], title='id',
               status_key='status_ticket' if t == 'task' else None, parent=None if t == 'inbox' else 'related_to')
       for t, folder in ROOT_FOLDERS.items()},
    'agent': dict(file_class='Ticket Agent', scope='root', folder=OPTIONAL_ROOT_FOLDERS['agent'], code='AGT', title='id',
                  status_key='status_agent', parent='related_to'),
}
for _spec in SPEC.values():
    _spec.setdefault('status_key', None)
    _spec.setdefault('parent', None)
    _spec.setdefault('links', ())
    _spec.setdefault('multi_links', ())
    _spec.setdefault('optional', False)
BY_FILE_CLASS = {s['file_class']: t for t, s in SPEC.items()}
# A parent written under its old name, still read (never written): a PRD's `umbrella:`, from before stories.
LEGACY_PARENT = {'prd': 'umbrella'}


def _opts(*values):
    return [[v, v] for v in values]


# The fields shown on an item's card beyond the app's own (status, priority, plan, due, labels…), in order.
# kind: text · textarea · select · checks (several of `options`; `fixed` always on) · number · date · link (one item, of
# `types`) · links (several) · readonly · map (`keys`, as numbers with `number`).
P = dict
PROPS = {
    'project': (P(key='project_key', label='Key', kind='readonly'), P(key='project_kind', label='Kind', kind='readonly'),
                P(key='execution_mode', label='Execution', kind='select', options=_opts(*EXECUTION_MODES)),
                P(key='enabled_types', label='Types', kind='checks', options=_opts(*PROJECT_TYPES), fixed=list(CORE_PROJECT_TYPES)),
                P(key='support_due_days', label='Support due days', kind='map', keys=list(LEVELS), number=True),
                P(key='repo', label='Repo', kind='text', placeholder='~/github/…'),
                P(key='managed_by', label='Managed by', kind='text', placeholder='~/github/…/.claude')),
    'initiative': (P(key='size', label='Size', kind='select', options=_opts('S', 'M', 'L')),
                   P(key='regime', label='Regime', kind='select', options=_opts('standard', 'critical')),
                   P(key='area', label='Area', kind='text'),
                   P(key='objective', label='Objective', kind='textarea'),
                   P(key='premise', label='Premise', kind='select', options=_opts('unverified', 'verified', 'reframed', 'refuted')),
                   P(key='premise_verified', label='Premise verified', kind='text', placeholder='<date> @ <sha>; …'),
                   P(key='origin', label='Origin', kind='link', types=['support']),
                   P(key='prd', label='PRD', kind='link', types=['prd']),
                   P(key='plan', label='Plan', kind='link', types=['plan']),
                   P(key='depends_on', label='Depends on', kind='links', types=['initiative', 'support', 'hotfix']),
                   P(key='on_hold', label='On hold', kind='map', keys=['by', 'why', 'resume_when']),
                   P(key='discard_reason', label='Discard reason', kind='text')),
    'story': (P(key='size', label='Size', kind='select', options=_opts('S', 'M', 'L')),
              P(key='spec_impact', label='Spec impact', kind='text', placeholder='the specs it changes, or "none: <why>"'),
              P(key='origin', label='Origin', kind='link', types=['support', 'task']),
              P(key='plan', label='Plan', kind='link', types=['plan']),
              P(key='depends_on', label='Depends on', kind='links', types=['story', 'support', 'hotfix']),
              P(key='on_hold', label='On hold', kind='map', keys=['by', 'why', 'resume_when']),
              P(key='discard_reason', label='Discard reason', kind='text'),
              P(key='executor', label='Executor', kind='select', options=_opts('', 'claude', 'codex', 'owner')),
              P(key='branch', label='Branch', kind='text'), P(key='baseline', label='Baseline', kind='text', placeholder='<sha> it started from'),
              P(key='changelog_ref', label='Changelog', kind='text')),
    'spec': (P(key='capability', label='Capability', kind='text', placeholder='checkout · weekly report · …'),
             P(key='stories', label='Stories', kind='links', types=['story']),
             P(key='synced_sha', label='Synced at sha', kind='text', placeholder='the commit in production it describes'),
             P(key='synced_date', label='Synced on', kind='date')),
    'support': (P(key='level', label='Level', kind='select', options=_opts(*LEVELS), default='C2'),
                P(key='level_base', label='Level at birth', kind='readonly'),
                P(key='level_reason', label='Level reason', kind='text'),
                P(key='due_from', label='Due from', kind='readonly'),
                P(key='origin', label='Origin', kind='select', options=_opts('manual', 'user', 'judge', 'auditor', 'gate', 'ci', 'monitor', 'curation')),
                P(key='signature', label='Signature', kind='text', placeholder='<origin>|…'),
                P(key='occurrences', label='Occurrences', kind='readonly'),
                P(key='disposition', label='Disposition', kind='select', options=_opts('pending', 'fix', 'discard', 'owner')),
                P(key='resolution', label='Resolution', kind='select', options=_opts('', 'fixed_in_place', 'promoted', 'escalated', 'discarded')),
                P(key='promoted_to', label='Promoted to', kind='link', types=['initiative'], readonly=True),
                P(key='escalated_to', label='Escalated to', kind='link', types=['hotfix'], readonly=True),
                P(key='area', label='Area', kind='text'),
                P(key='should_have_caught', label='Should have caught', kind='text'),
                P(key='on_hold', label='On hold', kind='map', keys=['by', 'why', 'resume_when']),
                P(key='discard_reason', label='Discard reason', kind='text'),
                P(key='executor', label='Executor', kind='select', options=_opts('', 'claude', 'codex', 'owner')),
                P(key='branch', label='Branch', kind='text'), P(key='subject_sha', label='Observed at sha', kind='text')),
    'hotfix': (P(key='severity', label='Severity', kind='select', options=_opts('critical', 'high', 'medium')),
               P(key='affected', label='Affected', kind='text'),
               P(key='rollback_plan', label='Rollback plan', kind='textarea'),
               P(key='base_branch', label='Base branch', kind='text'), P(key='branch', label='Branch', kind='text'),
               P(key='observation_window', label='Observation window', kind='text'),
               P(key='postmortem', label='Post-mortem', kind='link', types=['error']),
               P(key='owner_review', label='Owner review', kind='text'), P(key='changelog_ref', label='Changelog', kind='text')),
    'prd': (P(key='supersedes', label='Supersedes', kind='link', types=['prd']),
            P(key='superseded_by', label='Superseded by', kind='link', types=['prd'])),
    'plan': (P(key='written', label='Written', kind='date'), P(key='base', label='Base', kind='text'),
             P(key='branch', label='Branch', kind='text'), P(key='worktree', label='Worktree', kind='text'),
             P(key='executor', label='Executor', kind='select', options=_opts('', 'claude', 'codex', 'owner')),
             P(key='verifier', label='Verifier', kind='text'),
             P(key='lane', label='Lane', kind='select', options=_opts('fast', 'normal', 'full'))),
    'analysis': (P(key='kind', label='Kind', kind='select', options=_opts('diagnosis', 'decision', 'review', 'research', 'retro', 'ux', 'brief', 'report')),
                 P(key='base', label='Base', kind='text'), P(key='author', label='Author', kind='text'),
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
# carried out (execution and git); 'details', a project's settings. Links go to Relations on their own.
TABS = {
    'project': {'details': ('execution_mode', 'enabled_types', 'support_due_days', 'repo', 'managed_by'),
                'hidden': ('project_key', 'project_kind')},  # its key and kind head its page
    'initiative': {'delivery': ('regime', 'premise', 'premise_verified', 'on_hold', 'discard_reason')},
    'spec': {'delivery': ('synced_sha', 'synced_date')},
    'story': {'delivery': ('spec_impact', 'executor', 'branch', 'baseline', 'changelog_ref', 'on_hold', 'discard_reason')},
    'support': {'delivery': ('executor', 'branch', 'subject_sha', 'signature', 'should_have_caught', 'on_hold', 'discard_reason')},
    'hotfix': {'delivery': ('base_branch', 'branch', 'observation_window', 'owner_review', 'changelog_ref')},
    'plan': {'delivery': ('base', 'branch', 'worktree', 'executor', 'verifier')},
    'analysis': {'delivery': ('base',)},
}
# The Delivery tab in groups, each under its title and in this order, one field per row (a key is in one group
# whatever its type).
DELIVERY_GROUPS = (
    ('Readiness', 'check', ('regime', 'premise', 'premise_verified')),
    ('Execution', 'terminal', ('executor', 'base', 'base_branch', 'branch', 'baseline', 'worktree', 'verifier', 'subject_sha')),
    ('Spec and release', 'tag', ('spec_impact', 'synced_sha', 'synced_date', 'observation_window', 'owner_review', 'changelog_ref')),
    ('Triage', 'search', ('signature', 'should_have_caught')),
    ('Paused or discarded', 'ban', ('on_hold', 'discard_reason')),
)
_GROUP = {key: (n, title, ico, keys.index(key)) for n, (title, ico, keys) in enumerate(DELIVERY_GROUPS) for key in keys}
for _name, _tabs in TABS.items():
    _where = {key: tab for tab, keys in _tabs.items() for key in keys}
    _props = [{**p, 'tab': _where[p['key']]} if p['key'] in _where else p for p in PROPS[_name]]
    _props = [{**p, 'group': _GROUP[p['key']][1], 'group_icon': _GROUP[p['key']][2]} if p.get('tab') == 'delivery' else p
              for p in _props]
    # Delivery's fields in their groups' order; every other tab keeps the order they are declared in.
    _rank = {id(p): (_GROUP[p['key']][0], _GROUP[p['key']][3]) for p in _props if p.get('tab') == 'delivery'}
    _slots = [i for i, p in enumerate(_props) if p.get('tab') == 'delivery']
    for _i, _p in zip(_slots, sorted((_props[i] for i in _slots), key=lambda p: _rank[id(p)])):
        _props[_i] = _p
    PROPS[_name] = tuple(_props)

# The types that open as a page of their own, and the tables of what hangs from each there, in order.
PAGES = {
    'project': ('initiative', 'story', 'spec', 'support', 'hotfix', 'prd', 'plan', 'analysis', 'error', 'learning'),
    'initiative': ('story', 'prd', 'plan', 'task', 'analysis', 'error', 'learning', 'note', 'meeting'),
    'prd': ('task', 'analysis', 'note', 'meeting'),
}
# What an item's parent is to it, as its Relations tab titles it (the parent field's name in the file).
PARENT_LABEL = {'story': 'Initiative', 'prd': 'Initiative', 'hotfix': 'Origin', 'plan': 'Item', 'analysis': 'Item',
                'error': 'Found in', 'learning': 'From', 'activity': 'About', 'agent': 'Agent of'}

# The app's own fields every ticket may carry (planning, comments, Claude sessions…), besides its own.
APP_FIELDS = ('related_to', 'relations', 'project', 'url', 'url_label', 'links', 'archived', 'session_name', 'local_path',
              'ticket_id', 'ticket_url', 'plan_week', 'plan_day', 'plan_month', 'today_list', 'plan_order', 'week_list', 'week_order',
              'completed_at', 'labels', 'comments', 'claude_sessions')
OWN_FIELDS = {
    'project': (),
    # docs: TSK-039 (store.clean_docs); watchers: the people and groups of Contacts to tell when it changes status (TSK-051)
    'initiative': ('status', 'priority', 'priority_reason', 'due', 'sidebar', 'docs', 'watchers'),
    'story': ('status', 'priority', 'priority_reason', 'due', 'docs', 'watchers'),
    'spec': ('status',),
    'support': ('status', 'due'),
    'hotfix': ('status', 'due'),
    'prd': ('status', 'due'),
    'plan': (),
    'analysis': (),
    'error': ('status',),
    'learning': (),
    'task': ('status', 'priority', 'priority_reason', 'due', 'list', 'order', 'docs', 'watchers'),
    'note': (),
    'meeting': ('date', 'time', 'duration', 'attendees', 'event_id'),
    'inbox': (),
    'activity': ('source', 'from', 'date', 'time', 'priority', 'priority_reason', 'resolution', 'resolved_at'),
    'agent': ('status', 'priority', 'priority_reason'),
}
PARENTS = {
    'project': (), 'support': (), 'inbox': (),
    'initiative': (), 'story': ('initiative',), 'spec': (), 'hotfix': ('support',), 'prd': ('initiative',),
    'plan': ('initiative', 'story', 'support'), 'analysis': ('initiative', 'story', 'support', 'hotfix', 'prd'),
    'error': ('initiative', 'story', 'support', 'hotfix'), 'learning': ('initiative', 'story', 'support', 'hotfix'),
    'task': ('initiative', 'story', 'support', 'hotfix', 'prd'),
    'note': ('initiative', 'story', 'support', 'hotfix', 'prd', 'task'),
    'meeting': ('initiative', 'story', 'support', 'hotfix', 'prd', 'task'),
    'activity': ('initiative', 'story', 'support', 'hotfix', 'prd', 'task', 'note', 'meeting'),
    'agent': ('initiative',),
}

# The columns follow the folder-per-type structure's order (id · subject · status · priority · planned · due · … · labels · parent), with
# the project right before the parent column: which project, then which ticket in it. Where a type may hang from an
# initiative or from something else, the parent is two columns, as its forms have it: Initiative, then the rest.
# Every list groups by project, and by initiative where its items can reach one (directly, or through what they hang
# from: a note → its task → that task's initiative); a support ticket and a hotfix never do.
LIST_COLS = ['id', 'subject', 'status']
LISTS = {
    'project': {'sort': {'col': 'subject', 'dir': 1}, 'relation': None, 'scopes': None,
                'columns': ['subjectPlain', 'prop:project_key:Key', 'prop:project_kind:Kind', 'prop:execution_mode:Execution', 'updated']},
    'initiative': {'sort': {'col': 'priority', 'dir': 1}, 'relation': None, 'scopes': 'status',
                   'columns': [*LIST_COLS, 'priority', 'plan', 'due', 'prop:size:Size', 'extref', 'labels', 'progress', 'project', 'updated'],
                   'group_by': ['project', 'status', 'priority', 'plan']},
    'story': {'sort': {'col': 'status', 'dir': -1}, 'relation': ['initiative'], 'scopes': 'status',
              'columns': [*LIST_COLS, 'priority', 'plan', 'due', 'prop:size:Size', 'labels', 'progress', 'project', 'parent:Initiative', 'updated'],
              'group_by': ['initiative', 'project', 'status', 'priority', 'plan']},
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
             'columns': ['subjectPlain', 'prop:lane:Lane', 'prop:executor:Executor', 'project', 'initiative', 'related:Item', 'updated'], 'group_by': ['initiative', 'project']},
    'analysis': {'sort': {'col': 'created_at', 'dir': -1}, 'relation': ['initiative', 'story', 'support', 'hotfix', 'prd'], 'scopes': None,
                 'columns': ['subjectPlain', 'prop:kind:Kind', 'project', 'initiative', 'related:Item', 'created', 'updated'], 'group_by': ['initiative', 'project']},
    'error': {'sort': {'col': 'status', 'dir': 1}, 'relation': ['initiative', 'story', 'support', 'hotfix'], 'scopes': 'status',
              'columns': [*LIST_COLS, 'prop:severity:Severity', 'prop:impact:Impact', 'project', 'initiative', 'related:Found in', 'updated'], 'group_by': ['initiative', 'project']},
    'learning': {'sort': {'col': 'created_at', 'dir': -1}, 'relation': ['initiative', 'story', 'support', 'hotfix'], 'scopes': None,
                 'columns': ['id', 'subject', 'prop:impact:Impact', 'prop:applies_to:Applies to', 'project', 'initiative', 'related:From', 'created'], 'group_by': ['initiative', 'project']},
    'task': {'sort': {'col': 'status', 'dir': -1}, 'relation': ['initiative', 'story', 'support', 'hotfix', 'prd'], 'scopes': 'status',
             'relation_label': 'Ticket', 'relation_any': 'Any ticket',
             'columns': [*LIST_COLS, 'priority', 'plan', 'due', 'labels', 'project', 'initiative', 'related:Related to', 'updated'],
             'group_by': ['initiative', 'project', 'status', 'priority', 'plan']},
    'note': {'sort': {'col': 'updated_at', 'dir': -1}, 'relation': ['initiative', 'story', 'support', 'hotfix', 'prd', 'task'], 'scopes': None,
             'columns': ['id', 'subject', 'labels', 'project', 'initiative', 'related:Related to', 'created', 'updated'], 'group_by': ['initiative', 'project']},
    'meeting': {'sort': {'col': 'date', 'dir': -1}, 'relation': ['initiative', 'story', 'support', 'hotfix', 'prd', 'task'], 'scopes': 'date',
                'columns': ['id', 'subject', 'labels', 'date', 'time', 'duration', 'attendees', 'project', 'initiative', 'related:Related to', 'updated'], 'group_by': ['initiative', 'project']},
    'activity': {'sort': {'col': 'created_at', 'dir': -1}, 'relation': ['initiative', 'story', 'support', 'hotfix', 'prd', 'task', 'note', 'meeting'],
                 'scopes': 'resolution', 'columns': ['id', 'subject', 'source', 'from', 'priority', 'labels', 'date', 'time', 'related:About', 'project', 'initiative', 'resolved', 'updated', 'created'], 'group_by': ['initiative', 'project']},
    'agent': {'sort': {'col': 'status', 'dir': -1}, 'relation': ['initiative'], 'scopes': 'status',
              'columns': [*LIST_COLS, 'priority', 'prop:platform:Platform', 'prop:trigger:Trigger', 'labels', 'project', 'initiative', 'updated'],
              'group_by': ['initiative', 'project', 'status', 'priority']},
}
# [label, plural, icon, route, nav, counted, go key, quick-add tokens], in the order the create form offers them. The type
# lists carry no count in the sidebar; only the capture links (Inbox, Activity) do.
# The sidebar: the work (projects, initiatives, stories, tasks) | support and hotfixes | specs | PRDs, plans, analyses |
# meetings and notes | errors and learnings | agents, each `section` split from the next by a line.
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
    'error': ['Error', 'Errors', 'alert', 'errors', {'group': 'types', 'order': 13, 'section': 6}, '', 'x', ['/err', '/error']],
    'learning': ['Learning', 'Learnings', 'lightbulb', 'learnings', {'group': 'types', 'order': 14, 'section': 6}, '', 'z', ['/lrn', '/learning']],
    'meeting': ['Meeting', 'Meetings', 'users', 'meetings', {'group': 'types', 'order': 11, 'section': 5}, '', 'm', ['/meeting', '/mtg']],
    'note': ['Note', 'Notes', 'note', 'notes', {'group': 'types', 'order': 12, 'section': 5}, '', 'o', ['/note']],
    'agent': [agents.LABEL, agents.PLURAL, agents.ICON, agents.ROUTE, {'group': 'types', 'order': 15, 'section': 7}, '', '', list(agents.TOKENS)],
    'activity': ['Activity', 'Activity', 'mail', 'activity', {'group': 'capture', 'order': 2, 'always': True}, 'open', 'c', ['/activity', '/act']],
    'inbox': ['Inbox', 'Inbox', 'inbox', 'inbox', {'group': 'capture', 'order': 1, 'always': True}, 'all', 'i', ['/inbox']],
    'project': ['Project', 'Projects', 'folder', 'projects', {'group': 'types', 'order': 1, 'section': 1}, '', 'j', []],
}
PLANNABLE = {'initiative', 'story', 'support', 'hotfix', 'prd', 'task'}
# The types with statuses of their own, not the tickets' "1. Backlog" … "7. Discarded": written to disk as they are.
OWN_STATUSES = {'error': ERROR_STATUSES, 'agent': agents.STATUSES, 'spec': SPEC_STATUSES}
OWN_CLOSED = {'error': frozenset({'resolved'}), 'agent': agents.CLOSED, 'spec': frozenset({'retired'})}


def _type(name):
    label, plural, icon, route, nav, counted, go_key, tokens = SHOWN[name]
    spec = SPEC[name]
    statuses = OWN_STATUSES[name] if name in OWN_STATUSES else STATUSES if spec['status_key'] else ()
    closed = OWN_CLOSED.get(name, CLOSED)
    props = PROPS.get(name, ())
    fields = (*OWN_FIELDS[name], *(p['key'] for p in props if p['kind'] != 'readonly'), *APP_FIELDS)
    if name == 'inbox':
        fields = tuple(f for f in fields if f not in ('related_to', 'relations'))
    return TypeDef(
        name=name, prefix=spec['code'], folder=spec['folder'] or ROOT_FOLDERS.get(name, ''), label=label, plural=plural, icon=icon,
        route=route, fields=tuple(dict.fromkeys(fields)), parents=PARENTS[name], statuses=statuses, closed=closed,
        closed_when='resolved_at' if name == 'activity' else '', nav=nav, list=LISTS.get(name),
        has_id=bool(spec['code']), creatable=name != 'inbox', convertible=name not in ('inbox', 'project'),
        plannable=name in PLANNABLE, counted=counted, go_key=go_key, tokens=tuple(tokens), props=props,
        extra_fields=tuple(p['key'] for p in props if p['kind'] == 'readonly'),
        page=name in PAGES, children=PAGES.get(name, ()), parent_label=PARENT_LABEL.get(name, 'Related to' if PARENTS[name] else ''),
        folder_optional=name in OPTIONAL_ROOT_FOLDERS,
    )


def build(codec, checker):
    return Structure(
        id='ticketing', label='Ticketing',
        types={name: _type(name) for name in SHOWN},
        priorities=PRIORITIES, id_re=ID_RE, id_pad=3,
        external_ref={'id_key': 'ticket_id', 'url_key': 'ticket_url', 'label': 'Ticket',
                      'id_placeholder': 'ACME-INI-094', 'url_placeholder': 'https://…'},
        statuses=STATUSES, closed=CLOSED, worklog_folder=WORKLOG_FOLDER,
        defaults={'status': 'Backlog', 'priority': 'P2'},
        codec=codec, checker=checker, required=('project',), statuses_locked=True,
        docs_folder=DOCS_FOLDER, docs_in_projects=True,
        docs_not_projects=frozenset({*ROOT_FOLDERS.values(), *OPTIONAL_ROOT_FOLDERS.values(), WORKLOG_FOLDER, ATTACHMENTS_DIR}),
        extras={'levels': list(LEVELS), 'project_scoped': [t for t, s in SPEC.items() if s['scope'] == 'project'],
                # The types a project may leave out (its note's enabled_types): a system project has no hotfixes nor PRDs.
                'optional_types': [t for t, s in SPEC.items() if s['optional']]},
    )
