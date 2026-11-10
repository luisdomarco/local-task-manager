"""Vault structures: what a vault's folders and files must look like for the app to show it.

A vault is a folder plus the name of its structure. The structure says which folders it has and which
files go where; tm/structures/check.py compares a folder against it. Nothing here imports the Store or the
server, so the structures can later move out of the app (a capability) without dragging the app along.

A structure is data (`Structure`): its item types (`TypeDef`: id prefix, folder, fields, parents,
statuses…, and how the app shows them), its priorities, its id format, and the external reference its
items carry (Redmine for the folder-per-type structure). The Store reads its rules from it, and the page gets the part it needs
from GET /api/structure (`Structure.public()`).
"""

import re
from dataclasses import dataclass, field, replace

# Every status of every type falls in one of three groups, fixed and never edited (TSK-037): an item is open while its
# status is in the first two, closed in the last. A vault arranges each type's statuses in them (Settings → Item type
# status, <vault>/.task-manager/statuses.json): which statuses, their order, their colour.
GROUPS = ('not_started', 'in_progress', 'closed')
GROUP_LABELS = {'not_started': 'Not started', 'in_progress': 'In progress', 'closed': 'Closed'}
# Where a status goes when no vault said: its type's closed ones are closed, these have not started, the rest are under way.
NOT_STARTED = frozenset({'Backlog', 'ToDo', 'Idea', 'open', 'draft', 'Planned'})  # draft: a spec's; Planned: a project's before 2026-11
COLOR_RE = re.compile(r'^#[0-9a-fA-F]{6}$')
# A status name: what the frontmatter says, so one line, and short enough for a pill.
STATUS_NAME_RE = re.compile(r'^[^\x00-\x1f:#\[\]{}"\\]{1,40}$')
# A short id (plans/short-ids.md): the item's number, one counter per vault shared by every type. Stored as it is
# (`id: 482`); the app draws it with its type's prefix (`TSK-482`, Structure.ref).
NUMBER_RE = re.compile(r'^[1-9]\d*$')
# How a short id is drawn and typed: a type's prefix and the number (`TSK-482`), never zero-padded.
REF_RE = re.compile(r'^([A-Z]{2,4})-([1-9]\d*)$')


class StatusConfigError(ValueError):
    pass


@dataclass(frozen=True)
class TypeDef:
    """One item type of a structure."""
    name: str                 # what `type:` says in the frontmatter: 'task'
    prefix: str               # of its ids: 'TSK'
    folder: str               # where new ones are written (a vault's `folders` may move it)
    label: str                # 'Task'
    plural: str               # 'Tasks': its list's title and its sidebar link
    icon: str                 # an icon name of static/js/ui.js
    route: str                # the view that lists it (#/<route>), and where its card opens over
    fields: tuple             # written on creation, in this order, after id/type/subject
    parents: tuple = ()       # the types it may be related to (its parent)
    statuses: tuple = ()      # the statuses it may have; () when it has none
    closed: frozenset = frozenset()  # the statuses that close it
    closed_when: str = ''     # or: the field whose value closes it (an activity is closed once resolved)
    groups: dict = None       # status -> its group (GROUPS), when a vault arranged them; None: the default (group_of)
    nav: dict = None          # where its link sits in the sidebar: {'group', 'order'}; None for no link
    list: dict = None         # how its list view shows it (columns, sort, scopes…); None when it has no list
    has_id: bool = True       # whether its items get an id (prefix-number)
    creatable: bool = True    # offered by the create form
    convertible: bool = True  # what an inbox item can be converted into
    plannable: bool = False   # status, priority and planning (Today, Week, Board)
    counted: str = 'all'      # its sidebar count: 'all' of them, the 'open' ones, or '' for none
    go_key: str = ''          # "g then <key>" goes to its view
    tokens: tuple = ()        # quick add: the /tokens that make a line one of these
    extra_fields: tuple = ()  # what it may carry beyond its own fields (legacy ones, read but never created)
    # Fields of its own the card shows beyond the app's (status, priority, plan…): [{key, label, kind, options…}]
    # with kind text · textarea · select · number · date · link · links · readonly · map. () for none.
    # `tab` says where the item shows one: 'main' (the properties, the default), or a tab of the side panel:
    # 'delivery' (how it is carried out: branch, executor…), 'details' (settings to read), 'settings' (a project's, a
    # section that folds on its page, above its area and objective), 'relations' (every
    # link and links prop goes there unless it says otherwise).
    props: tuple = ()
    page: bool = False        # opens as a page of its own (#/<name>/<id>) instead of a card over its list
    children: tuple = ()      # on its page, a table of each of these types hanging from it, in this order
    # Where one of those tables is not its type's whole list: {type: {label, noun, where: {field: value}}} — the tab's title, one of them,
    # and the value a field must have (any case) for an item to be in it, which its quick add also writes. None for none.
    child_tables: dict = None
    parent_label: str = ''    # what its parent is to it, as the Relations tab titles it ('Sub-initiative of')
    # Its folder may be missing: the vault still matches, and the folder is made with its first item (an agent's).
    folder_optional: bool = False
    body: str = ''            # a new item's body when none is given (an agent's sections); '' for none
    canvas: bool = False      # its detail has a Canvas tab: its own canvases, in <Docs>/Canvases/<its ref>

    @property
    def relatable(self):
        """Whether it can be linked to others (as a parent, a child or an equal)."""
        return 'relations' in self.fields


@dataclass(frozen=True)
class Structure:
    id: str
    label: str
    types: dict                     # name -> TypeDef, in the order the app lists them
    priorities: tuple
    id_re: re.Pattern               # an item id: group 1 is its prefix, group 2 its number
    id_pad: int                     # digits of a new id's number
    external_ref: dict              # {id_key, url_key, label}: the outside tracker an item points at
    statuses: tuple                 # every status of the structure, in board order
    closed: frozenset               # the statuses that close an item, for any type that does not say
    other_types: frozenset = frozenset({'worklog'})  # typed files that are not items
    # Whether a new vault of it numbers its items (short ids: one counter per vault, the type only drawn). A vault that
    # already has ids of the long form (id_re) keeps them until tools/migrate_short_ids.py moves it.
    numbered: bool = False
    worklog_folder: str = 'worklog'  # where the work log's day files go
    # `attachments`: its files (tm/attachments.py), on any type, written only once it has one.
    common_fields: frozenset = frozenset({'id', 'type', 'subject', 'created_at', 'updated_at', 'converted_from', 'title', 'attachments'})
    defaults: dict = field(default_factory=dict)  # a new item's values where they are not the app's (a first status…)
    extras: dict = field(default_factory=dict)  # anything else the page needs that is not per type
    # How its files map to items, when that is not the app's own format (None: `type:` and the app's keys, as
    # the folder-per-type structure); see tm/structures/ticketing/codec.py for what a codec does.
    codec: object = None
    # Its own check of a vault folder (root, load) -> result, when the generic one (check.py) does not fit.
    checker: object = None
    # The types a vault of it cannot turn off (Ticketing: the project, which holds every ticket's folder and id).
    required: tuple = ()
    # Its statuses' names and order are part of its file format (Ticketing writes "5. Review", the number being the
    # position, and its rules name them): a vault may then change only their colour, and move them between Not started
    # and In progress.
    statuses_locked: bool = False
    colors: dict = field(default_factory=dict)  # status name -> '#rrggbb' a vault gave it (else the page's palette)
    # Docs (TSK-039): where a vault keeps its documents — files, never items, whatever their frontmatter says. A folder
    # `docs_folder` at the top of the vault and, when `docs_in_projects`, one inside each project's folder too (any top
    # folder but `docs_not_projects`, the structure's own). Neither the check nor the item scan looks inside them.
    docs_folder: str = 'docs'
    docs_in_projects: bool = False
    docs_not_projects: frozenset = frozenset()
    # Project kinds (tm/structures/kinds.py): {id: Kind}, what a project is and which types of its own folders it may
    # have, and the project field that names it (`kind_key`). {} and '' for a structure whose projects have no kind.
    kinds: dict = field(default_factory=dict)
    kind_key: str = ''

    # ── project kinds ────────────────────────────────────────────────────────
    def kind(self, value):
        """The Kind a project's kind field names (the default kind when it names none or an unknown one); None when
        this structure has no kinds."""
        if not self.kinds:
            return None
        return self.kinds.get(str(value or '').strip()) or next(iter(self.kinds.values()))

    # ── docs (TSK-039) ───────────────────────────────────────────────────────
    def docs_container(self, rel):
        """The Docs folder that `rel` (a path in the vault, '/'-separated) is in or is — `Docs` or `<Project>/Docs` —
        else ''. Pure: from the path alone, nothing is read."""
        parts = [p for p in str(rel or '').replace('\\', '/').split('/') if p not in ('', '.')]
        if parts and parts[0] == self.docs_folder:
            return parts[0]
        if (self.docs_in_projects and len(parts) >= 2 and parts[1] == self.docs_folder
                and parts[0] not in self.docs_not_projects and not parts[0].startswith('.')):
            return f'{parts[0]}/{parts[1]}'
        return ''

    def in_docs(self, rel):
        return bool(self.docs_container(rel))

    # ── types a vault turned off ─────────────────────────────────────────────
    def without(self, names):
        """This structure with the types `names` turned off (Settings → Vaults), as the app then sees it: those types
        are gone, and so are they from every other type's parents and link fields. The files stay on disk; only the
        app stops showing, listing, creating and linking them. The required types are never turned off."""
        off = {n for n in (names or ()) if n in self.types and n not in self.required}
        if not off:
            return self

        def prop(p):
            if p.get('kind') in ('link', 'links'):
                return {**p, 'types': [t for t in p.get('types') or [] if t not in off]}
            return p
        types = {name: replace(t, parents=tuple(p for p in t.parents if p not in off), children=tuple(c for c in t.children if c not in off),
                               props=tuple(q for q in map(prop, t.props) if q.get('kind') not in ('link', 'links') or q['types']))
                 for name, t in self.types.items() if name not in off}
        extras = {**self.extras, 'disabled_types': sorted(off)}
        for key in ('project_scoped', 'optional_types', 'needs_parent', 'leaves_project'):
            if key in extras:
                extras[key] = [t for t in extras[key] if t not in off]
        if 'sections' in extras:  # a type turned off is no tab; a section with none left is no link
            extras['sections'] = [dict(s, types=[t for t in s['types'] if t not in off]) for s in extras['sections']
                                  if any(t not in off for t in s['types'])]
        return replace(self, types=types, extras=extras)

    # ── statuses a vault arranged (TSK-037) ──────────────────────────────────
    def check_statuses(self, cfg):
        """Raises StatusConfigError unless `cfg` ({types: {type: [{name, group}]}, colors: {name: '#rrggbb'}}) is a
        valid arrangement of this structure's statuses. → it normalized: each type's statuses in group order (a new
        item takes the first, which has not started), colours lower-cased."""
        if not isinstance(cfg, dict):
            raise StatusConfigError('statuses: expected an object')
        out = {'types': {}, 'colors': {}}
        for name, entries in (cfg.get('types') or {}).items():
            t = self.types.get(name)
            if not t or not t.statuses:
                raise StatusConfigError(f'{name}: not a type with statuses here')
            if not isinstance(entries, list) or not entries:
                raise StatusConfigError(f'{t.plural}: at least one status')
            seen, rows = set(), []
            for e in entries:
                status = str((e or {}).get('name') or '').strip() if isinstance(e, dict) else ''
                group = e.get('group') if isinstance(e, dict) else None
                if not STATUS_NAME_RE.match(status):
                    raise StatusConfigError(f'{t.plural}: "{status}" is not a status name (one line, up to 40 characters, no : # [ ] {{ }} " \\)')
                if status.lower() in seen:
                    raise StatusConfigError(f'{t.plural}: {status} twice')
                if group not in GROUPS:
                    raise StatusConfigError(f"{t.plural}: {status}'s group must be one of {', '.join(GROUPS)}")
                seen.add(status.lower())
                rows.append({'name': status, 'group': group})
            rows.sort(key=lambda r: GROUPS.index(r['group']))  # stable: the order within a group stays
            for g, what in (('not_started', 'to start'), ('closed', 'to close')):
                if not any(r['group'] == g for r in rows):
                    raise StatusConfigError(f'{t.plural}: at least one {GROUP_LABELS[g]} status, {what} an item')
            if self.statuses_locked:
                if [r['name'] for r in rows] != list(t.statuses):
                    raise StatusConfigError(f'{t.plural}: the {self.label} format fixes its statuses and their order ({", ".join(t.statuses)})')
                if {r['name'] for r in rows if r['group'] == 'closed'} != set(t.closed):
                    raise StatusConfigError(f'{t.plural}: in {self.label} the closed ones stay {", ".join(_in_order(t.closed, t.statuses))}')
            out['types'][name] = rows
        known = {r['name'] for rows in out['types'].values() for r in rows} | {s for t in self.types.values() for s in t.statuses}
        for status, color in (cfg.get('colors') or {}).items():
            if status not in known:
                raise StatusConfigError(f'colour for {status}: no such status')
            if color in (None, ''):
                continue
            if not isinstance(color, str) or not COLOR_RE.match(color):
                raise StatusConfigError(f'colour for {status}: expected #rrggbb')
            out['colors'][status] = color.lower()
        return out

    def with_statuses(self, cfg):
        """This structure with the statuses a vault arranged (check_statuses first): each type named gets its own list,
        closed set and groups; the structure's list gains any new name (the board's lists pick from it)."""
        if not cfg or not (cfg.get('types') or cfg.get('colors')):
            return self
        types = dict(self.types)
        for name, rows in (cfg.get('types') or {}).items():
            if name in types:
                types[name] = replace(types[name], statuses=tuple(r['name'] for r in rows),
                                      closed=frozenset(r['name'] for r in rows if r['group'] == 'closed'),
                                      groups={r['name']: r['group'] for r in rows})
        used = [s for t in types.values() for s in t.statuses]  # a status no type has any more is gone from the board's choice
        names = [s for s in self.statuses if s in used]
        names += [s for s in dict.fromkeys(used) if s not in names]
        return replace(self, types=types, statuses=tuple(names), colors={**self.colors, **(cfg.get('colors') or {})})

    def groups_of(self, type_name):
        """{status: group} for that type's statuses: as a vault arranged them, else closed · not started · under way."""
        t = self.types.get(type_name)
        statuses, closed = self.statuses_of(type_name), self.closed_of(type_name)
        if t and t.groups:
            return dict(t.groups)
        return {s: 'closed' if s in closed else 'not_started' if s in NOT_STARTED else 'in_progress' for s in statuses}

    def status_config(self):
        """Every type with statuses, as Settings → Statuses edits them: {types: {type: [{name, group}]}, colors}."""
        return {'types': {t.name: [{'name': s, 'group': g} for s, g in self.groups_of(t.name).items()]
                          for t in self.types.values() if t.statuses},
                'colors': dict(self.colors)}

    # ── ids ──────────────────────────────────────────────────────────────────
    def parse_id(self, value):
        """→ (prefix, number), or None when `value` is not an id of this structure."""
        m = self.id_re.match(str(value or ''))
        return (m.group(1), int(m.group(2))) if m else None

    def format_id(self, prefix, number):
        return f'{prefix}-{number:0{self.id_pad}d}'

    @staticmethod
    def is_number(value):
        """Whether `value` is a short id: a number (`482`, as the file stores it or as a key)."""
        return isinstance(value, (str, int)) and not isinstance(value, bool) and bool(NUMBER_RE.match(str(value)))

    def ref(self, type_name, item_id):
        """How an id is drawn: a short id with its type's prefix (`TSK-482`); any other id (a long one, a project's key)
        as it is."""
        if self.is_number(item_id) and type_name in self.types and self.types[type_name].prefix:
            return f'{self.types[type_name].prefix}-{item_id}'
        return item_id

    @staticmethod
    def number_of(value):
        """The number a typed short id names (`482`, `TSK-482`) as a key ('482'), or None."""
        v = str(value or '').strip()
        if NUMBER_RE.match(v):
            return v
        m = REF_RE.match(v)
        return m.group(2) if m else None

    def prefix_for(self, type_name, project=None):
        """The prefix of a new id of that type: its own, or `<project key>-<its own>` for a type that lives in a project
        (a ticket in no project: its own, `INI`)."""
        t = self.types[type_name]
        return f'{project}-{t.prefix}' if project and type_name in self.extras.get('project_scoped', ()) else t.prefix

    # ── types ────────────────────────────────────────────────────────────────
    @property
    def item_types(self):
        """{type: id prefix}, as ITEM_TYPES has always been."""
        return {t.name: t.prefix for t in self.types.values()}

    @property
    def default_folders(self):
        return {**{t.name: t.folder for t in self.types.values()}, 'worklog': self.worklog_folder}

    @property
    def folders_configurable(self):
        """Whether a vault of this structure may move its types' folders (Settings → Vaults): only when its layout
        is one folder per type; a structure with its own format (a codec) has its layout fixed."""
        return self.codec is None

    @property
    def type_fields(self):
        return {t.name: list(t.fields) for t in self.types.values()}

    @property
    def parent_types(self):
        return {t.name: list(t.parents) for t in self.types.values()}

    def allowed_fields(self, type_name):
        """Everything a type may carry: the ones every item has, its own, and its legacy extras."""
        t = self.types[type_name]
        return {*self.common_fields, *t.fields, *t.extra_fields}

    def statuses_of(self, type_name):
        t = self.types.get(type_name)
        return t.statuses if t and t.statuses else self.statuses

    def closed_of(self, type_name):
        t = self.types.get(type_name)
        return t.closed if t and t.closed else self.closed

    def check_spec(self, folders, skip_dirs):
        """What tm/structures/check.py compares a vault against."""
        return {
            'folders': dict(folders),
            'optional': {t.name for t in self.types.values() if t.folder_optional},
            'types': self.item_types,
            'other_types': set(self.other_types),
            'id_re': self.id_re,
            'skip_dirs': set(skip_dirs),
            'docs': self.docs_folder,
        }

    # ── the page's part ──────────────────────────────────────────────────────
    def public(self):
        """What GET /api/structure answers: everything the page builds its types, nav and lists from."""
        return {
            'id': self.id,
            'label': self.label,
            'statuses': list(self.statuses),
            'closed': sorted(self.closed, key=list(self.statuses).index),
            'priorities': list(self.priorities),
            'id_pattern': self.id_re.pattern,
            'id_pad': self.id_pad,
            'external_ref': dict(self.external_ref),
            'types': [{
                'name': t.name, 'prefix': t.prefix, 'folder': t.folder, 'label': t.label, 'plural': t.plural,
                'icon': t.icon, 'route': t.route, 'fields': list(t.fields), 'parents': list(t.parents),
                'statuses': list(t.statuses), 'closed': _in_order(t.closed, t.statuses or self.statuses),
                **({'groups': self.groups_of(t.name)} if t.statuses else {}),
                'closed_when': t.closed_when, 'nav': t.nav, 'list': t.list, 'has_id': t.has_id,
                'creatable': t.creatable, 'convertible': t.convertible, 'plannable': t.plannable,
                'relatable': t.relatable, 'counted': t.counted, 'go_key': t.go_key, 'tokens': list(t.tokens),
                **({'props': [{**p, 'tab': prop_tab(p)} for p in t.props]} if t.props else {}),
                **({'page': True, 'children': list(t.children)} if t.page else {}),
                **({'child_tables': {k: v for k, v in t.child_tables.items() if k in t.children}} if t.page and t.child_tables else {}),
                **({'parent_label': t.parent_label} if t.parent_label else {}),
                **({'canvas': True} if t.canvas else {}),
            } for t in self.types.values()],
            'groups': [[g, GROUP_LABELS[g]] for g in GROUPS],
            **({'statuses_locked': True} if self.statuses_locked else {}),
            **({'colors': dict(self.colors)} if self.colors else {}),
            **({'defaults': dict(self.defaults)} if self.defaults else {}),
            **({'required': list(self.required)} if self.required else {}),
            # What a project may be, its own types and the fields it has not (tm/structures/kinds.py), and the field
            # that says it: the page offers a project's kinds and, in each project, only what its kind has.
            **({'kinds': [k.public(self.types) for k in self.kinds.values()], 'kind_key': self.kind_key} if self.kinds else {}),
            **self.extras,
        }

    def type_choices(self):
        """What Settings → Vaults offers a vault of it: every type to turn on and off, by name and label, the required
        ones, and the folders it may move ({kind: default folder}; {} when its layout is fixed)."""
        return {'types': [[t.name, t.plural] for t in self.types.values()], 'required': list(self.required),
                'folders': self.default_folders if self.folders_configurable else {}}


def prop_tab(p):
    """Where an item shows one of its type's own fields: its `tab`, else Relations for a link, else the properties."""
    return p.get('tab') or ('relations' if p.get('kind') in ('link', 'links') else 'main')


def _in_order(values, order):
    """`values` sorted as they come in `order` (a type's own statuses, an error's open · mitigated · resolved, may
    not be the structure's); any not in it go last."""
    order = list(order)
    return sorted(values, key=lambda v: (order.index(v) if v in order else len(order), str(v)))


def _registry():
    from .folders import FOLDER_PER_TYPE, TASKS
    from .ticketing import TICKETING
    return {FOLDER_PER_TYPE.id: FOLDER_PER_TYPE, TASKS.id: TASKS, TICKETING.id: TICKETING}


# The structures a vault can have, by id, in the order Settings → Vaults offers them: Initiatives (`folders`, one
# folder per type: the one this app was built on), Tasks (`tasks`, the same without user stories) and Projects
# (`ticketing`: projects as folders, short ids drawn `TSK-482`). The ids are what config.json stores and never change.
REGISTRY = _registry()
# Projects holds every kind of project (tm/structures/kinds.py), so it is the one a new vault gets. Initiatives and
# Tasks are legacy: a vault of theirs still works, says it can be moved (tools/migrate_structures.py,
# docs/migrate-structures.md), and Settings no longer offers them for a new vault.
DEFAULT_STRUCTURE = 'ticketing'
LEGACY_STRUCTURES = ('folders', 'tasks')
# What a config that names no structure meant when it was written: a vault from before there were structures to
# pick (or a `root` from before there were vaults) is an Initiatives vault.
UNNAMED_STRUCTURE = 'folders'
STRUCTURES = {k: {'label': s.label, 'legacy': k in LEGACY_STRUCTURES} for k, s in REGISTRY.items()}


def get(structure_id):
    """The structure of that id (KeyError when there is none: the config validates ids before)."""
    return REGISTRY[structure_id]
