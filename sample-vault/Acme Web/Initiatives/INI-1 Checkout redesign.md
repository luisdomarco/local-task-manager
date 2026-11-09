---
fileClass: Ticket Initiative
id: 1                             # its number, drawn INI-<n>, assigned by the capability
aliases: []                            # its ids from before short ids: [ACME-INI-001]
name: "checkout-redesign"
project: "[[00 Acme Web]]"
status_ticket: "4. InProgress"         # only via tickets_move
status_log: [{"date": "2026-11-09", "from": "1. Backlog", "to": "2. ToDo", "by": "owner"}, {"date": "2026-11-09", "from": "2. ToDo", "to": "4. InProgress", "by": "rule"}] # [{date, from, to, by}] — written by the capability
priority: P1                           # P0 · P1 · P2 · P3
size: L                                # S · M · L
regime: standard                       # standard (reviewer) · critical (judge with sealed oracle); goes up, never down
area: ""                               # one of the project's `areas`
objective: ""                          # the observable end state that allows this initiative to close
premise: verified                      # unverified · verified · reframed · refuted
premise_verified: "2026-11-06 @ 4f2a9c1; drop-off at checkout is 61% across four steps (analytics, last 30 days)" # "<date> @ <sha>; what was measured"
prd: ""                                # "[[PRD-<n> …]]" (product, optional)
plan: ""                               # "[[PLN-<n> …]]" — the approach, when it needs one; each story may have its own
origin: ""                             # "[[SUP-<n> …]]" if promoted
depends_on: []
related_analyses: []
related_errors: []
related_learnings: []
on_hold: {}                            # {by, why, resume_when}
discard_reason: ""
url: ""
tags: ["checkout"]
creation_date: 2026-11-09
updated_date: 2026-11-09
sidebar: true
goal: "[[GOL-27 Launch the new checkout]]"
goal_order: 1
due: 2026-12-15
---

## Goal

A one-page checkout that keeps more carts: address, shipping and payment on one page, with the delivery date and the
total visible before paying.

## Objective

Drop-off at checkout under 40% (it is 61% today), measured over two weeks on all traffic.

## Premise

Most carts are lost between the shipping and the payment step, not at the payment itself. Verified on the analytics
funnel of the last 30 days: 38% of carts leave at step 3 of 4.

## Boundaries

- **Always:** the cart is kept on a failed payment; every payment call carries an idempotency key.
- **Never:** ask for an account before paying.
- **Out of scope:** wallets (Apple Pay and Google Pay have their own initiative).

## Stories

Delivered in order: guest checkout, the one page, autocomplete, the delivery date, the cart kept on a failed payment.
