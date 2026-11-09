# How we ship

Small changes, shipped often, each one easy to undo.

## The path of a change

1. A story is **ready** when its scenarios are written and its initiative is approved.
2. One branch and one pull request per story; an agent may write it, a person reviews it.
3. CI runs the suites in parallel; a red check blocks the merge.
4. Merged to `main` means deployed: behind a flag until the story is done.

## Before a release

- [ ] Release notes drafted (`/release-notes`) and read by Product
- [ ] Smoke test on staging (`/qa:smoke-test`)
- [ ] Rollback plan written for anything touching payments

| When | Who | What |
|---|---|---|
| Daily 9:00 | everyone | stand-up, async in #product |
| Wednesday | Product team | backlog review |
| Friday | Marta | weekly review and the update to Leadership |
