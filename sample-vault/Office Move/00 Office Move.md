---
fileClass: Ticket Project
project_key: MOVE               # 2-4 capital letters, unique in the vault: ACME, OPS, WEB…
project_kind: simple                   # product | system | simple — fixed once made (tm/structures/kinds.py)
living_specs: "Specs/"                 # the project's specs in the vault (Ticket Spec); a system may add "contracts + docs/decisions-in-force"
enabled_types: ["initiative"]          # system projects usually drop hotfix and prd
areas: []                              # closed list for the `area` field of this project's tickets
area: ""                               # the area the project itself belongs to
objective: ""                          # the observable end state that allows this project to close
premise_max_age_days: 14               # gate Backlog→ToDo fails if premise_verified is older
related_initiatives: []                # the personal Initiative note(s): "[[⭐ Project Acme Web]]"
url: ""                                # repo URL
tags: []
creation_date: 2026-11-08
updated_date: 2026-11-08
---

# Office Move

Moving the team to the new office: nothing to deliver, just initiatives and their tasks.

> [!owner] What this project is
> One paragraph: what is being built, for whom, and what "production" means here.

## Board

![[Office Move.base#Open]]

## Execution order

The order in which approved work runs. Human decision, not computed.

1. 

## Living specs

What the system does today: one spec per capability in this project's `Specs/` folder, each active only with valid
requirements (`### Requirement:` with SHALL / MUST, a `#### Scenario:` with WHEN and THEN). A story's Spec delta is
merged into them when it ships.

- Path: `Specs/` (`living_specs`)

## Rules for agents working on this project

Project-specific rules the shared templates don't carry: branch naming, worktree location, forbidden
commands, language of the code, who may push. Plans link here from their §0.

- 

## Related

- 
