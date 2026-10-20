---
fileClass: Ticket Spec
id: "{{id}}"                           # KEY-SPEC-NNN
name: "{{slug}}"
project: "[[00 {{project}}]]"
status_spec: draft                     # draft · active (its requirements valid) · retired
capability: ""                         # the part of the system it describes
stories: []                            # the stories whose Spec delta changed it
synced_sha: ""                         # the commit in production it describes
synced_date: ""
url: ""
tags: []
creation_date: {{date}}
updated_date: {{date}}
---

# {{id}} — {{title}}

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
