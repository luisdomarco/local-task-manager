> [!owner] Frozen at 2. ToDo
> The agent may draft these sections; the owner approves them. After approval nobody edits them. A replan
> (4 → 2) unfreezes them and needs approval again.

## Objective

What the system achieves when this closes, in observable terms, and for whom. Why it matters now.

## Premise

The belief this system rests on (that the work is worth automating, and with an agent rather than a script), and
how it was verified (`premise_verified`). If the premise is refuted during diagnosis, stop: the initiative is
reframed or discarded.

## Architecture

- **One agent or several:** the branch of the decision taken, with dated evidence.
- **Scheme:** A or B, and why.
- **Reference architecture:** AR-1 … AR-5, and why this one over the next closest. AP-1 is an anti-pattern: say
  what keeps it out.
- **Harness:** assistant · entity agent · governed process · unattended orchestration.
- **Platform, model and trigger:** where it runs, on what, and what starts it.

## Contracts between agents

What each agent or step receives and hands on (inputs, outputs, their format), who may stop the flow, and where a
human decides.

## Evals

How we know it works: the cases it must pass, the threshold, and when they run (before each change, on a schedule).

## Boundaries

### Always

- 

### Never

- 

### Out of scope

What looks related and is not touched here, and where it is recorded instead.

---

> [!agent] Agent-owned
> Appended to, never rewritten.

## Prior context

What was read before planning: earlier initiatives and architectures in the same area, learnings, analyses. Treat
them as claims to verify, not as facts.

## Critical diagnosis

Every claim (from the request or from prior context) is a hypothesis to challenge.

| Claim | Verdict | Source | Quantified impact |
| --- | --- | --- | --- |
| … | ✅ / 🟡 / 🔴 / ⚪ | file:line, command output, or live data | … |

Legend: ✅ confirmed · 🟡 partial · 🔴 refuted · ⚪ unverifiable (say why).

## Stories

What gets delivered, one story each, in order (`STY-<n>`, linked by their `initiative:`). The initiative
starts with the first story and closes with the last.

## Workflow follow-up

What can only happen after closing, as plain bullets. Each one becomes a ticket before 6. Done.

-
