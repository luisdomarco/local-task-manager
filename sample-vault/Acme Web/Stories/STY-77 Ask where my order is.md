---
fileClass: Ticket Story
id: 77                             # its number, drawn STY-<n>
name: "ask-where-my-order-is"
project: "[[00 Acme Web]]"
initiative: "[[INI-76 Shopping assistant agent]]" # "[[INI-<n> …]]" it delivers a part of
status_ticket: "1. Backlog"
status_log: []                         # [{date, from, to, by}]
priority: P2                           # P0 · P1 · P2 · P3
size: S                                # S · M · L — an L is two stories
spec_impact: "none: a new screen, no requirement changes" # the specs it changes ("[[SPEC-<n> …]]"), or "none: <why>"
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
tags: ["ai"]
creation_date: 2026-11-14
updated_date: 2026-11-14
---

## Story

As a shopper, I want to ask where my order is.

## Acceptance criteria

#### Scenario: Ask where my order is
- **WHEN** a shopper asks about an order in chat
- **THEN** the agent answers with its status and tracking link
