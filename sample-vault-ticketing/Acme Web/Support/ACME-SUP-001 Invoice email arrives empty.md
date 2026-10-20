---
fileClass: Ticket Support
id: "ACME-SUP-001"                           # KEY-SUP-NNN
aliases: []
name: "invoice-email-arrives-empty"
project: "[[00 Acme Web]]"
status_ticket: "1. Backlog"
status_log: []
area: ""
level: C2                              # C1 · C2 · C3 — goes up, never down (only the owner lowers it)
level_base: C2                         # level at birth; it can rise at most one above it in total
level_reason: ""                       # which row of the level table applies, and the modifier if any
due_from: 2026-10-20
due: 2026-10-27                        # due_from + project's support_due_days[level]; recomputed if it rises
origin: customer                       # manual · user · judge · auditor · gate · ci · monitor · curation
signature: ""                          # <origin>|…  same signature → occurrences + 1, no new ticket
occurrences: 1
disposition: pending                   # pending · fix · discard · owner
resolution: ""                         # fixed_in_place · promoted · escalated · discarded
promoted_to: ""                        # "[[KEY-INI-NNN …]]"
escalated_to: ""                       # "[[KEY-HFX-NNN …]]"
discard_reason: ""
should_have_caught: ""                 # the check that should have caught it, or "none"
caused_by: []                          # confirmed at triage
caused_by_candidates: []               # written by whoever creates the ticket
depends_on: []
subject_sha: ""                        # sha of the product when it was observed
evidence: []
on_hold: {}
executor: ""
branch: ""
changelog_ref: ""
url: ""
tags: ["billing"]
creation_date: 2026-10-20
updated_date: 2026-10-20
---

# ACME-SUP-001 — Invoice email arrives empty

Two customers report an empty invoice email since the last release.

> [!agent] A support ticket is an intake, not a piece of work: it is investigated and ends **fixed in
> place**, **promoted** to an initiative, **escalated** to a hotfix, or **discarded**.

## Symptom

What was observed, in one paragraph. What should have happened instead.

## Evidence

One entry per occurrence, appended (never rewritten). Each with date, source and proof.

- 2026-10-20 — 

## Level

Why this level (`level_reason`), and the due date it implies.

## Cause

Root cause once known. Until then: the hypotheses and how each was tested.

## Resolution

How it ended. If fixed in place: what changed, sha, and why it didn't need promotion (no contract
change, no corpus, nothing deleted or moved, no plan needed).

### Derived items

| Action | Type | Priority | Item |
| --- | --- | --- | --- |
| … | initiative / hotfix | P… | [[…]] |

## Related

- 
