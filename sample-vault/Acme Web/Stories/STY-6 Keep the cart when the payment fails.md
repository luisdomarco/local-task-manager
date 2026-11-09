---
fileClass: Ticket Story
id: 6                             # its number, drawn STY-<n>
name: "keep-the-cart-when-the-payment-fails"
project: "[[00 Acme Web]]"
initiative: "[[INI-1 Checkout redesign]]" # "[[INI-<n> …]]" it delivers a part of
status_ticket: "2. ToDo"
status_log: [{"date": "2026-11-09", "from": "1. Backlog", "to": "2. ToDo", "by": "owner"}] # [{date, from, to, by}]
priority: P1                           # P0 · P1 · P2 · P3
size: S                                # S · M · L — an L is two stories
spec_impact: "checkout: the cart is kept on a failed payment" # the specs it changes ("[[SPEC-<n> …]]"), or "none: <why>"
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
tags: ["checkout"]
creation_date: 2026-11-09
updated_date: 2026-11-09
goal: "[[GOL-27 Launch the new checkout]]"
goal_order: 4
---

## Story

As a shopper, I want my cart kept when the payment fails, so that I can try another card.

## Acceptance criteria

#### Scenario: A card is declined
- **WHEN** the payment is declined
- **THEN** the shopper is back on checkout with the same cart
