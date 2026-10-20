---
fileClass: Ticket Hotfix
id: "{{id}}"                           # KEY-HFX-NNN
aliases: []
name: "{{slug}}"
project: "[[00 {{project}}]]"
status_ticket: "2. ToDo"               # hotfixes are born in ToDo: there is no backlog for the urgent
status_log: []
severity: high                         # critical · high · medium
affected: ""                           # who/what is impacted in production, and since when
origin: ""                             # "[[KEY-SUP-NNN …]]" or "direct" for a C1 with no prior ticket
base_branch: main
branch: ""                             # hotfix/{{id}}-{{slug}}
rollback_plan: ""                      # REQUIRED before 2→4: one line here, detail in the body
observation_window: 24h                # time in 5. Review before it can close
spec_impact: []                        # living specs whose behavior changed, or ["none"]
postmortem: ""                         # "[[KEY-ERR-NNN …]]" — required to reach 6. Done
cherry_picked_to_develop: ""           # sha
owner_review: ""                       # "<date>; owner" — approval after the fact
changelog_ref: ""
url: ""
tags: []
creation_date: {{date}}
updated_date: {{date}}
---

# {{id}} — {{title}}

> [!agent] Urgent production fix. Approval comes **after**: the owner reviews it at closing.
> Without a rollback plan, production is not touched.

## Problem

What is broken in production, observable, with the first evidence.

## Impact

Who is affected, how much (users, money, data), and since when.

## Root cause

Known or suspected. If suspected, say so.

## Fix

The minimal change. What is deliberately **not** fixed here and goes to an initiative instead.

## Test plan

The test that reproduces the failure (red before, green after) and how production is checked after
deploy.

## Rollback plan

The exact steps to undo it (revert sha, redeploy, data restore if any), and who can run them.

## Deployment

Dated log: branch, merge to `main` (sha), deploy, observation, rollback if it happened, cherry-pick to
`develop` (sha).

- {{date}} — 

## Post-mortem

Link to the ERR record (`postmortem`). If behavior changed: the living spec update (sha) — this is the
only path that skips the approval gate, so it must close the loop here.

## Related

- 
