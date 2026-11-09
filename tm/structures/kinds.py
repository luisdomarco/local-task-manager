"""Project kinds: what a project is (a product, an agentic system…), chosen once when it is made, and the item types
of its own folders that its kind gives it. Data only, like the rest of tm/structures: the Store, the codec, the vault
check and the rules all read it from here, so a kind is declared in one place.

A project's note says its kind (`project_kind`) and, of its kind's optional types, the ones it has (`enabled_types`,
which also lists the types every project has: `LISTED`). The types it has decide its folders, which the vault check
requires and the Store makes.
"""

from dataclasses import dataclass, field

# Every type a project's own folders may hold, in the order they are made.
PROJECT_FOLDER_TYPES = ('initiative', 'story', 'spec', 'support', 'plan', 'analysis', 'error', 'learning', 'hotfix', 'prd')
# The types a project's enabled_types always names, whatever its kind (they are never turned off).
LISTED = ('initiative', 'story', 'support', 'spec')


@dataclass(frozen=True)
class Kind:
    id: str                    # what `project_kind` says: 'product'
    label: str                 # what the create form offers
    types: tuple               # the types of its own folders a project of it may have, in PROJECT_FOLDER_TYPES order
    optional: tuple = ()       # of those, the ones it has only when its enabled_types names them
    default_on: tuple = ()     # of the optional ones, those a new project has unless it says otherwise
    # The fields of a type its projects do not have, {type: keys}: the project's settings a kind has no use for (a
    # simple project's execution or support due days), an initiative's readiness where nothing is delivered, a link to
    # a type the kind lacks. Neither shown nor written, and the rules that read them do not apply.
    hidden: dict = field(default_factory=dict)

    def project_types(self, enabled=None):
        """The types a project of this kind has: every type of it that is not optional, and the optional ones its
        `enabled_types` names (None: a new project's, `default_on`)."""
        on = self.default_on if enabled is None else tuple(enabled)
        return [t for t in self.types if t not in self.optional or t in on]

    def default_enabled(self):
        """A new project's enabled_types: the listed types it has, then its optional ones on by default."""
        return self.enabled(self.default_on)

    def enabled(self, given):
        """A project's enabled_types as it is written, from those `given` (a list of type names): the listed types it
        has, always, then the optional ones given, in ENABLEABLE order. A listed type it lacks is left out (a form may
        send them all, ticked as always on), and so is a type this kind does not have: a note written before its kind
        lost it (a system project's hotfix) saves as it is, without it (the vault check warns of the files left). ValueError
        only for a name that is not a type an enabled_types may name."""
        given = list(given or ())
        unknown = [t for t in given if t not in ENABLEABLE]
        if unknown:
            raise ValueError(f'enabled_types: unknown type {unknown[0]} (one of {list(ENABLEABLE)})')
        return [t for t in ENABLEABLE if t in self.types and (t in LISTED or (t in self.optional and t in given))]

    def hides(self, type_name, key):
        return key in self.hidden.get(type_name, ())

    def public(self, types=None):
        """What GET /api/structure says of it; `types`: the structure's, so a type the vault turned off is left out."""
        keep = (lambda t: t in types) if types is not None else (lambda t: True)
        return {'id': self.id, 'label': self.label, 'types': [t for t in self.types if keep(t)],
                'optional': [t for t in self.optional if keep(t)], 'default_on': [t for t in self.default_on if keep(t)],
                'hidden': {t: list(keys) for t, keys in self.hidden.items() if keep(t)}}


# A project's settings that only a project with delivery work has (a branch per story, support tickets with due dates).
DELIVERY_SETTINGS = ('execution_mode', 'support_due_days', 'repo', 'managed_by')
# An initiative's readiness for delivery (its gate to ToDo) and its links to the documents that plan it.
READINESS = ('size', 'regime', 'premise', 'premise_verified')

# The kinds, in the order the create form offers them; the first is a new project's when it does not say.
# - product: an application with end users — every type; hotfixes and PRDs are on unless the project turns them off.
# - system (an agentic system): the same without hotfixes (an urgent fix is a C1 support ticket, fixed in place) and
#   PRDs (its aspiration is the vision).
# - simple: initiatives and their tasks, notes and meetings, nothing delivered — analyses when the project turns them on.
_SYSTEM_TYPES = tuple(t for t in PROJECT_FOLDER_TYPES if t not in ('hotfix', 'prd'))
KINDS = {k.id: k for k in (
    Kind('product', 'Product (with hotfixes and PRDs)', PROJECT_FOLDER_TYPES, optional=('hotfix', 'prd'), default_on=('hotfix', 'prd')),
    Kind('system', 'Agentic system', _SYSTEM_TYPES, hidden={'initiative': ('prd',), 'support': ('escalated_to',)}),
    Kind('simple', 'Simple (initiatives and tasks)', ('initiative', 'analysis'), optional=('analysis',),
         hidden={'project': DELIVERY_SETTINGS, 'initiative': (*READINESS, 'origin', 'prd', 'plan')}),
)}
DEFAULT_KIND = next(iter(KINDS))
# Every type an enabled_types may name: the listed ones, then every kind's optional ones.
ENABLEABLE = tuple(dict.fromkeys((*LISTED, *(t for k in KINDS.values() for t in k.optional))))


def kind_of(value):
    """The Kind a project's `project_kind` names; a note that names none (or one no longer known) is read as the
    default kind's, as the Store has always made a project that did not say."""
    return KINDS.get(str(value or '').strip()) or KINDS[DEFAULT_KIND]
