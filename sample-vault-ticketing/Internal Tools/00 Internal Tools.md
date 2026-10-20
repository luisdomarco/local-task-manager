---
fileClass: Ticket Project
project_key: OPS                # 2-4 capital letters, unique in the vault: ACME, OPS, WEB…
project_kind: system                   # system | product   (see 08-tipos-de-proyecto)
repo: "~/github/…"                     # where the code lives
managed_by: "~/github/…/.claude"       # the system whose agents execute this project's tickets
living_specs: "openspec/specs"         # product: openspec/specs · system: "contracts + docs/decisions-in-force"
enabled_types: ["initiative", "support"] # system projects usually drop hotfix and prd
areas: []                              # closed list for the `area` field of this project's tickets
execution_mode: parallel               # serial (one InProgress at a time, all types) | parallel
support_due_days: {C1: 0, C2: 7, C3: 30}
premise_max_age_days: 14               # gate Backlog→ToDo fails if premise_verified is older
related_initiatives: []                # the personal Initiative note(s): "[[⭐ Project Acme Web]]"
url: ""                                # repo URL
tags: []
creation_date: 2026-10-20
updated_date: 2026-10-20
---

# Internal Tools

The scripts and dashboards the team runs on.

> [!owner] What this project is
> One paragraph: what is being built, for whom, and what "production" means here.

## Board

![[Internal Tools.base#Open]]

## Execution order

The order in which approved work runs. Human decision, not computed.

1. 

## Living specs

Where the current truth lives in the repo and how to validate it:

- Path: `{{living_specs}}`
- Validate: `openspec validate --specs --strict` *(product)* · the gate *(system)*

## Rules for agents working on this project

Project-specific rules the shared templates don't carry: branch naming, worktree location, forbidden
commands, language of the code, who may push. Plans link here from their §0.

- 

## Related

- 
