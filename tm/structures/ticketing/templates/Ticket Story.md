---
fileClass: Ticket Story
id: "{{id}}"                           # its number, drawn STY-<n>
name: "{{slug}}"
project: "[[00 {{project}}]]"
initiative: ""                         # "[[INI-<n> …]]" it delivers a part of
status_ticket: "1. Backlog"
status_log: []                         # [{date, from, to, by}]
priority: P2                           # P0 · P1 · P2 · P3
size: S                                # S · M · L — an L is two stories
spec_impact: ""                        # the specs it changes ("[[SPEC-<n> …]]"), or "none: <why>"
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
tags: []
creation_date: {{date}}
updated_date: {{date}}
---
