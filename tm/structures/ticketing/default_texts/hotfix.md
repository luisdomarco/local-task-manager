> [!agent] Urgent production fix. Approval comes **after**: the owner reviews it at closing.
> Without a rollback plan, production is not touched.

## Problem

What is broken in production, observable, with the first evidence.

## Impact

Who is affected, how much (users, money, data), and since when.

## Root cause

Known or suspected. If suspected, say so.

## Fix

The minimal change. What is deliberately **not** fixed here and goes to an initiative instead.

## Test plan

The test that reproduces the failure (red before, green after) and how production is checked after
deploy.

## Rollback plan

The exact steps to undo it (revert sha, redeploy, data restore if any), and who can run them.

## Deployment

Dated log: branch, merge to `main` (sha), deploy, observation, rollback if it happened, cherry-pick to
`develop` (sha).

- {{date}} — 

## Post-mortem

Link to the ERR record (`postmortem`). If behavior changed: the living spec update (sha) — this is the
only path that skips the approval gate, so it must close the loop here.
