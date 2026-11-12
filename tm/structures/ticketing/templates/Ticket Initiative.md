---
fileClass: Ticket Initiative
id: "{{id}}"                           # its number, drawn INI-<n>, assigned by the capability
aliases: []                            # its ids from before short ids: [ACME-INI-001]
name: "{{slug}}"
project: "[[00 {{project}}]]"
status_ticket: "1. Backlog"            # only via tickets_move
status_log: []                         # [{date, from, to, by}] — written by the capability
priority: P2                           # P0 · P1 · P2 · P3
size: M                                # S · M · L
regime: standard                       # standard (reviewer) · critical (judge with sealed oracle); goes up, never down
area: ""                               # one of the project's `areas`
objective: ""                          # the observable end state that allows this initiative to close
premise: unverified                    # unverified · verified · reframed · refuted
premise_verified: ""                   # "<date> @ <sha>; what was measured"
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
tags: []
creation_date: {{date}}
updated_date: {{date}}
---
