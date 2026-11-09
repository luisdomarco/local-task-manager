---
fileClass: Ticket Story
id: 8                             # its number, drawn STY-<n>
name: "cache-the-test-dependencies"
project: "[[00 Internal Tools]]"
initiative: "[[INI-4 Faster deploys]]" # "[[INI-<n> …]]" it delivers a part of
status_ticket: "6. Done"
status_log: [{"date": "2026-11-09", "from": "1. Backlog", "to": "2. ToDo", "by": "owner"}, {"date": "2026-11-09", "from": "2. ToDo", "to": "4. InProgress", "by": "owner"}, {"date": "2026-11-09", "from": "4. InProgress", "to": "5. Review", "by": "owner"}, {"date": "2026-11-09", "from": "5. Review", "to": "6. Done", "by": "owner"}] # [{date, from, to, by}]
priority: P2                           # P0 · P1 · P2 · P3
size: S                                # S · M · L — an L is two stories
spec_impact: "none: CI only"           # the specs it changes ("[[SPEC-<n> …]]"), or "none: <why>"
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
tags: ["infra"]
creation_date: 2026-11-09
updated_date: 2026-11-09
---

## Story

As an engineer, I want the test dependencies cached, so that CI starts in seconds.

## Acceptance criteria

#### Scenario: A second run
- **WHEN** CI runs again with the same lockfile
- **THEN** dependencies come from the cache
