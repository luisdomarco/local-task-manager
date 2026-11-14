---
fileClass: Ticket Agent
id: 78                                 # its number, drawn AGT-<n>: an architecture has no project key, its project can change
name: "shopping-assistant"
project: ""                            # "[[00 <Project>]]", optional
status_agent: Build                    # Idea · Design · Build · Test · Live · Retired
status_log: [{"date": "2026-11-10", "from": "Idea", "to": "Build", "by": "owner"}]
priority: P1                           # P0 · P1 · P2 · P3
version: "1.1"                         # cut from its Versions tab, never typed
scheme: B                              # A · B
harness: assistant                     # assistant · entity_agent · governed_process · unattended
architecture: AR-1                     # AR-1 · AR-2 · AR-3 · AR-4 · AR-5 · AP-1 (anti-pattern)
decision: "AR-1: no measured saturation, parallelism or tool conflict (2026-11-10)"
on_new_version: finish                 # finish · move · restart
platform: Agent SDK                    # Claude Code subagent · Agent SDK · Managed Agent · n8n · Other
model: claude-sonnet-5-5
trigger: event                         # manual · scheduled · event
tools: "Catalog MCP"                   # the tools and MCP servers it uses
related_to: "[[INI-76 Shopping assistant agent]]"
url: ""
tags: []
creation_date: 2026-11-10
updated_date: 2026-11-12
---

## Objective

Help a shopper find the right product and reach checkout, without inventing stock or prices.

## Context

One shopper's session: what they asked, what they looked at, their cart. Never other shoppers' data.

## Harness and architecture

An assistant on AR-1: one loop with skills. Nothing measured asks for a second agent.

## Contracts

None: a single loop has no boundaries between agents.

## Evals

- Never quotes a price the catalog did not return.
- Asks before adding to the cart.

## Runbook

Stop it from its flag in the admin; it then hands every session to a person.
