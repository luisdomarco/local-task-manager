---
fileClass: Ticket Agent
id: "{{id}}"                           # its number, drawn AGT-<n>: an architecture has no project key, its project can change
name: "{{slug}}"
project: ""                            # "[[00 <Project>]]", optional
status_agent: Idea                     # Idea · Design · Build · Test · Live · Retired
status_log: []
priority: P2                           # P0 · P1 · P2 · P3
version: "1.0"                         # cut from its Versions tab, never typed
scheme: ""                             # A · B
harness: ""                            # assistant · entity_agent · governed_process · unattended
architecture: ""                       # AR-1 · AR-2 · AR-3 · AR-4 · AR-5 · AP-1 (anti-pattern)
decision: ""                           # the branch taken and its evidence, dated
platform: ""                           # Claude Code subagent · Agent SDK · Managed Agent · n8n · Other
model: ""
trigger: ""                            # manual · scheduled · event
tools: ""                              # the tools and MCP servers it uses
related_to: ""                         # "[[INI-<n> …]]" it is part of, if any
url: ""
tags: []
creation_date: {{date}}
updated_date: {{date}}
---
