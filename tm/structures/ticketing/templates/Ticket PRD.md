---
fileClass: Ticket PRD
id: "{{id}}"                           # KEY-PRD-NNN
name: "{{slug}}"
project: "[[00 {{project}}]]"
status_ticket: "1. Backlog"            # 1. Backlog = draft · 5. Review = being read · 6. Done = approved and in force · 7. Discarded = superseded
status_log: []
initiative: ""                         # "[[KEY-INI-NNN …]]" created when approved
supersedes: ""                         # "[[KEY-PRD-NNN …]]"
superseded_by: ""
url: ""
tags: []
creation_date: {{date}}
updated_date: {{date}}
---

# {{id}} — {{title}}

> [!owner] A PRD states intent: who needs what, and how we will know it worked. It does not describe the
> implementation, and it does not change after approval. If the intent changes, a new PRD supersedes it.
> Target length when working solo: about two pages.

## Purpose

Why this area of the product exists, in two or three sentences.

## Users and jobs

| ID | Who | Job to be done | Today they… |
| --- | --- | --- | --- |
| UJ-1 | … | … | … |

### Non-users

Who this is explicitly not for.

## Features

| ID | Feature | Consequence (testable) | Journey |
| --- | --- | --- | --- |
| FR-1 | … | When …, the user can … | UJ-1 |

## UX notes

Only if screens change significantly: the flows, the states of each screen (empty, loading, error,
partial data) and what the user sees first. Link mockups or a `ux` analysis.

## Non-goals

What this PRD deliberately does not cover.

## Stories

How it becomes work: one initiative and its stories, in order, each shippable on its own.

| Story | Covers | Depends on |
| --- | --- | --- |
| 1 | FR-1, FR-2 | — |

## Success metrics

| ID | Metric | Baseline | Target | How it is measured |
| --- | --- | --- | --- | --- |
| SM-1 | … | … | … | … |

## Open questions

## Assumptions

Each assumption, and what would prove it wrong.

## Related

- 
