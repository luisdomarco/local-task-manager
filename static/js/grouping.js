// "Group by" for the list tables: what key a row falls under, and in what order the groups go.
// Pure: no DOM, no state (the item lookup is passed in), so the rules are testable on their own.
// The group headers are drawn by the list view (views/list.js).
import { addDays, isoWeek, shiftWeek, today } from './dates.js';
import { PRIORITY_RANK, anyStatusRank, isDone } from './rules.js';

export const NONE = ''; // the group of rows that have no value: "No initiative", "Unplanned"…

/** Parent, grandparent… up the related_to chain, nearest first; a loop in the data stops it. */
export function ancestorsOf(item, byId) {
  const out = [];
  const seen = new Set([item.id]);
  for (let p = byId.get(item.fields.related_to); p && !seen.has(p.id); p = byId.get(p.fields.related_to)) {
    out.push(p);
    seen.add(p.id);
  }
  return out;
}

/** The nearest initiative up the chain (a task → its story → that story's initiative), or NONE. */
export const initiativeOf = (item, byId) => ancestorsOf(item, byId).find((p) => p.type === 'initiative')?.id || NONE;

/** An initiative's group: the initiative its tree starts at — the topmost one up the chain, or itself when it hangs
 *  from none. So each top initiative heads a group with every sub-initiative (its epics, theirs…) under it. */
export const topInitiativeOf = (item, byId) => ancestorsOf(item, byId).filter((p) => p.type === 'initiative').at(-1)?.id || item.id;

/** A Ticketing item's project: the key its `project` field holds, or NONE. */
export const projectOf = (item) => item.fields.project || NONE;

// The "Planned" groups, in the order they show.
export const PLAN_BUCKETS = [
  ['overdue', 'Overdue'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'This week'],
  ['nextweek', 'Next week'], ['later', 'Later'], ['past', 'Planned before'], [NONE, 'Unplanned'],
];

/**
 * Which "Planned" group an item falls in (a key of PLAN_BUCKETS), from its plan_day
 * ('YYYY-MM-DD') and plan_week ('YYYY-Www'); both may be empty. `now` is today's date.
 *   - The day decides when there is one; the week only counts without a day.
 *   - A past plan is Overdue while the item is open, and Planned before once it is closed (it was done).
 *   - A week-only plan for this week is This week, whichever day it is.
 * Days and weeks are compared as strings: both formats sort in date order.
 */
export function planBucket(item, now = today()) {
  const { plan_day: day, plan_week: week } = item.fields;
  if (!day && !week) return NONE;
  const current = isoWeek(now);
  const next = shiftWeek(current, 1);
  const past = isDone(item) ? 'past' : 'overdue';
  if (day) {
    if (day < now) return past;
    if (day === now) return 'today';
    if (day === addDays(now, 1)) return 'tomorrow';
    const w = isoWeek(day);
    return w === current ? 'week' : w === next ? 'nextweek' : 'later';
  }
  if (week < current) return past;
  return week === current ? 'week' : week === next ? 'nextweek' : 'later';
}

const rank = (list) => (key) => { const i = list.indexOf(key); return i < 0 ? list.length : i; };
const statusRank = anyStatusRank; // by group (Not started · In progress · Closed), then each type's order
const planRank = rank(PLAN_BUCKETS.map(([k]) => k));

/** Group keys by a name, the rows with no value (NONE) last. */
const byName = (name) => (a, b) => (a === NONE ? 1 : b === NONE ? -1 : name(a).localeCompare(name(b)));

/**
 * The ways a list can be grouped: { label, by(item, byId) → key, order(a, b, byId, projectName), lead?(key, item) }.
 * `projectName(key)` names a project by its key (a project note has no id, so it is not in byId). `lead` picks the
 * row that goes first in its group, before the sort: the one the group is.
 * Which ones a list offers is up to its type (the structure's list config, views/list.js listConfig).
 */
export const GROUPS = {
  initiative: {
    label: 'Initiative',
    // Anything else falls under the nearest initiative it hangs from; an initiative, in its own tree's.
    by: (item, byId) => (item.type === 'initiative' ? topInitiativeOf(item, byId) : initiativeOf(item, byId)),
    // By title, the rows with no initiative last.
    order: (a, b, byId) => byName((k) => byId.get(k)?.title || k)(a, b),
    lead: (key, item) => item.id === key,
  },
  project: {
    label: 'Project',
    by: projectOf,
    // By the project's name, the rows with no project last.
    order: (a, b, byId, projectName = (k) => k) => byName(projectName)(a, b),
  },
  status: { label: 'Status', by: (i) => i.fields.status || 'Backlog', order: (a, b) => statusRank(a) - statusRank(b) },
  priority: {
    label: 'Priority',
    by: (i) => i.fields.priority || 'Normal',
    order: (a, b) => (PRIORITY_RANK[a] || 9) - (PRIORITY_RANK[b] || 9),
  },
  plan: { label: 'Planned', by: (i) => planBucket(i), order: (a, b) => planRank(a) - planRank(b) },
};

export const planLabel = (key) => PLAN_BUCKETS.find(([k]) => k === key)?.[1] || key;
