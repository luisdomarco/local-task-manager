"""The folder-per-type structure: the one this app was built on. One folder per type, ids PREFIX-0001, Redmine as the
outside tracker. These constants used to live in tm/store.py, which still exports them under the same names."""

import re

from . import Structure, TypeDef, agents

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
# What a relation between equals is, as Redmine names it (its API's relation_type) and shows it, in its order. A
# relation is kept on one of the two items (`relations`, its kind in `relation_kinds`); the other sees its inverse.
RELATION_KINDS = (('relates', 'Related to'), ('duplicates', 'Is duplicate of'), ('duplicated', 'Has duplicate'),
                  ('blocks', 'Blocks'), ('blocked', 'Blocked by'), ('precedes', 'Precedes'), ('follows', 'Follows'),
                  ('copied_to', 'Copied to'), ('copied_from', 'Copied from'))
RELATION_INVERSE = {'relates': 'relates', 'duplicates': 'duplicated', 'duplicated': 'duplicates', 'blocks': 'blocked',
                    'blocked': 'blocks', 'precedes': 'follows', 'follows': 'precedes', 'copied_to': 'copied_from',
                    'copied_from': 'copied_to'}
# The types whose relations have a kind; any other relation is plain `relates`.
RELATION_KIND_TYPES = ('initiative', 'story', 'task')
ID_PAD = 4
# Fields written on creation, in this order, after id/type/subject. Status and
# priority only exist on the actionable types (task, initiative). `session_name`
# names the Claude session (or any working session) the item is being handled in.
# `related_to` is the item's parent (one; children point up to it). `relations` are links between equals,
# without hierarchy: ids of other items, kept on whichever of the two made the link and shown on both.
COMMON_TAIL = ['related_to', 'relations', 'url', 'url_label', 'links', 'archived', 'session_name']
TYPE_FIELDS = {
    'initiative': ['status', 'priority', 'priority_reason', *COMMON_TAIL, 'relation_kinds', 'sidebar', 'redmine_id', 'tracker', 'redmine_url', 'local_path',
                   'due', 'plan_week', 'plan_day', 'today_list', 'plan_order', 'completed_at', 'labels', 'docs', 'watchers', 'comments', 'claude_sessions'],
    # A user story: what an initiative is made of and tasks hang from. It stands on its own too
    # (no initiative needed). Its own fields beyond these are still to be defined.
    'story': ['status', 'priority', 'priority_reason', *COMMON_TAIL, 'relation_kinds', 'redmine_id', 'tracker', 'redmine_url', 'local_path',
              'due', 'plan_week', 'plan_day', 'today_list', 'plan_order', 'completed_at', 'labels', 'docs', 'watchers', 'comments', 'claude_sessions'],
    'task': ['status', 'priority', 'priority_reason', *COMMON_TAIL, 'relation_kinds', 'list', 'order', 'due', 'plan_week',
             'plan_day', 'today_list', 'plan_order', 'completed_at', 'labels', 'docs', 'watchers', 'comments', 'claude_sessions'],
    # `plan_order` (initiative, story, task): its place among the cards of its day, or of its week when no day, on Today
    # and Week, where you order them by hand (TSK-053); the Board has its own, `order`, within its list.
    # `docs` (initiative, story, task): what it links in the vault's Docs (TSK-039), [[a doc]] or a folder/ (store.clean_docs)
    # `watchers` (initiative, story, task): the people and groups of Contacts to tell when it changes status (TSK-051)
    # `relation_kinds` (initiative, story, task): what each of its `relations` is, as Redmine names it (RELATION_KINDS):
    # {id: kind}, an id it does not name being `relates`. `tracker` (initiative, story): the ticket's tracker (Story, Epic…)
    'note': [*COMMON_TAIL, 'labels', 'comments', 'claude_sessions'],
    # The text of a meeting (a recording turned into text): the body is the transcript, `related_to` is the meeting.
    'transcription': [*COMMON_TAIL, 'labels', 'comments', 'claude_sessions'],
    # `time` is when it starts (HH:MM, 24 h; blank for an all-day event or when not known), `duration` how long
    # it lasts (HH:MM, like a work-log entry's time). `event_id` is the Google Calendar
    # event it was synced from (a calendar sync of your own): blank for a meeting created by hand.
    'meeting': ['date', 'time', 'duration', *COMMON_TAIL, 'attendees', 'event_id', 'labels', 'comments', 'claude_sessions'],
    # Captured, not yet triaged: no relation, no status. Convert it to become something.
    'inbox': ['url', 'url_label', 'links', 'archived', 'session_name', 'labels', 'comments', 'claude_sessions'],
    # An incoming message (email, Slack, comment) pasted as-is: the body is the
    # message, `resolution` is what was done about it. Resolved ⇔ resolved_at set. `date` and `time` are when it
    # came (time as a meeting's: HH:MM, 24 h, blank when not known).
    'activity': ['source', 'from', 'date', 'time', 'priority', 'priority_reason', *COMMON_TAIL, 'resolution', 'resolved_at', 'labels', 'comments', 'claude_sessions'],
    # A reusable prompt: the body is the prompt itself. Like a note it has no status: it is active until archived.
    # It relates to nothing. "Work with Claude" can load it as the extra instruction.
    'prompt': ['archived', 'labels'],
    # An AI agent of the backlog (tm/structures/agents.py): its own statuses, a priority, where and how it runs.
    'agent': ['status', 'priority', 'priority_reason', *agents.PROP_KEYS, *COMMON_TAIL, 'local_path', 'labels', 'comments', 'claude_sessions'],
}
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
# are listed too), 'date' (Today / Tomorrow / Week, for a dated type) or None (no such row). `relation`: the
# parent types its "Related to" filter offers, under `relation_label` with `relation_any` for no filter.
# `group_by`: what it can be grouped by (static/js/grouping.js); `noun`: one of them, where it is not its label.
PLANNED = ['id', 'subject', 'status', 'priority', 'plan', 'due']
LISTS = {
    'initiative': {'sort': {'col': 'priority', 'dir': 1}, 'relation': None, 'scopes': 'status',
                   'columns': [*PLANNED, 'extref', 'labels', 'progress', 'parent:Parent', 'updated'],
                   'group_by': ['status', 'priority', 'plan']},
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
PLANNABLE = {'task', 'initiative', 'story'}
# What a type's parent is to it, as the Relations tab titles it.
PARENT_LABEL = {'task': 'Task of', 'story': 'User story of', 'initiative': 'Sub-initiative of', 'transcription': 'Transcription of',
                'activity': 'About', 'agent': 'Agent of'}


def _type(name):
    label, plural, icon, route, nav, counted, go_key, tokens = SHOWN[name]
    plannable = name in PLANNABLE
    agent = name == 'agent'
    return TypeDef(
        name=name, prefix=ITEM_TYPES[name], folder=DEFAULT_FOLDERS[name], label=label, plural=plural, icon=icon,
        route=route, fields=tuple(TYPE_FIELDS[name]), parents=tuple(PARENT_TYPES[name]),
        statuses=agents.STATUSES if agent else tuple(STATUSES) if plannable else (), closed=agents.CLOSED if agent else frozenset(CLOSED),
        closed_when='resolved_at' if name == 'activity' else '',
        nav=nav, list=LISTS.get(name), creatable=name != 'inbox', convertible=name not in ('inbox', 'prompt'),
        plannable=plannable, counted=counted, go_key=go_key, tokens=tuple(tokens), extra_fields=EXTRA_FIELDS.get(name, ()),
        # Only an initiative has a page: its stories, tasks, notes and meetings as tables.
        page=name == 'initiative', children=('story', 'task', 'note', 'meeting') if name == 'initiative' else (),
        parent_label=PARENT_LABEL.get(name, ''),
        props=agents.PROPS if agent else (), folder_optional=agent, body=agents.BODY if agent else '',
    )


FOLDER_PER_TYPE = Structure(
    id='folders', label='Folder per type',  # the id config.json names it by
    types={name: _type(name) for name in SHOWN},
    priorities=tuple(PRIORITIES), id_re=ID_RE, id_pad=ID_PAD,
    # The keys keep their first name (redmine_…): the files and the Redmine sync know them by it.
    external_ref={'id_key': 'redmine_id', 'url_key': 'redmine_url', 'tracker_key': 'tracker', 'label': 'Ticket',
                  'id_placeholder': '4521', 'url_placeholder': 'https://redmine…/issues/4521', 'tracker_placeholder': 'Story, Epic…'},
    statuses=tuple(STATUSES), closed=frozenset(CLOSED),
    extras={'relation_kinds': {'kinds': [list(k) for k in RELATION_KINDS], 'inverse': dict(RELATION_INVERSE),
                               'types': list(RELATION_KIND_TYPES)}},
)
