---
fileClass: Ticket Entity
id: "{{id}}"                           # its number, drawn ENT-<n>
name: "{{slug}}"
status_agent: Idea                     # Idea · Design · Build · Test · Live · Retired
status_log: []
priority: P2                           # P0 · P1 · P2 · P3
version: "1.0"                         # cut from its Versions tab, never typed
entity_type: ""                        # workflow · agent · skill · command · rule · knowledge-base · resource · script · hook (canonical); tool · gate · eval · memory · subagent · handoff · event · objective (proposed)
path: ""                               # where it lives in the repo: .claude/skills/<name>/SKILL.md
related_to: ""                         # "[[AGT-<n> …]]": the architecture it is part of
tags: []
creation_date: {{date}}
updated_date: {{date}}
---
