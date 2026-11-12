---
fileClass: Ticket Plan
id: "{{id}}"                           # its number, drawn PLN-<n>
aliases: []
item: "[[{{item_ref}} {{item_title}}]]"   # the initiative, story or support ticket this plan executes
project: "[[00 {{project}}]]"
written: {{date}}
base: "develop @ <sha>"                # the sha measured during diagnosis; what this builds on
branch: ""                             # e.g. feature/{{item_ref}}-{{slug}}
worktree: ""
executor: ""                           # claude · codex · owner — chosen by the owner at approval
verifier: ""                           # reviewer or judge; never the same hand as the executor
lane: normal                           # fast (S) · normal (M) · full (L); if it differs from size, say why
url: ""
tags: []
creation_date: {{date}}
updated_date: {{date}}
---
