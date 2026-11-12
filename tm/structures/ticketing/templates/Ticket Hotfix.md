---
fileClass: Ticket Hotfix
id: "{{id}}"                           # its number, drawn HFX-<n>
aliases: []
name: "{{slug}}"
project: "[[00 {{project}}]]"
status_ticket: "2. ToDo"               # hotfixes are born in ToDo: there is no backlog for the urgent
status_log: []
severity: high                         # critical · high · medium
affected: ""                           # who/what is impacted in production, and since when
origin: ""                             # "[[SUP-<n> …]]" or "direct" for a C1 with no prior ticket
base_branch: main
branch: ""                             # hotfix/{{ref}}-{{slug}}
rollback_plan: ""                      # REQUIRED before 2→4: one line here, detail in the body
observation_window: 24h                # time in 5. Review before it can close
spec_impact: []                        # living specs whose behavior changed, or ["none"]
postmortem: ""                         # "[[ERR-<n> …]]" — required to reach 6. Done
cherry_picked_to_develop: ""           # sha
owner_review: ""                       # "<date>; owner" — approval after the fact
changelog_ref: ""
url: ""
tags: []
creation_date: {{date}}
updated_date: {{date}}
---
