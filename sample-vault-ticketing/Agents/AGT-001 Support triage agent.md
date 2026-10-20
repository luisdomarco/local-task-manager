---
fileClass: Ticket Agent
id: "AGT-001"                           # AGT-NNN: an agent has no project key, its project can change
name: "support-triage-agent"
project: ""                            # "[[00 <Project>]]", optional
status_agent: Idea                     # Idea · Design · Build · Test · Live · Retired
status_log: []
priority: P2                           # P0 · P1 · P2 · P3
platform: ""                           # Claude Code subagent · Agent SDK · Managed Agent · n8n · Other
model: ""
trigger: ""                            # manual · scheduled · event
tools: ""                              # the tools and MCP servers it uses
related_to: ""                         # "[[KEY-INI-NNN …]]" it is part of, if any
url: ""
tags: []
creation_date: 2026-10-20
updated_date: 2026-10-20
---

# AGT-001 — Support triage agent

Reads new support tickets and suggests their level.

## Purpose

What it does, for whom, and why it is worth having.

## Inputs

## Outputs

## Tools

## Prompt

## Evaluation

How you know it works: the cases it must get right, and how they are checked.

## Runbook

How to run it, stop it, and what to do when it fails.

## Related

- 
