---
fileClass: Ticket Initiative
id: 33                             # its number, drawn INI-<n>, assigned by the capability
aliases: []                            # its ids from before short ids: [ACME-INI-001]
name: "apple-pay-and-google-pay"
project: "[[00 Acme Web]]"
status_ticket: "2. ToDo"               # only via tickets_move
status_log: [{"date": "2026-11-09", "from": "1. Backlog", "to": "2. ToDo", "by": "owner"}] # [{date, from, to, by}] — written by the capability
priority: P1                           # P0 · P1 · P2 · P3
size: M                                # S · M · L
regime: standard                       # standard (reviewer) · critical (judge with sealed oracle); goes up, never down
area: ""                               # one of the project's `areas`
objective: ""                          # the observable end state that allows this initiative to close
premise: verified                      # unverified · verified · reframed · refuted
premise_verified: "2026-11-06 @ 4f2a9c1; 38% of checkouts start on a phone; wallets convert 1.6x (provider benchmark)" # "<date> @ <sha>; what was measured"
prd: ""                                # "[[PRD-<n> …]]" (product, optional)
plan: ""                               # "[[PLN-<n> …]]" — the approach, when it needs one; each story may have its own
origin: ""                             # "[[SUP-<n> …]]" if promoted
depends_on: []
related_analyses: []
related_errors: []
related_learnings: []
on_hold: {}                            # {by, why, resume_when}
discard_reason: ""
url: ""
tags: ["payments", "checkout"]
creation_date: 2026-11-09
updated_date: 2026-11-09
goal: "[[GOL-27 Launch the new checkout]]"
goal_order: 5
due: 2026-12-09
sidebar: false
---

# INI-33 — Apple Pay and Google Pay

## Goal

Pay in two taps on a phone.

> [!owner] Frozen at 2. ToDo
> The agent may draft these sections; the owner approves them. After approval nobody edits them. A replan
> (4 → 2) unfreezes them and needs approval again.

## Objective

What is true when this closes, in observable terms. Why it matters now.

## Premise

The belief this initiative rests on, and how it was verified (`premise_verified`). If the premise is
refuted during diagnosis, stop: the initiative is reframed or discarded.

## Boundaries

### Always

- 

### Never

- 

### Out of scope

What looks related and is not touched here, and where it is recorded instead.

---

> [!agent] Agent-owned
> Appended to, never rewritten.

## Prior context

What was read before planning: earlier initiatives in the same area, learnings, analyses. Treat them as
claims to verify, not as facts.

## Critical diagnosis

Every claim (from the request or from prior context) is a hypothesis to challenge.

| Claim | Verdict | Source | Quantified impact |
| --- | --- | --- | --- |
| … | ✅ / 🟡 / 🔴 / ⚪ | file:line, command output, or live data | … |

Legend: ✅ confirmed · 🟡 partial · 🔴 refuted · ⚪ unverifiable (say why).

## Stories

What gets delivered, one story each, in order (`STY-<n>`, linked by their `initiative:`). The initiative
starts with the first story and closes with the last.

## Workflow follow-up

What can only happen after closing, as plain bullets. Each one becomes a ticket before 6. Done.

- 

## Related

- 
