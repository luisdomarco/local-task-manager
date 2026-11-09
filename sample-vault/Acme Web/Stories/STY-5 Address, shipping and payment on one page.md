---
fileClass: Ticket Story
id: 5                             # its number, drawn STY-<n>
name: "address-shipping-and-payment-on-one-page"
project: "[[00 Acme Web]]"
initiative: "[[INI-1 Checkout redesign]]" # "[[INI-<n> …]]" it delivers a part of
status_ticket: "4. InProgress"
status_log: [{"date": "2026-11-09", "from": "1. Backlog", "to": "2. ToDo", "by": "owner"}, {"date": "2026-11-09", "from": "2. ToDo", "to": "4. InProgress", "by": "owner"}] # [{date, from, to, by}]
priority: P1                           # P0 · P1 · P2 · P3
size: M                                # S · M · L — an L is two stories
spec_impact: "checkout: one page instead of four steps" # the specs it changes ("[[SPEC-<n> …]]"), or "none: <why>"
origin: ""                             # "[[SUP-<n> …]]" or "[[TSK-<n> …]]" it came from
plan: ""                               # "[[PLN-<n> …]]" when it needs one
depends_on: []
on_hold: {}                            # {by, why, resume_when}
discard_reason: ""
executor: claude                       # claude · codex · owner
branch: feat/one-page-checkout         # feat/<id>-<slug> · fix/<id>-<slug>
baseline: ""                           # the sha it started from
changelog_ref: ""                      # the version it shipped in
url: ""                                # its pull request
tags: ["checkout"]
creation_date: 2026-11-09
updated_date: 2026-11-09
goal: "[[GOL-27 Launch the new checkout]]"
goal_order: 2
---

# STY-5 — Address, shipping and payment on one page

## Story

As a shopper, I want to pay on one page, so that I do not give up halfway.

## Acceptance criteria

#### Scenario: Paying in one go
- **WHEN** the cart goes to checkout
- **THEN** address, shipping and payment are on the same page

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

- 2026-11-09 — 

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
