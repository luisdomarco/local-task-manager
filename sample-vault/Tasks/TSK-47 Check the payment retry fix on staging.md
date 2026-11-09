---
fileClass: Ticket Task
id: 47                             # its number, drawn TSK-<n>: a task has no project key, its project can change
name: "check-the-payment-retry-fix-on-staging"
project: "[[00 Acme Web]]"             # "[[00 <Project>]]", optional
status_ticket: "5. Review"
status_log: [{"date": "2026-11-09", "from": "1. Backlog", "to": "2. ToDo", "by": "owner"}, {"date": "2026-11-09", "from": "2. ToDo", "to": "4. InProgress", "by": "owner"}, {"date": "2026-11-09", "from": "4. InProgress", "to": "5. Review", "by": "owner"}]
priority: P0                           # P0 · P1 · P2 · P3
related_to: "[[SUP-41 Customer charged twice after a timeout]]" # "[[INI|SUP|HFX|PRD-<n> …]]" it is part of, if any
url: ""
tags: ["payments"]
creation_date: 2026-11-09
updated_date: 2026-11-09
plan_day: 2026-11-09
due: 2026-11-09
---

# TSK-47 — Check the payment retry fix on staging

- [x] Reproduce the timeout
- [x] Retry twice
- [ ] One charge in the Stripe dashboard

## Related

- 
