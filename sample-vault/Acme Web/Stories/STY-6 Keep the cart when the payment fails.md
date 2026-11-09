---
fileClass: Ticket Story
id: 6                             # its number, drawn STY-<n>
name: "keep-the-cart-when-the-payment-fails"
project: "[[00 Acme Web]]"
initiative: "[[INI-1 Checkout redesign]]" # "[[INI-<n> …]]" it delivers a part of
status_ticket: "1. Backlog"
status_log: []                         # [{date, from, to, by}]
priority: P2                           # P0 · P1 · P2 · P3
size: S                                # S · M · L — an L is two stories
spec_impact: ""                        # the specs it changes ("[[SPEC-<n> …]]"), or "none: <why>"
origin: ""                             # "[[SUP-<n> …]]" or "[[TSK-<n> …]]" it came from
plan: ""                               # "[[PLN-<n> …]]" when it needs one
depends_on: []
on_hold: {}                            # {by, why, resume_when}
discard_reason: ""
executor: ""                           # claude · codex · owner
branch: ""                             # feat/<id>-<slug> · fix/<id>-<slug>
baseline: ""                           # the sha it started from
changelog_ref: ""                      # the version it shipped in
goal: "[[GOL-27 Launch the new checkout]]"
goal_order: 4
url: ""                                # its pull request
tags: ["checkout"]
creation_date: 2026-11-08
updated_date: 2026-11-08
---

# STY-6 — Keep the cart when the payment fails

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

### [[SPEC-<n> <Capability>]]

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

- 2026-11-08 — 

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
