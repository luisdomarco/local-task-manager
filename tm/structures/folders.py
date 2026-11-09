"""The folder-per-type structures: Initiatives (id `folders`), the one this app was built on, and Tasks, the same without
user stories. One folder per type, ids PREFIX-0001, Redmine as the outside tracker. These constants used to live in
tm/store.py, which still exports them under the same names."""

import re

from . import Structure, TypeDef, agents
from .relations import relation_kinds
from .traits import PROJECT_CLOSED, PROJECT_STATUSES, fields_for, parent_label, plannable, with_parent_heading

ITEM_TYPES = {'initiative': 'INI', 'story': 'US', 'task': 'TSK', 'note': 'NOTE', 'meeting': 'MTG', 'inbox': 'INB',
              'activity': 'ACT', 'prompt': 'PRM', 'transcription': 'TRN', 'agent': 'AGT'}
DEFAULT_FOLDERS = {
    'initiative': 'initiatives', 'story': 'stories', 'task': 'tasks', 'note': 'notes',
    'meeting': 'meetings', 'inbox': 'inbox', 'activity': 'activities', 'prompt': 'prompts', 'transcription': 'transcriptions', 'worklog': 'worklog',
    'agent': 'agents',
}
STATUSES = ['Backlog', 'ToDo', 'OnHold', 'Blocked', 'InProgress', 'Review', 'Done', 'Discarded']
CLOSED = {'Done', 'Discarded'}
PRIORITIES = ['Urgent', 'High', 'Normal', 'Low']
ID_RE = re.compile(r'^([A-Z]+)-(\d+)$')
ID_PAD = 4
# Fields written on creation, in this order, after id/type/subject: a type's traits (tm/structures/traits.py, the
# same in every structure) plus its own props (an agent's platform, model…). Status and priority only on the types
# that are worked (`work`) or have a status of their own (an agent). Some of what they mean, kept with the keys:
# `session_name` names the Claude session (or any working session) the item is being handled in.
# `related_to` is the item's parent (one; children point up to it). `relations` are links between equals,
# without hierarchy: ids of other items, kept on whichever of the two made the link and shown on both, with what each
# is in `relation_kinds` ({id: kind}, an id it does not name being `relates`: tm/structures/relations.py).
# `plan_order`: its place among the cards of its day, or of its week when no day, on Today and Week, where you order
# them by hand (TSK-053); the Board has its own, `order`, within its list. `plan_month`: the month ('YYYY-MM') it is
# planned for when it has no week nor day yet; a day or a week, when set, says more and wins (Month view, rules.js
# planHorizon). `week_list` / `week_order`: its column on the Free board of Week and Next week (one set of columns for
# both, so a card keeps it when it moves to another week) and its place in it; none, or one since deleted, is
# Uncategorized. `docs`: what it links in the vault's Docs (TSK-039), [[a doc]] or a folder/ (store.clean_docs).
# `watchers`: the people and groups of Contacts to tell when it changes status (TSK-051). `ticket_id` / `ticket_url` /
# `tracker`: the outside ticket (Redmine's here: its tracker is Story, Epic…), once `redmine_id` / `redmine_url`.
# A meeting's `time` is when it starts (HH:MM, 24 h; blank for an all-day event or when not known), `duration` how
# long it lasts (HH:MM, like a work-log entry's time), `event_id` the Google Calendar event it was synced from.
# An activity (an incoming message pasted as-is) has `resolution`, what was done about it; resolved ⇔ resolved_at set.
EXTERNAL_REF = {'id_key': 'ticket_id', 'url_key': 'ticket_url', 'tracker_key': 'tracker', 'label': 'Ticket',
                'id_placeholder': '4521', 'url_placeholder': 'https://redmine…/issues/4521', 'tracker_placeholder': 'Story, Epic…'}
OWN_PROPS = {'agent': agents.PROP_KEYS}
TYPE_FIELDS = {name: list(fields_for(name, OWN_PROPS.get(name, ()), ext=EXTERNAL_REF)) for name in ITEM_TYPES}
PARENT_TYPES = {
    'initiative': ['initiative'],
    'story': ['initiative'],
    'task': ['initiative', 'story'],
    'note': ['initiative', 'story', 'task'],
    'meeting': ['initiative', 'story', 'task'],
    'inbox': [],
    'activity': ['initiative', 'story', 'task', 'note', 'meeting'],
    'prompt': [],
    'transcription': ['meeting'],
    'agent': ['initiative'],
}
# Beyond each type's own fields, two legacy ones: an initiative's embedded `user_stories` (read by
# migrate_user_stories, never created any more) and a story's `legacy_id` (written by that migration).
EXTRA_FIELDS = {'initiative': ('user_stories',), 'story': ('legacy_id',)}

# How each list view shows its type (static/js/views/list.js). Columns are named (datatable.js COL);
# `parent:<label>` is the parent column under that heading. `scopes` names the Open / Closed / All row:
# 'status' (Open / Closed), 'resolution' (Unresolved / Resolved), 'archive' (Active / Archived: archived ones
# are listed too), 'date' (Today / This week / Next week / This month, for a dated type) or None (no such row). `relation`: the
# parent types its "Related to" filter offers, under `relation_label` with `relation_any` for no filter.
# `group_by`: what it can be grouped by (static/js/grouping.js); `noun`: one of them, where it is not its label.
PLANNED = ['id', 'subject', 'status', 'priority', 'plan', 'due']
LISTS = {
    'initiative': {'sort': {'col': 'priority', 'dir': 1}, 'relation': None, 'scopes': 'status',
                   'columns': [*PLANNED, 'extref', 'tracker', 'labels', 'progress', 'parent:Parent', 'updated'],
                   # By initiative: each one heads a group with the sub-initiatives (its epics) under it (grouping.js).
                   'group_by': ['initiative', 'status', 'priority', 'plan']},
    'story': {'sort': {'col': 'status', 'dir': -1}, 'relation': ['initiative'], 'scopes': 'status', 'group_key': 'tm.groupStories',
              'noun': 'User story', 'relation_label': 'Initiative or story', 'relation_any': 'Any initiative or story',
              'columns': [*PLANNED, 'extref', 'labels', 'parent:Initiative', 'progress', 'updated'],
              'group_by': ['initiative', 'status', 'priority', 'plan']},
    'task': {'sort': {'col': 'status', 'dir': -1}, 'relation': ['initiative', 'story'], 'scopes': 'status',
             'relation_label': 'Initiative or story', 'relation_any': 'Any initiative or story',
             'columns': [*PLANNED, 'labels', 'parent:Related to', 'updated'],
             'group_by': ['initiative', 'status', 'priority', 'plan']},
    'note': {'sort': {'col': 'updated_at', 'dir': -1}, 'relation': ['initiative', 'story', 'task'], 'scopes': None,
             'columns': ['id', 'subject', 'labels', 'parent:Related to', 'created', 'updated'], 'group_by': ['initiative']},
    'transcription': {'sort': {'col': 'updated_at', 'dir': -1}, 'relation': ['meeting'], 'scopes': None, 'relation_any': 'Any meeting',
                      'columns': ['id', 'subject', 'labels', 'meetingOf', 'created', 'updated']},
    'meeting': {'sort': {'col': 'date', 'dir': -1}, 'relation': ['initiative', 'story', 'task'], 'scopes': 'date',
                'columns': ['id', 'subject', 'labels', 'date', 'time', 'duration', 'attendees', 'parent:Related to', 'updated'],
                'group_by': ['initiative']},
    'prompt': {'sort': {'col': 'subject', 'dir': 1}, 'relation': None, 'scopes': 'archive',
               'columns': ['id', 'subjectPlain', 'state', 'labels', 'created', 'updated']},
    'activity': {'sort': {'col': 'created_at', 'dir': -1}, 'relation': ['initiative', 'story', 'task', 'note', 'meeting'], 'scopes': 'resolution',
                 'columns': ['id', 'subject', 'source', 'from', 'priority', 'labels', 'date', 'time', 'parent:About', 'resolved', 'updated', 'created']},
    'agent': {'sort': {'col': 'status', 'dir': -1}, 'relation': ['initiative'], 'scopes': 'status',
              'columns': ['id', 'subject', 'status', 'priority', 'prop:platform:Platform', 'prop:trigger:Trigger', 'labels',
                          'parent:Initiative', 'updated'],
              'group_by': ['initiative', 'status', 'priority']},
}

# How the app shows each type: [label, plural, icon, route, nav, counted, go key, quick-add tokens], in the
# order the create form offers them. Nav groups: 'capture' (above Today), 'types' (the type lists, without a count), 'tools'
# (with the work log, labels and people). In a group, `section` splits its links with a line where it changes.
SHOWN = {
    'task': ['Task', 'Tasks', 'task', 'tasks', {'group': 'types', 'order': 3, 'section': 1}, '', 'k', ['/task']],
    'initiative': ['Initiative', 'Initiatives', 'target', 'initiatives', {'group': 'types', 'order': 1, 'section': 1}, '', 'n', ['/initiative', '/ini']],
    'story': ['Story', 'User stories', 'book', 'stories', {'group': 'types', 'order': 2, 'section': 1}, '', 's', ['/story', '/us']],
    'note': ['Note', 'Notes', 'note', 'notes', {'group': 'types', 'order': 6, 'section': 2}, '', 'o', ['/note']],
    'transcription': ['Transcription', 'Transcriptions', 'mic', 'transcriptions', {'group': 'types', 'order': 5, 'section': 2}, '', 'x',
                      ['/transcription', '/trn']],
    'meeting': ['Meeting', 'Meetings', 'users', 'meetings', {'group': 'types', 'order': 4, 'section': 2}, '', 'm', ['/meeting', '/mtg']],
    'agent': [agents.LABEL, agents.PLURAL, agents.ICON, agents.ROUTE, {'group': 'types', 'order': 7, 'section': 3}, '', '', list(agents.TOKENS)],
    'activity': ['Activity', 'Activity', 'mail', 'activity', {'group': 'capture', 'order': 2, 'always': True}, 'open', 'c',
                 ['/activity', '/act']],
    'prompt': ['Prompt', 'Prompts', 'sparkles', 'prompts', {'group': 'tools', 'order': 1}, 'all', 'p', []],
    'inbox': ['Inbox', 'Inbox', 'inbox', 'inbox', {'group': 'capture', 'order': 1, 'always': True}, 'all', 'i', ['/inbox']],
}
PLANNABLE = {name for name in ITEM_TYPES if plannable(name)}  # task, initiative, story: the `work` trait
LABELS = {name: shown[0] for name, shown in SHOWN.items()}


# What a list says where a structure has no stories (the Tasks one): its "Related to" filter offers initiatives only.
NO_STORY_LISTS = {'task': {'relation_label': 'Initiative', 'relation_any': 'Any initiative'}}

# The project (Tasks only): a product or an area of work, a simple version of a Projects vault's. The work hangs from
# it by `project`, its key, so `related_to` stays the hierarchy (initiative → task) and a task may be in a project
# without an initiative. The key is not in the ids (TSK-0001 stays), so an item can change project; the project's own
# key is fixed once made (Store). Planned like its work (Planned · Start · Due), with the statuses of a project.
IN_PROJECT = tuple(name for name in ITEM_TYPES if 'project' in fields_for(name, projects=True))  # the types that carry `project`
PROJECT_FIELDS = fields_for('project', ('project_key',), ext=EXTERNAL_REF)
# Its key heads its page (hidden among the properties).
PROJECT_PROPS = ({'key': 'project_key', 'label': 'Key', 'kind': 'readonly', 'tab': 'hidden'},)
PROJECT_BODY = '\n\n'.join(f'## {h}' for h in ('Goal', 'Scope', 'Notes')) + '\n'


def _project_type():
    return TypeDef(
        name='project', prefix='PRJ', folder='projects', label='Project', plural='Projects', icon='folder', route='projects',
        fields=PROJECT_FIELDS, statuses=PROJECT_STATUSES, closed=PROJECT_CLOSED, plannable=plannable('project'),
        nav={'group': 'types', 'order': 0, 'section': 1},
        list={'sort': {'col': 'status', 'dir': -1}, 'relation': None, 'scopes': 'status',
              'columns': ['id', 'subject', 'prop:project_key:Key', 'status', 'priority', 'due', 'labels', 'updated'],
              'group_by': ['status', 'priority']},
        convertible=False,  # its key is asked for when it is made: an inbox item has none
        counted='', go_key='j', tokens=('/project', '/prj'), props=PROJECT_PROPS,
        page=True, children=('task', 'initiative', 'note', 'meeting'),  # tasks first, as on an initiative's page
        # Its folder may be missing: a Tasks vault from before projects still matches, and gets it with the first one.
        folder_optional=True, body=PROJECT_BODY,
    )


def _list(name, parents, off, projects=False):
    """Its list view (LISTS), its parent column headed as its parent is titled everywhere (traits.parent_label),
    without the types `off` in its "Related to" filter; with `projects`, a Project column (before its parent's, or
    before the dates) and grouped by project too."""
    spec = LISTS.get(name)
    if not spec:
        return spec
    spec = {**spec, 'columns': with_parent_heading(spec['columns'], parent_label(parents, LABELS)),
            **(NO_STORY_LISTS.get(name, {}) if 'story' in off else {})}
    if spec.get('relation'):
        spec['relation'] = [t for t in spec['relation'] if t not in off]
    if projects and name in IN_PROJECT:
        cols = spec['columns']
        at = next((i for i, c in enumerate(cols) if c.startswith('parent:') or c in ('created', 'updated', 'resolved')), len(cols))
        spec['columns'] = [*cols[:at], 'project', *cols[at:]]
        spec['group_by'] = ['project', *(spec.get('group_by') or [])]
    return spec


def _type(name, off=(), projects=False):
    label, plural, icon, route, nav, counted, go_key, tokens = SHOWN[name]
    worked = name in PLANNABLE
    agent = name == 'agent'
    parents = tuple(p for p in PARENT_TYPES[name] if p not in off)
    return TypeDef(
        name=name, prefix=ITEM_TYPES[name], folder=DEFAULT_FOLDERS[name], label=label, plural=plural, icon=icon,
        route=route, fields=fields_for(name, OWN_PROPS.get(name, ()), ext=EXTERNAL_REF, projects=projects), parents=parents,
        statuses=agents.STATUSES if agent else tuple(STATUSES) if worked else (), closed=agents.CLOSED if agent else frozenset(CLOSED),
        closed_when='resolved_at' if name == 'activity' else '',
        nav=nav, list=_list(name, parents, off, projects), creatable=name != 'inbox', convertible=name not in ('inbox', 'prompt'),
        plannable=worked, counted=counted, go_key=go_key, tokens=tuple(tokens), extra_fields=EXTRA_FIELDS.get(name, ()),
        # Only an initiative has a page: its tasks (first, as on a project's), epics, stories, notes and meetings as
        # tables. Its epics are the sub-initiatives whose tracker says Epic (the others have no table of their own).
        page=name == 'initiative',
        children=tuple(c for c in ('task', 'initiative', 'story', 'note', 'meeting') if c not in off) if name == 'initiative' else (),
        child_tables={'initiative': {'label': 'Epics', 'noun': 'Epic', 'where': {'tracker': 'Epic'}}} if name == 'initiative' else None,
        parent_label=parent_label(parents, LABELS),
        props=agents.PROPS if agent else (), folder_optional=agent, body=agents.BODY if agent else '',
    )


def _structure(id, label, off=(), projects=False):
    """A structure of one folder per type: every type of SHOWN but those `off`, which are gone from the others too;
    with `projects`, the project type as well, and `project` on the types that may be in one."""
    types = {name: _type(name, off, projects) for name in SHOWN if name not in off}
    if projects:
        types['project'] = _project_type()
    return Structure(
        id=id, label=label,  # the id config.json names it by; the label, what Settings → Vaults shows
        types=types,
        priorities=tuple(PRIORITIES), id_re=ID_RE, id_pad=ID_PAD,
        # Once `redmine_id` / `redmine_url`: still read under those names (traits.RENAMED_KEYS), renamed on the next save.
        external_ref=dict(EXTERNAL_REF),
        statuses=tuple(STATUSES), closed=frozenset(CLOSED),
        extras={'relation_kinds': relation_kinds(types)},
    )


# Initiatives: the structure this app was built on, with user stories between an initiative and its tasks.
FOLDER_PER_TYPE = _structure('folders', 'Initiatives')
# Tasks: the same without user stories, so a task hangs straight from an initiative, and with projects. Same files,
# same ids, same folders less `stories/`, plus an optional `projects/`.
TASKS = _structure('tasks', 'Tasks', off=('story',), projects=True)
