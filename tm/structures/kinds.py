"""Initiative kinds: what an initiative is (a product, an agentic system, a simple piece of work), and what that gives
it and its project. Data only, like the rest of tm/structures: the Store, the codec, the vault check and the rules all
read it from here, so a kind is declared in one place.

An initiative's note says its kind (`initiative_kind`). One that says none (from before kinds moved to initiatives)
reads as its project's `project_kind`, which every project used to have, and one whose project says none either as
the kind a project from before kinds had. No file is rewritten for it.

A delivering kind (product, agentic system) gives the initiative its stories and its PRD, its readiness (size, regime,
premise) and the code it lives in; and it gives its project support tickets and hotfixes, while the project has one
such initiative of any status (`project_delivers`). A project's folders follow from nothing: each is made with its
first file.
"""

from dataclasses import dataclass, field

# Every type a project's own folders may hold, in the order they are listed.
PROJECT_FOLDER_TYPES = ('initiative', 'story', 'spec', 'support', 'plan', 'analysis', 'error', 'learning', 'hotfix', 'prd')
# The field an initiative says its kind in, and the one a project said it in before (read as its initiatives' kind).
KIND_KEY = 'initiative_kind'
LEGACY_KIND_KEY = 'project_kind'
# The types that hang from a delivering initiative only (a story, a PRD, a plan of it).
INITIATIVE_DELIVERY_TYPES = ('story', 'prd', 'plan')
# The types of a project's folders that only a project with a delivering initiative has.
PROJECT_DELIVERY_TYPES = ('support', 'hotfix')
# A project's settings that only a project with delivery work has (a branch per story, support tickets with due dates).
DELIVERY_SETTINGS = ('execution_mode', 'support_due_days', 'repo', 'managed_by')
# An initiative's readiness for delivery (its gate to ToDo).
READINESS = ('size', 'regime', 'premise', 'premise_verified')


@dataclass(frozen=True)
class Kind:
    id: str                    # what `initiative_kind` says: 'product'
    label: str                 # what the create form offers
    delivers: bool = False     # stories, a PRD, readiness and its code; support tickets and hotfixes in its project
    # The fields of a type an initiative of this kind does not have, {type: keys}: neither shown nor asked, and the
    # rules that read them do not apply to it.
    hidden: dict = field(default_factory=dict)

    def hides(self, type_name, key):
        return key in self.hidden.get(type_name, ())

    def public(self):
        """What GET /api/structure says of it."""
        return {'id': self.id, 'label': self.label, 'delivers': self.delivers, 'widens': list(WIDENS.get(self.id, ())),
                'hidden': {t: list(keys) for t, keys in self.hidden.items()}}


# The kinds, in the order the create form offers them.
# - product: an application with end users. system: an agentic system. Both deliver, alike: the label says what it is.
# - simple: an initiative and its tasks, notes and meetings, nothing delivered.
KINDS = {k.id: k for k in (
    Kind('product', 'Product', delivers=True),
    Kind('system', 'Agentic system', delivers=True),
    Kind('simple', 'Simple', hidden={'initiative': (*READINESS, 'origin', 'prd', 'plan', 'repo', 'managed_by')}),
)}
# A new initiative's kind when it does not say: it is widened when it needs stories.
NEW_KIND = 'simple'
# The kind of an initiative that says none in a project that says none either: a project from before kinds was a
# product, as the Store made it.
LEGACY_DEFAULT = 'product'
# What a kind may become once made: only wider, never back to simple (its stories, PRD and readiness would be left).
WIDENS = {'simple': ('product', 'system'), 'product': ('system',), 'system': ('product',)}


def kind_of(value):
    """The Kind a kind field names; one that names none (or one no longer known) is read as LEGACY_DEFAULT."""
    return KINDS.get(str(value or '').strip()) or KINDS[LEGACY_DEFAULT]


def initiative_kind_of(fields, project_fields=None):
    """An initiative's Kind: its own `initiative_kind`, else its project's `project_kind` (from before kinds moved to
    initiatives), else LEGACY_DEFAULT."""
    own = str((fields or {}).get(KIND_KEY) or '').strip()
    if own in KINDS:
        return KINDS[own]
    return kind_of((project_fields or {}).get(LEGACY_KIND_KEY))


def widens(old, new):
    """Whether an initiative of kind `old` may become `new` (the same kind always may)."""
    return old == new or new in WIDENS.get(old, ())


def project_delivers(project_fields, initiatives):
    """Whether a project has delivery work: one of its initiatives, of any status, is of a delivering kind; or its note
    says a delivering `project_kind` (a project from before kinds moved to initiatives, even with none yet).
    `initiatives`: the fields of the project's initiatives."""
    legacy = str((project_fields or {}).get(LEGACY_KIND_KEY) or '').strip()
    if legacy in KINDS and KINDS[legacy].delivers:
        return True
    return any(initiative_kind_of(f, project_fields).delivers for f in initiatives)


def project_has(type_name, project_fields, initiatives):
    """Whether a project may get a new item of a type of its own folders (made, or moved in): support tickets and
    hotfixes while it delivers; every other type always (a story's, a PRD's or a plan's own initiative is checked apart:
    `initiative_has`). The ones it holds when it stops delivering stay where they are, listed and editable."""
    if type_name in PROJECT_DELIVERY_TYPES:
        return project_delivers(project_fields, initiatives)
    return True


def initiative_has(type_name, initiative_fields, project_fields=None):
    """Whether an initiative may have an item of a type hang from it: a story, a PRD, a plan only if it delivers."""
    return type_name not in INITIATIVE_DELIVERY_TYPES or initiative_kind_of(initiative_fields, project_fields).delivers
