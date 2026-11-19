---
fileClass: Ticket Project
project_key: "{{key}}"                 # 2-4 capital letters, unique in the vault: ACME, OPS, WEB…
repo: "~/github/…"                     # where the code lives
managed_by: "~/github/…/.claude"       # the system whose agents execute this project's tickets
area: ""                               # the area the project itself belongs to
objective: ""                          # the observable end state that allows this project to close
execution_mode: parallel               # serial (one InProgress at a time, all types) | parallel
support_due_days: {C1: 0, C2: 7, C3: 30}
premise_max_age_days: 14               # gate Backlog→ToDo fails if premise_verified is older
url: ""                                # repo URL
tags: []
creation_date: {{date}}
updated_date: {{date}}
---
