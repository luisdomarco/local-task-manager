"""Field traits: which of the app's own fields a kind of item carries, the same in every structure.

A type is its traits plus the props of its own (a structure's `PROPS`, an agent's platform…). A structure decides
which types it has and their props; what a task, an initiative or a meeting carries besides is decided here, once, so
a type looks and behaves the same in every vault (the field matrix, tools/field_matrix.py, is read from this).

    base        every item: labels, links, archive, and its place in a board's column (`order`: Order → Manual)
    discussed   worked on and talked about: comments, Claude sessions (every item but a prompt, which is only read)
    child       hangs from a parent (`related_to`) and, in a structure with projects, lives in one (`project`)
    related     linked to equals (`relations` + `relation_kinds`, tm/structures/relations.py); needs an id
    work        planned and worked: status, priority, due, Today / Week / Month, watchers, docs
    tracked     points at an outside ticket and a local folder (the structure's `external_ref` keys + local_path)
    stateful    a status of its own, not planned (an agent's, an error's, a spec's)
    prioritized a priority without being planned (an agent, an activity)
    event       happens at a time (a meeting)
    container   holds work (a project): its key; with `work`, it is planned like what it holds
    spanned     runs from a start to its due (a project, an initiative): a start date, beside Planned and Due
    aimed       has an aim (a project, an initiative): its area and its objective, a section of their own above the
                description

Plannable ⇔ `work`. A type with no id (a Projects plan, an analysis) is never `related`: an equal is named by its id.
"""

TRAITS = {
    'base': ('url', 'url_label', 'links', 'archived', 'labels', 'order'),
    'discussed': ('session_name', 'comments', 'claude_sessions'),
    'child': ('related_to', 'project'),
    'related': ('relations', 'relation_kinds'),
    'work': ('status', 'priority', 'priority_reason', 'due', 'plan_week', 'plan_day', 'plan_month', 'today_list', 'plan_order',
             'week_list', 'week_order', 'completed_at', 'docs', 'watchers'),
    'tracked': ('ticket_id', 'tracker', 'ticket_url', 'local_path'),
    'stateful': ('status',),
    'prioritized': ('priority', 'priority_reason'),
    'event': ('date', 'time', 'duration', 'attendees', 'event_id'),
    'container': ('project_key',),
    'spanned': ('start',),
    'aimed': ('area', 'objective'),
}

# A project's statuses, in every structure that has projects (a Tasks project's, a Projects one's): a work item's, less
# Blocked and Review. Done and Discarded close it.
PROJECT_STATUSES = ('Backlog', 'ToDo', 'OnHold', 'InProgress', 'Done', 'Discarded')
PROJECT_CLOSED = frozenset({'Done', 'Discarded'})

WORK_TYPES = ('initiative', 'story', 'task', 'support', 'hotfix', 'prd')

# What each kind of item is made of, whatever the structure that has it.
KINDS = {
    **{t: ('base', 'discussed', 'child', 'related', 'work', 'tracked') for t in WORK_TYPES},
    'initiative': ('base', 'discussed', 'child', 'related', 'work', 'tracked', 'aimed', 'spanned'),
    'project': ('base', 'discussed', 'related', 'container', 'work', 'tracked', 'aimed', 'spanned'),
    'goal': ('base', 'discussed', 'related', 'work', 'spanned'),  # across projects: no parent, no project
    'agent': ('base', 'discussed', 'child', 'related', 'stateful', 'prioritized', 'tracked'),
    'spec': ('base', 'discussed', 'child', 'related', 'stateful'),
    'error': ('base', 'discussed', 'child', 'related', 'stateful'),
    'activity': ('base', 'discussed', 'child', 'related', 'prioritized'),
    'meeting': ('base', 'discussed', 'child', 'related', 'event'),
    'note': ('base', 'discussed', 'child', 'related'),
    'transcription': ('base', 'discussed', 'child', 'related'),
    'plan': ('base', 'discussed', 'child', 'related'),
    'analysis': ('base', 'discussed', 'child', 'related'),
    'learning': ('base', 'discussed', 'child', 'related'),
    'inbox': ('base', 'discussed'),  # captured, not yet triaged: it relates to nothing until it is converted
    'prompt': ('base',),  # a reusable prompt: read, never worked on nor related
}

# The app's fields a kind carries beyond its traits, the same in every structure: a task's list on the Board (board.md),
# an initiative's star in the sidebar, an incoming message's source and what was done about it.
OWN = {
    'task': ('list',),
    'initiative': ('sidebar',),
    'activity': ('source', 'from', 'date', 'time', 'resolution', 'resolved_at'),
}

# The order fields are written in (a folder-per-type file's keys on creation) and listed in: a type's own props go
# right before the hierarchy (`related_to`).
ORDER = ('project_key', 'source', 'from', 'date', 'time', 'duration', 'status', 'priority', 'priority_reason', 'area', 'objective', '__own__',
         'related_to', 'project', 'relations', 'relation_kinds', 'url', 'url_label', 'links', 'archived', 'session_name',
         'sidebar', 'list', 'order', 'ticket_id', 'tracker', 'ticket_url', 'local_path', 'start', 'due', 'plan_week', 'plan_day',
         'plan_month', 'today_list', 'plan_order', 'week_list', 'week_order', 'completed_at', 'resolution', 'resolved_at',
         'attendees', 'event_id', 'labels', 'docs', 'watchers', 'comments', 'claude_sessions')

# A key of a folder-per-type file under its first name, read as its new one (and renamed on the next save or by
# tools/migrate_ticket_keys.py): the outside ticket was Redmine's before it was any tracker's.
RENAMED_KEYS = {'redmine_id': 'ticket_id', 'redmine_url': 'ticket_url'}

# Where an item shows each field of the app's, in the card's and the page's order (the field matrix's sections; a
# type's own props say theirs with `tab`, tm/structures prop_tab).
SECTIONS = ('Header', 'Properties', 'Settings', 'Settings · Global', 'Settings · Support due days', 'Settings · Code', 'Area and objective', 'Description',
            'Attachments', 'Links', 'Details · Ticket & local', 'Details · Watchers', 'Details · Log work', 'Activity', 'AI',
            'Delivery · Readiness', 'Delivery · Execution', 'Delivery · Code', 'Delivery · Spec and release', 'Delivery · Triage',
            'Delivery · Paused or discarded', 'Relations', 'Docs', 'Boards and planning', 'Header menus', 'Footer',
            'Hidden (shown elsewhere)', 'Stored, not shown')
SECTION_OF = {
    'subject': 'Header', 'id': 'Header',
    **{k: 'Properties' for k in ('status', 'priority', 'priority_reason', 'start', 'due', 'plan_week', 'plan_day', 'plan_month', 'labels',
                                 'date', 'time', 'duration', 'attendees', 'source', 'from', 'resolution')},
    'area': 'Area and objective', 'objective': 'Area and objective',
    'body': 'Description', 'attachments': 'Attachments',
    **{k: 'Details · Ticket & local' for k in ('ticket_id', 'ticket_url', 'tracker', 'local_path')},
    'watchers': 'Details · Watchers', 'worklog': 'Details · Log work',
    **{k: 'Links' for k in ('url', 'url_label', 'links')},
    **{k: 'Relations' for k in ('related_to', 'project', 'relations', 'relation_kinds')},
    'docs': 'Docs', 'comments': 'Activity', 'claude_sessions': 'AI',
    **{k: 'Boards and planning' for k in ('list', 'order', 'today_list', 'plan_order', 'week_list', 'week_order')},
    'sidebar': 'Header menus', 'archived': 'Header menus',
    'created_at': 'Footer', 'updated_at': 'Footer',
    'project_key': 'Hidden (shown elsewhere)',
    **{k: 'Stored, not shown' for k in ('session_name', 'completed_at', 'resolved_at', 'event_id')},
}


def traits_of(kind, has_id=True):
    """The traits of a kind of item; without an id it is never related to equals."""
    traits = KINDS[kind]
    return tuple(t for t in traits if has_id or t != 'related')


def fields_for(kind, own=(), *, ext=None, projects=False, has_id=True, drop=()):
    """The fields an item of `kind` carries, in ORDER: its traits', OWN's and `own` (its props' keys, before the
    hierarchy). `ext`: the structure's external_ref (its id, url and tracker keys stand for `tracked`'s); `projects`:
    whether the structure has projects (else no `project`); `drop`: what this type has in another way (a support
    ticket's level stands where a priority would)."""
    keys = [k for t in traits_of(kind, has_id) for k in TRAITS[t]]
    if ext is not None and 'tracked' in KINDS[kind]:
        outside = {'ticket_id': ext.get('id_key'), 'ticket_url': ext.get('url_key'), 'tracker': ext.get('tracker_key')}
        keys = [outside.get(k, k) for k in keys if outside.get(k, k)]
    if not projects or kind == 'project':
        keys = [k for k in keys if k != 'project']
    keys += OWN.get(kind, ())
    rank = {k: i for i, k in enumerate(ORDER)}
    head = sorted((k for k in dict.fromkeys(keys) if k not in drop), key=lambda k: rank.get(k, len(ORDER)))
    at = next((i for i, k in enumerate(head) if rank.get(k, len(ORDER)) > rank['__own__']), len(head))
    own = [k for k in own if k not in head and k not in drop]
    return tuple(dict.fromkeys([*head[:at], *own, *head[at:]]))


def plannable(kind):
    return 'work' in KINDS[kind]


def parent_label(parents, labels):
    """What an item's parent is to it, the same rule everywhere: the parent type's label when it can hang from one type
    only ("Meeting", "Initiative"), "Parent" when from several, '' when from none. `labels`: type → its label."""
    parents = tuple(parents)
    if not parents:
        return ''
    return labels.get(parents[0], 'Parent') if len(parents) == 1 else 'Parent'


def with_parent_heading(columns, label):
    """A list's columns with its parent column (`parent:` or `related:`) headed by `label`."""
    if not label:
        return list(columns)
    return [f"{c.split(':', 1)[0]}:{label}" if c.startswith(('parent:', 'related:')) else c for c in columns]
