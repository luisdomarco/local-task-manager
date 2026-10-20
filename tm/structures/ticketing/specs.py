"""A spec's text, checked: what the system does today, as requirements with scenarios (the format of OpenSpec, which
the vault keeps instead of a repo's openspec/specs/).

    ## Requirements
    ### Requirement: <name>
    The system SHALL …
    #### Scenario: <name>
    - **WHEN** …
    - **THEN** …

`problems(body)` lists what keeps a spec from being active: no `## Requirements`, none in it, a requirement with no
SHALL / MUST or no scenario, a scenario without a written WHEN or THEN (a template's `…` is not written). Pure.
"""

import re

REQUIREMENT_RE = re.compile(r'^###\s+Requirement:\s*(.*)$')
SCENARIO_RE = re.compile(r'^####\s+Scenario:\s*(.*)$')
CLAUSE_RE = re.compile(r'^\s*[-*]\s*\*\*(WHEN|THEN)\*\*\s*(.*)$')
NORMATIVE_RE = re.compile(r'\b(SHALL|MUST)\b')


def written(text):
    """Whether a placeholder was replaced: something besides dots, ellipses and <angle> blanks."""
    return bool(re.sub(r'<[^>]*>|…|\.', '', text or '').strip())


def section(lines, title):
    """The lines under `## <title>` (up to the next `## `), or None when there is no such heading."""
    at = next((i for i, l in enumerate(lines) if l.strip().lower() == f'## {title}'.lower()), None)
    if at is None:
        return None
    end = next((j for j in range(at + 1, len(lines)) if lines[j].startswith('## ')), len(lines))
    return lines[at + 1:end]


def problems(body):
    """→ the list of what is wrong with a spec's text, empty when it is a valid spec."""
    lines = section((body or '').split('\n'), 'Requirements')
    if lines is None:
        return ['no "## Requirements" section']
    out, req, scen = [], None, None

    def close_scenario():
        if scen is not None:
            for clause in ('WHEN', 'THEN'):
                if not scen['clauses'].get(clause):
                    out.append(f'scenario "{scen["name"]}" of "{req["name"]}" has no written {clause}')

    def close_requirement():
        close_scenario()
        if req is not None:
            if not req['normative']:
                out.append(f'requirement "{req["name"]}" says no SHALL or MUST')
            if not req['scenarios']:
                out.append(f'requirement "{req["name"]}" has no scenario')

    for line in lines:
        m = REQUIREMENT_RE.match(line)
        if m:
            close_requirement()
            req, scen = {'name': m.group(1).strip() or '?', 'normative': False, 'scenarios': 0}, None
            if not written(req['name']):
                out.append('a requirement without a name')
            continue
        if req is None:
            continue
        m = SCENARIO_RE.match(line)
        if m:
            close_scenario()
            scen = {'name': m.group(1).strip() or '?', 'clauses': {}}
            req['scenarios'] += 1
            continue
        m = CLAUSE_RE.match(line)
        if m and scen is not None:
            scen['clauses'][m.group(1)] = scen['clauses'].get(m.group(1)) or written(m.group(2))
        elif scen is None and NORMATIVE_RE.search(line):
            req['normative'] = True
    close_requirement()
    if req is None and not out:
        out.append('no requirement under "## Requirements"')
    return out
