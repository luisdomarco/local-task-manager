---
fileClass: Ticket Story
id: "{{id}}"                           # KEY-STY-NNN
name: "{{slug}}"
project: "[[00 {{project}}]]"
initiative: ""                         # "[[KEY-INI-NNN …]]" it delivers a part of
status_ticket: "1. Backlog"
status_log: []                         # [{date, from, to, by}]
priority: P2                           # P0 · P1 · P2 · P3
size: S                                # S · M · L — an L is two stories
spec_impact: ""                        # the specs it changes ("[[KEY-SPEC-NNN …]]"), or "none: <why>"
origin: ""                             # "[[KEY-SUP-NNN …]]" or "[[TSK-NNN …]]" it came from
plan: ""                               # "[[{{id}} Plan]]" when it needs one
depends_on: []
on_hold: {}                            # {by, why, resume_when}
discard_reason: ""
executor: ""                           # claude · codex · owner
branch: ""                             # feat/<id>-<slug> · fix/<id>-<slug>
baseline: ""                           # the sha it started from
changelog_ref: ""                      # the version it shipped in
url: ""                                # its pull request
tags: []
creation_date: {{date}}
updated_date: {{date}}
---

# {{id}} — {{title}}

> [!owner] Frozen at 2. ToDo
> The agent may draft these sections; the owner approves them. After approval nobody edits them.

## Story

As <who>, I want <what>, so that <why>.

## Acceptance criteria

#### Scenario: <name>
- **WHEN** …
- **THEN** …

## Spec delta

What changes in the specs, grouped by spec, or exactly one line: `No behavior change: <why>`. When the story
ships, each delta is merged into its spec (a spec it names that does not exist yet is created).

### [[KEY-SPEC-NNN <Capability>]]

#### ADDED Requirements

##### Requirement: <name>
The system SHALL …

###### Scenario: <name>
- **WHEN** …
- **THEN** …

#### MODIFIED Requirements

#### REMOVED Requirements

(Reason and migration for each.)

---

> [!agent] Agent-owned
> Appended to, never rewritten.

## Tasks

- [ ] 1.1 …

## Execution

Dated log from the first commit: what each commit did (sha), every departure from the tasks and why.

- {{date}} — 

## Verification

- [ ] Every acceptance scenario has a test that exercises it
- [ ] Tried to break it on purpose; what was tried
- [ ] Docs the user reads are up to date (README, user guide)

**Verdict:** PASS · CONCERNS · FAIL — by … on … @ `sha`

## Result

The verified final state, with sha and the command output that proves it.

### Integration

Source branch, target branch, merge sha, release (`changelog_ref`).

## Related

- 
