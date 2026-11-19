---
fileClass: Ticket Project
project_key: MOVE               # 2-4 capital letters, unique in the vault: ACME, OPS, WEB…
project_kind: simple                   # product | system | simple — fixed once made (tm/structures/kinds.py)
area: ""                               # the area the project itself belongs to
objective: ""                          # the observable end state that allows this project to close
premise_max_age_days: 14               # gate Backlog→ToDo fails if premise_verified is older
url: ""                                # repo URL
tags: []
creation_date: 2026-11-09
updated_date: 2026-11-09
status_project: ToDo
status_log: [{"date": "2026-11-09", "from": "", "to": "ToDo", "by": "owner"}]
priority: P3
start: 2026-11-16
due: 2027-01-08
---

# Office Move

Moving the team to the new office: nothing to deliver, just initiatives and their tasks.

> [!owner] What this project is
> One paragraph: what is being built, for whom, and what "production" means here.

## Execution order

The order in which approved work runs. Human decision, not computed.

1. 

## Living specs

What the system does today: one spec per capability in this project's `Specs/` folder, each active only with valid
requirements (`### Requirement:` with SHALL / MUST, a `#### Scenario:` with WHEN and THEN). A story's Spec delta is
merged into them when it ships.

- Path: `Specs/`

## Rules for agents working on this project

Project-specific rules the shared templates don't carry: branch naming, worktree location, forbidden
commands, language of the code, who may push. Plans link here from their §0.

- 

## Related

- 
