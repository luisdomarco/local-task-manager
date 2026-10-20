---
fileClass: Ticket Plan
item: "[[ACME-INI-001 Checkout redesign]]"           # the initiative (or promoted support ticket) this plan executes
project: "[[00 Acme Web]]"
written: 2026-10-20
base: "develop @ <sha>"                # the sha measured during diagnosis; what this builds on
branch: ""                             # e.g. feature/ACME-INI-001-plan
worktree: ""
executor: ""                           # claude · codex · owner — chosen by the owner at approval
verifier: ""                           # reviewer or judge; never the same hand as the executor
lane: normal                           # fast (S) · normal (M) · full (L); if it differs from size, say why
url: ""
tags: []
creation_date: 2026-10-20
updated_date: 2026-10-20
---

# ACME-INI-001 — Plan: Checkout redesign

1. Map the steps
2. Prototype
3. A/B test

> **This file is the complete brief.** Whoever executes it starts without the coordinator's context:
> everything needed is here or in a file cited by its path. The *why* is in the initiative ([[ACME-INI-001 Checkout redesign]]).

> [!owner] §0–§7 frozen at 2. ToDo, together with the initiative.

## 0. Before anything, for the executor

- **Your report goes in §8 of this file**, written through `tickets_annotate(section: "8")`. It is the only
  part of this file you write.
- **Where you work:** the worktree and branch above. Nothing outside them except §8.
- **Project rules:** [[00 Acme Web#Rules for agents working on this project]]. They win over anything
  generic in this template.
- **The living spec is part of the change.** If the initiative has a spec delta, the branch updates
  `openspec/specs/…` (or the system's contracts/decisions) in the same commits as the code.
- **If something doesn't match this plan, stop and report it in §8.** Don't improvise a path the plan
  doesn't describe: an unannounced deviation is worse than a step left undone.

## 1. Goal and why

The observable state reached, and why this is the layer of the cause, citing the diagnosis rows that
support it.

## 2. Measured starting point

What the diagnosis measured, with the command and its output (sha, rc, figures). The baseline to
compare against.

## 3. Steps

One per task of the initiative, in order.

### P1 — …

- **What:** …
- **Files:** `path:line` touched, and those read to understand.
- **How:** the concrete steps.
- **Check:** the command you can run and what it must return.
- **Done when:** …

## 4. Public acceptance criteria

The requirement in checkable sentences. For a `critical` regime, the judge's oracle is **not** here: the
requirement is public, the check is private.

### Edge-case matrix

| Input / situation | Expected behavior | Covered by |
| --- | --- | --- |
| … | … | test name / scenario |

## 5. Out of scope

What looks related and is not touched, and where it is recorded.

## 6. When to stop

The concrete situations in which the executor stops and reports instead of continuing (a premise that
fails on contact, a failure that isn't theirs, a decision that belongs to the owner).

## 7. How to launch

Chosen executor: `…`. The command with this initiative's values:

```bash
…
```

---

> [!agent] §8 is written by the executor, not by the coordinator.

## 8. Execution report

> Fill it in when finished **and also when stopping halfway**: a partial report is worth more than none.
> Tell what actually happened, not what the plan said. Every claim carries its proof (sha, command and
> rc, `path:line`). What can't be proven is said as such. §0–§7 are not touched: if a step was badly
> written, say it here.

- **Written by:** _executor and session_ · **date:** _…_
- **Status:** _completed · partial · stopped_. In one sentence: _…_
- **Branch and final sha:** `…` @ `…`

### 8.1 What was done, step by step

| Step | Status | Commit(s) | Note |
| --- | --- | --- | --- |
| P1 | done / partial / not done | `sha` | … |

### 8.2 What changed from the plan

### 8.3 What was not done, and why

### 8.4 Checks run

| Command | rc | Output |
| --- | --- | --- |
| `…` | `0/1/3` | … |

### 8.5 Files touched

`git diff --stat <base>..HEAD`

### 8.6 Findings and what the next hand needs

## Related

- 
