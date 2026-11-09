---
fileClass: Ticket Story
id: 35                             # its number, drawn STY-<n>
name: "pay-with-google-pay-on-android"
project: "[[00 Acme Web]]"
initiative: "[[INI-33 Apple Pay and Google Pay]]" # "[[INI-<n> …]]" it delivers a part of
status_ticket: "1. Backlog"
status_log: []                         # [{date, from, to, by}]
priority: P2                           # P0 · P1 · P2 · P3
size: M                                # S · M · L — an L is two stories
spec_impact: "none: a new screen, no requirement changes" # the specs it changes ("[[SPEC-<n> …]]"), or "none: <why>"
origin: ""                             # "[[SUP-<n> …]]" or "[[TSK-<n> …]]" it came from
plan: ""                               # "[[PLN-<n> …]]" when it needs one
depends_on: []
on_hold: {}                            # {by, why, resume_when}
discard_reason: ""
executor: ""                           # claude · codex · owner
branch: ""                             # feat/<id>-<slug> · fix/<id>-<slug>
baseline: ""                           # the sha it started from
changelog_ref: ""                      # the version it shipped in
url: ""                                # its pull request
tags: ["payments"]
creation_date: 2026-11-09
updated_date: 2026-11-09
---

# STY-35 — Pay with Google Pay on Android

## Story

As a shopper, I want to pay with Google Pay on Android.

## Acceptance criteria

#### Scenario: Pay with Google Pay on Android
- **WHEN** a shopper on Chrome for Android reaches payment
- **THEN** Google Pay is the first option

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
