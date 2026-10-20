"""The Agent type, the same in every structure: a backlog of AI agents, documented and followed like tasks (TSK-036).

An agent is not planned (no Today, Week or Board): it moves through its own statuses, from an idea to an agent that
runs, and is retired when it no longer does. Its folder is optional: a vault without one still matches its structure,
and the folder is made when the first agent is written.
"""

STATUSES = ('Idea', 'Design', 'Build', 'Test', 'Live', 'Retired')
CLOSED = frozenset({'Retired'})
PLATFORMS = ('Claude Code subagent', 'Agent SDK', 'Managed Agent', 'n8n', 'Other')
TRIGGERS = ('manual', 'scheduled', 'event')

# Its own fields, shown in its properties (TypeDef.props): where it runs, on what model, what starts it, what it uses.
PROPS = (
    {'key': 'platform', 'label': 'Platform', 'kind': 'select', 'options': [['', '—'], *([v, v] for v in PLATFORMS)]},
    {'key': 'model', 'label': 'Model', 'kind': 'text', 'placeholder': 'claude-sonnet-5-5'},
    {'key': 'trigger', 'label': 'Trigger', 'kind': 'select', 'options': [['', '—'], *([v, v] for v in TRIGGERS)]},
    {'key': 'tools', 'label': 'Tools & MCP', 'kind': 'text', 'placeholder': 'Bash, GitHub MCP, …'},
)
PROP_KEYS = tuple(p['key'] for p in PROPS)

# A new agent's body when none is given: the sections that document one.
BODY = '\n\n'.join(f'## {h}' for h in ('Purpose', 'Inputs', 'Outputs', 'Tools', 'Prompt', 'Evaluation', 'Runbook')) + '\n'

LABEL, PLURAL, ICON, ROUTE, TOKENS = 'Agent', 'Agents', 'bot', 'agents', ('/agent', '/agt')
