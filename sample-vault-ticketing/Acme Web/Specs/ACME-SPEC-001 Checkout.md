---
fileClass: Ticket Spec
id: "ACME-SPEC-001"                           # KEY-SPEC-NNN
name: "checkout"
project: "[[00 Acme Web]]"
status_spec: active                    # draft · active (its requirements valid) · retired
capability: checkout                   # the part of the system it describes
stories: []                            # the stories whose Spec delta changed it
synced_sha: ""                         # the commit in production it describes
synced_date: ""
url: ""
tags: ["checkout"]
creation_date: 2026-10-20
updated_date: 2026-10-20
status_log: [{"date": "2026-10-20", "from": "draft", "to": "active", "by": "owner"}]
---

# ACME-SPEC-001 — Checkout

## Purpose

Take a cart to a paid order.

## Requirements

### Requirement: Cart is kept
The system SHALL keep the cart until the order is paid.

#### Scenario: Leaving checkout
- **WHEN** the shopper leaves checkout before paying
- **THEN** the cart is there when they come back

> [!agent] What the system does today, in production. It changes when a story's Spec delta is merged into it
> as the story ships, and then `synced_sha` is that commit. What is about to change is in the open stories.

## Purpose

What this part of the system is for, in two or three lines.

## Requirements

### Requirement: <name>
The system SHALL …

#### Scenario: <name>
- **WHEN** …
- **THEN** …
