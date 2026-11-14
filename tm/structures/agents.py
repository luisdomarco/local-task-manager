"""The Architecture type (the `agent` type: its file, folder, code AGT and ids are kept) and, in Projects, its Entities.

An architecture is how an agentic system is built (TSK-036, P8): which design scheme decided it, who holds the plan
(its harness), how many agents come out and what separates them (its architecture, AR-1 … AR-5, or the AP-1
anti-pattern), and the decision behind it. Its entities are the pieces it is made of (an agent, a skill, a tool, a
gate…), each of one type, at one level (N0 harness … N5 quality). The vocabulary is the owner's knowledge base
(Docs/Knowledge base/Artificial Intelligence/AI Agents): *Arquitecturas de referencia*, *Esquema A / B*, *Decidir uno
o N agentes*, *Entidades por tipo de harness*, *00 Index Entities*.

Neither is planned (no Today, Week or Board): both move through their own statuses, from an idea to something that
runs, and are retired when they no longer do. Both are versioned (tm/versions.py): `version` is cut, never typed.
The folder is optional: a vault without one still matches its structure; it is made with the first file.
"""

STATUSES = ('Idea', 'Design', 'Build', 'Test', 'Live', 'Retired')
CLOSED = frozenset({'Retired'})
PLATFORMS = ('Claude Code subagent', 'Agent SDK', 'Managed Agent', 'n8n', 'Other')
TRIGGERS = ('manual', 'scheduled', 'event')

# ── the architecture ─────────────────────────────────────────────────────────
SCHEMES = (('A', 'A · Phases and entities'), ('B', 'B · Context and objectives'))
HARNESSES = (('assistant', 'Assistant'), ('entity_agent', 'Entity agent'), ('governed_process', 'Governed process'),
             ('unattended', 'Unattended orchestration'))
ARCHITECTURES = (('AR-1', 'AR-1 · Single loop with skills'), ('AR-2', 'AR-2 · Owner and specialists'),
                 ('AR-3', 'AR-3 · Agents per entity'), ('AR-4', 'AR-4 · Governed process'),
                 ('AR-5', 'AR-5 · Unattended orchestration'), ('AP-1', 'AP-1 · Central LLM supervisor (anti-pattern)'))
ANTI_PATTERNS = ('AP-1',)
# What each harness usually comes out as (Entidades por tipo de harness): the first is the default, the others need
# the evidence the KB names. A mismatch is a hint on the page, never a rule.
HARNESS_ARCHITECTURES = {'assistant': ('AR-1', 'AR-2'), 'entity_agent': ('AR-1', 'AR-3'), 'governed_process': ('AR-4',),
                         'unattended': ('AR-5',)}
# Scheme B: what the cases running on a definition do when a new version is cut.
ON_NEW_VERSION = (('finish', 'Finish on the old version'), ('move', 'Move to the new version'), ('restart', 'Restart'))

_none = [['', '—']]
# Its own fields (TypeDef.props): how it was designed, then where it runs, on what model, what starts it, what it uses.
PROPS = (
    {'key': 'version', 'label': 'Version', 'kind': 'readonly'},
    {'key': 'scheme', 'label': 'Scheme', 'kind': 'select', 'options': [*_none, *map(list, SCHEMES)]},
    {'key': 'harness', 'label': 'Harness', 'kind': 'select', 'options': [*_none, *map(list, HARNESSES)]},
    {'key': 'architecture', 'label': 'Architecture', 'kind': 'select', 'options': [*_none, *map(list, ARCHITECTURES)]},
    {'key': 'decision', 'label': 'Decision', 'kind': 'text', 'placeholder': 'AR-1: no measured evidence (2026-11-14)'},
    {'key': 'on_new_version', 'label': 'Running cases on a new version', 'kind': 'select',
     'options': [*_none, *map(list, ON_NEW_VERSION)], 'when': {'scheme': ['B']}},
    {'key': 'platform', 'label': 'Platform', 'kind': 'select', 'options': [*_none, *([v, v] for v in PLATFORMS)]},
    {'key': 'model', 'label': 'Model', 'kind': 'text', 'placeholder': 'claude-sonnet-5-5'},
    {'key': 'trigger', 'label': 'Trigger', 'kind': 'select', 'options': [*_none, *([v, v] for v in TRIGGERS)]},
    {'key': 'tools', 'label': 'Tools & MCP', 'kind': 'text', 'placeholder': 'Bash, GitHub MCP, …'},
)
PROP_KEYS = tuple(p['key'] for p in PROPS)

# A new architecture's body when none is given (the folder-per-type structure; Projects has default_texts/agent.md).
BODY = '\n\n'.join(f'## {h}' for h in ('Objective', 'Context', 'Harness and architecture', 'Contracts', 'Evals', 'Runbook')) + '\n'

LABEL, PLURAL, ICON, ROUTE, TOKENS = 'Architecture', 'Architectures', 'bot', 'agents', ('/agent', '/agt', '/arch')
NAV_LABEL = 'AI Agents'  # the sidebar's link to them

# ── the entities ─────────────────────────────────────────────────────────────
# Levels (Vocabulario de entidades): each depends only on those below.
LEVELS = (('N0', 'Harness'), ('N1', 'Context'), ('N2', 'Capabilities'), ('N3', 'Actors'), ('N4', 'Procedures'),
          ('N5', 'Quality'))
# Every entity type: (id, label, level, canonical, file prefix). The 9 canonical ones are AiAgentArchitect's; the 8
# proposed ones are not canon yet (no prefix, no template, no generator emits them).
ENTITY_TYPES = (
    ('workflow', 'Workflow', 'N4', True, 'wor-'),
    ('agent', 'Agent', 'N3', True, 'age-'),
    ('skill', 'Skill', 'N2', True, 'ski-'),
    ('command', 'Command', 'N4', True, 'com-'),
    ('rule', 'Rule', 'N1', True, 'rul-'),
    ('knowledge-base', 'Knowledge base', 'N1', True, 'kno-'),
    ('resource', 'Resource', 'N2', True, 'res-'),
    ('script', 'Script', 'N2', True, 'scp-'),
    ('hook', 'Hook', 'N0', True, 'hok-'),
    ('tool', 'Tool', 'N2', False, ''),
    ('gate', 'Gate', 'N5', False, ''),
    ('eval', 'Eval', 'N5', False, ''),
    ('memory', 'Memory', 'N1', False, ''),
    ('subagent', 'Subagent', 'N3', False, ''),
    ('handoff', 'Handoff', 'N3', False, ''),
    ('event', 'Event', 'N1', False, ''),
    ('objective', 'Objective', 'N4', False, ''),
)
ENTITY = {t[0]: dict(zip(('id', 'label', 'level', 'canon', 'prefix'), t)) for t in ENTITY_TYPES}
# An agent's prefix says its role: a specialist or a supervisor.
AGENT_ROLES = (('specialist', 'Specialist'), ('supervisor', 'Supervisor'))
AGENT_PREFIX = {'specialist': 'age-spe-', 'supervisor': 'age-sup-'}
RULE_ACTIVATIONS = ('always_on', 'manual', 'model_decision', 'glob')
STEERING = (('objective', 'Objective'), ('playbook', 'Playbook'), ('steps', 'Steps'))
AUTONOMY = (('shadow', 'Shadow'), ('copilot', 'Copilot'), ('supervised', 'Supervised'), ('autonomous', 'Autonomous'))

ENTITY_PROPS = (
    {'key': 'version', 'label': 'Version', 'kind': 'readonly'},
    {'key': 'entity_type', 'label': 'Type', 'kind': 'select', 'tab': 'main',
     # the canonical ones first, then the proposed ones, named so
     'options': [*_none, *([t[0], t[1] if t[3] else f'{t[1]} · proposed'] for t in ENTITY_TYPES)]},
    {'key': 'agent_role', 'label': 'Role', 'kind': 'select', 'options': [*_none, *map(list, AGENT_ROLES)],
     'when': {'entity_type': ['agent']}},
    {'key': 'activation', 'label': 'Activation', 'kind': 'select', 'options': [*_none, *([v, v] for v in RULE_ACTIVATIONS)],
     'when': {'entity_type': ['rule']}},
    {'key': 'path', 'label': 'Path', 'kind': 'text', 'placeholder': '.claude/skills/<name>/SKILL.md'},
    # Scheme B's agent: who holds the plan, and how far it may act alone (its long fields are its text's sections).
    {'key': 'steering', 'label': 'Steering', 'kind': 'select', 'options': [*_none, *map(list, STEERING)],
     'when': {'entity_type': ['agent'], 'parent.scheme': ['B']}},
    {'key': 'autonomy', 'label': 'Autonomy', 'kind': 'select', 'options': [*_none, *map(list, AUTONOMY)],
     'when': {'entity_type': ['agent'], 'parent.scheme': ['B']}},
)
ENTITY_PROP_KEYS = tuple(p['key'] for p in ENTITY_PROPS)
ENTITY_LABEL, ENTITY_PLURAL, ENTITY_ICON, ENTITY_ROUTE, ENTITY_TOKENS = 'Entity', 'Entities', 'zap', 'entities', ('/ent', '/entity')


def level_of(entity_type):
    """An entity type's level ('N2'), or '' for none or an unknown one."""
    return (ENTITY.get(entity_type) or {}).get('level', '')


def prefix_of(entity_type, role=''):
    """The name prefix of an entity type's artifact (`ski-`); an agent's by its role (`age-spe-`); '' when it has none."""
    if entity_type == 'agent':
        return AGENT_PREFIX.get(role, 'age-')
    return (ENTITY.get(entity_type) or {}).get('prefix', '')


def public():
    """What the page needs to draw them: levels, each type's level / canon / prefix, the harness → architecture hint."""
    return {'levels': [list(x) for x in LEVELS], 'entity_types': [dict(v) for v in ENTITY.values()],
            'agent_prefix': dict(AGENT_PREFIX), 'harness_architectures': {k: list(v) for k, v in HARNESS_ARCHITECTURES.items()},
            'anti_patterns': list(ANTI_PATTERNS)}


def vocabulary():
    """The words an architecture and its entities are written in, for the vault's guide (tm/agentsmd.py): schemes,
    harnesses, architectures (and which are anti-patterns), the harness → architecture hint, levels, entity types."""
    return {'schemes': [list(x) for x in SCHEMES], 'harnesses': [list(x) for x in HARNESSES],
            'architectures': [list(x) for x in ARCHITECTURES], 'anti_patterns': list(ANTI_PATTERNS),
            'harness_architectures': {k: list(v) for k, v in HARNESS_ARCHITECTURES.items()},
            'levels': [list(x) for x in LEVELS], 'entity_types': [dict(v) for v in ENTITY.values()],
            'agent_prefix': dict(AGENT_PREFIX)}
