// Business rules: which item shows up where. Views only ask these questions;
// they never inspect frontmatter fields to decide membership themselves.
import { addDays, shiftWeek, today, thisWeek, weekDays } from './dates.js';
import { FOLDER_PER_TYPE } from './structure.js';

// Catalogs: the vault's structure (GET /api/structure, tm/structures; the server validates against the same
// lists). Live bindings, set by setStructure() before anything renders: importers always read the current one.
// Until then, and in the node tests, they are the folder-per-type structure's (structure.js).
export let STRUCTURE = FOLDER_PER_TYPE;
export let TYPE_DEFS = {}; // name → the type as the structure describes it
export let STATUSES = [];
export let CLOSED = new Set();
export let PRIORITIES = [];
export let PRIORITY_RANK = {}; // Urgent: 1 … Low: 4
/** The outside tracker items point at: { id_key, url_key, label, id_placeholder, url_placeholder } (Redmine in the folder-per-type structure). */
export let EXTERNAL_REF = {};
// Which types each type may be related to (its parent). Mirrors the structure's `parents` server-side.
export let PARENT_TYPES = {};
/** Types with status / priority / planning (the actionable ones). */
export let PLANNABLE = new Set();
let closedOf = {}; // type → the statuses that close it
// The three groups every status falls in (tm/structures GROUPS, TSK-037): fixed, never edited. Open = the first two.
export let STATUS_GROUPS = [['not_started', 'Not started'], ['in_progress', 'In progress'], ['closed', 'Closed']];
export const OPEN_GROUPS = new Set(['not_started', 'in_progress']);
const NOT_STARTED = new Set(['Backlog', 'ToDo', 'Idea', 'open']); // where a status goes when no vault said (as the server)
export const ACTIVITY_SOURCES = ['Email', 'Slack', 'Comment', 'Other'];

const listeners = [];
/** Runs `fn(structure)` now and again whenever the structure changes: how other modules derive their own tables. */
export function onStructure(fn) {
  listeners.push(fn);
  fn(STRUCTURE);
}

export function setStructure(s) {
  STRUCTURE = s;
  TYPE_DEFS = Object.fromEntries(s.types.map((t) => [t.name, t]));
  STATUSES = s.statuses;
  CLOSED = new Set(s.closed);
  PRIORITIES = s.priorities;
  PRIORITY_RANK = Object.fromEntries(s.priorities.map((p, i) => [p, i + 1]));
  EXTERNAL_REF = s.external_ref;
  PARENT_TYPES = Object.fromEntries(s.types.map((t) => [t.name, t.parents]));
  PLANNABLE = new Set(s.types.filter((t) => t.plannable).map((t) => t.name));
  closedOf = Object.fromEntries(s.types.map((t) => [t.name, t.closed.length ? new Set(t.closed) : CLOSED]));
  if (s.groups) STATUS_GROUPS = s.groups;
  listeners.forEach((fn) => fn(s));
}
setStructure(FOLDER_PER_TYPE);

/** Whether this vault has the type turned on: a type turned off in Settings → Vaults is not in its structure. */
export const isEnabled = (type) => !!TYPE_DEFS[type];

/** The statuses an item of this type may have: its own (an error's open · mitigated · resolved), else the structure's. */
export const statusesOf = (type) => (TYPE_DEFS[type]?.statuses?.length ? TYPE_DEFS[type].statuses : STATUSES);
/** The group of a status in a type: as the vault arranged it (Settings → Item type status), else closed if it closes
 *  the type, not started for Backlog · ToDo · Idea · open, under way for the rest. */
export function groupOf(type, status) {
  const g = TYPE_DEFS[type]?.groups?.[status];
  if (g) return g;
  if ((closedOf[type] || CLOSED).has(status)) return 'closed';
  return NOT_STARTED.has(status) ? 'not_started' : 'in_progress';
}
/** Where a status sorts: by its group, then where the type lists it. Unknown ones last. */
export function statusRank(type, status) {
  const list = statusesOf(type);
  const at = list.indexOf(status);
  if (at < 0) return 1000;
  return STATUS_GROUPS.findIndex(([g]) => g === groupOf(type, status)) * 100 + at;
}
/** Where a status sorts when no type is given (the board's lists, a group of mixed types): its best place in any type. */
export function anyStatusRank(status) {
  return Math.min(1000, ...STRUCTURE.types.filter((t) => t.statuses?.length).map((t) => statusRank(t.name, status)));
}
/** Whether a status closes the types that have it (the board's Done list). */
export const isClosedStatus = (status) => closedName(status) || CLOSED.has(status);
/** The statuses of `types` under each group, for the Group → Status filters: [[group, label, [status…]]], each status
 *  once per group, in the types' order. */
export function statusTree(types) {
  return STATUS_GROUPS.map(([g, label]) => {
    const names = [];
    for (const t of types) for (const st of statusesOf(t)) if (groupOf(t, st) === g && !names.includes(st)) names.push(st);
    return [g, label, names];
  });
}
/** What closing (`closed`) or reopening a type's item sets: its first closed status (Done), or its last one not started
 *  (ToDo: ready to be picked up again). */
export function statusFor(type, closed) {
  const list = statusesOf(type).filter((st) => groupOf(type, st) === (closed ? 'closed' : 'not_started'));
  return closed ? list[0] : list[list.length - 1];
}
/** Whether an item passes a status filter (statuses ticked; none ticked = any). A type without statuses (a note, an
 *  activity) passes while its open/closed state has a status of that group ticked. */
export function statusPasses(it, ticked) {
  if (!ticked || !ticked.size) return true;
  const own = TYPE_DEFS[it.type]?.statuses;
  if (own?.length) return ticked.has(it.fields.status || own[0]);
  const done = isDone(it);
  return [...ticked].some((st) => closedName(st) === done);
}
const closedName = (st) => STRUCTURE.types.some((t) => t.statuses?.includes(st) && groupOf(t.name, st) === 'closed');
/** Whether a type carries that field (a support ticket has no priority; only a Ticketing item has a project). */
export const hasField = (type, key) => !!TYPE_DEFS[type]?.fields.includes(key);
/** Whether an item is in a page table that takes only some of its type (TypeDef.child_tables `where`): each field
 *  holds that value, in any case and with spaces around. No `where`: every item is. */
export const matchesWhere = (item, where) => Object.entries(where || {})
  .every(([k, v]) => String(item.fields[k] ?? '').trim().toLowerCase() === String(v).toLowerCase());
/** What an item may hang from, by project (Ticketing): with a project chosen, only items of that project; with
 *  none, any. A parent's project comes with it (parentProject), so an item and what it hangs from share one. */
export const inProject = (project) => (parent) => !project || parent.fields.project === project;
export const parentProject = (parent) => parent?.fields.project || null;
/** Whether a type picks what it hangs from in two fields (Ticketing): Initiative, and Related to for the rest (a support
 *  ticket, a hotfix, a PRD…). Still one parent: picking in one empties the other. */
export const splitsInitiative = (type) => hasField(type, 'project') && (PARENT_TYPES[type] || []).includes('initiative')
  && PARENT_TYPES[type].length > 1;
/** A new item's value for a field where the structure has its own default (P2 in Ticketing, Normal in the folder-per-type structure). */
export const defaultOf = (key, fallback) => STRUCTURE.defaults?.[key] ?? fallback;

/** What names an item in its page's address: its id, or a Ticketing project's key (a project note has no id). */
export const pageRef = (item) => item?.id || (item?.type === 'project' ? item.fields.project_key || '' : '');
/** Whether an item opens as a page of its own (its type's `page`: an initiative; in Ticketing a project and a PRD
 *  too) rather than as a card over its list. One with nothing to name it by opens as a card. */
export const hasPage = (item) => !!item && !!TYPE_DEFS[item.type]?.page && !!pageRef(item);
/** The item a page's address names, among `items`: by its id, or a project by its key. */
export const findByPageRef = (type, ref, items) => items.find((i) => i.type === type && pageRef(i) === ref) || null;
/** Where an item shows one of its type's own fields: 'main' (its properties), or a tab of the side panel. */
export const tabOf = (p) => p.tab || (p.kind === 'link' || p.kind === 'links' ? 'relations' : 'main');
/** A type's own fields shown in one place (tabOf). */
export const propsIn = (type, tab) => (TYPE_DEFS[type]?.props || []).filter((p) => tabOf(p) === tab);

/** Whether a type can be linked to others at all (parent, child, related): it carries `relations`. */
export const RELATABLE = (type) => TYPE_DEFS[type]?.relatable ?? true;

/** Whether an item of this type carries the outside tracker's reference (an initiative or a story points at a Redmine issue). */
export const hasExternalRef = (type) => !!TYPE_DEFS[type]?.fields.includes(EXTERNAL_REF.id_key);

/** Closed: one of its type's closed statuses (Done/Discarded), or, for a type closed by a field (an activity's
 *  resolution), that field set. */
export const isDone = (it) => {
  const by = TYPE_DEFS[it.type]?.closed_when;
  return by ? !!it.fields[by] : (closedOf[it.type] || CLOSED).has(it.fields.status);
};
export const isArchived = (it) => it.fields.archived === true;
export const isPlannedToday = (it) => it.fields.plan_day === today();
export const isPlannedWeek = (it, week = thisWeek()) => it.fields.plan_week === week;

/** Planned for a past day and still open → shows as "Carried over" in Today. */
export const carriedOverDay = (it) =>
  PLANNABLE.has(it.type) && !isDone(it) && !!it.fields.plan_day && it.fields.plan_day < today();

/** Planned for a past week and still open → shows as "Carried over" in Week. */
export const carriedOverWeek = (it) =>
  PLANNABLE.has(it.type) && !isDone(it) && !!it.fields.plan_week && it.fields.plan_week < thisWeek();

/** The Week view's buckets, for its list and its board alike (TSK-043): what was planned for an earlier week and is
 *  still open (shown only on this week), what is planned for the week with no day, and what is planned on each of its
 *  days. `hideDone` leaves the closed ones out; `sort` orders each bucket. → { days, carried, anytime, byDay }. */
export function weekBuckets(items, week, { hideDone = false, sort = () => 0 } = {}) {
  const days = weekDays(week);
  const shown = (i) => !(hideDone && isDone(i));
  const inWeek = items.filter((i) => shown(i) && (i.fields.plan_week === week || days.includes(i.fields.plan_day)));
  return {
    days,
    carried: week === thisWeek() ? items.filter(carriedOverWeek).sort(sort) : [],
    anytime: inWeek.filter((i) => !i.fields.plan_day).sort(sort),
    byDay: Object.fromEntries(days.map((d) => [d, inWeek.filter((i) => i.fields.plan_day === d).sort(sort)])),
  };
}

/** The Week board's day filter: `days` (Mon…Sun dates) kept to the weekdays picked, 0 = Mon … 6 = Sun; none picked = all. */
export const pickDays = (days, picked = []) => (picked.length ? days.filter((_, n) => picked.includes(n)) : days);

export const isOverdue = (it) => !isDone(it) && !!it.fields.due && it.fields.due < today();

/** Plan filters shared by Board, Tasks, Initiatives and All items. */
export const PLAN_FILTERS = {
  any: { label: 'Any plan', test: () => true },
  today: { label: 'Today', test: (it) => it.fields.plan_day === today() || carriedOverDay(it) },
  tomorrow: { label: 'Tomorrow', test: (it) => it.fields.plan_day === addDays(today(), 1) },
  week: { label: 'This week', test: (it) => it.fields.plan_week === thisWeek() || carriedOverWeek(it) },
  nextweek: { label: 'Next week', test: (it) => it.fields.plan_week === shiftWeek(thisWeek(), 1) },
  overdue: { label: 'Overdue', test: (it) => isOverdue(it) || carriedOverDay(it) },
  unplanned: { label: 'Unplanned', test: (it) => !it.fields.plan_day && !it.fields.plan_week },
};
export const planFilter = (key) => (PLAN_FILTERS[key] || PLAN_FILTERS.any).test;

/**
 * Cards in a column you order by hand (TSK-053): those placed (a number in `key`) first, in that order, then the rest as
 * `fallback` sorts them. The Board orders by `order` (within its list); Today and Week by `plan_order` (within the day,
 * or the week when no day), so moving a card on one never reorders the other.
 */
export const byManualOrder = (fallback = () => 0, key = 'plan_order') => (a, b) => {
  const x = typeof a.fields[key] === 'number' ? a.fields[key] : Infinity;
  const y = typeof b.fields[key] === 'number' ? b.fields[key] : Infinity;
  return (x === y ? 0 : x - y) || fallback(a, b);
};

/**
 * Where `item` lands when dropped at `index` among `cards` (the column as shown, the dragged card left out): the values
 * of `key` to write, [[card, value]]. Between two placed cards it takes the middle, so only it is written; when a
 * neighbour has no place yet (or there is no room left between them) the whole column is numbered in steps of 10, as shown.
 */
export function placement(item, cards, index, key = 'order') {
  const orders = cards.map((c) => c.fields[key]);
  const prev = index > 0 ? orders[index - 1] : null;
  const next = index < cards.length ? orders[index] : null;
  const gapless = (index > 0 && typeof prev !== 'number') || (index < cards.length && typeof next !== 'number')
    || (typeof prev === 'number' && typeof next === 'number' && next - prev < 1e-6);
  if (gapless) {
    const seq = [...cards.slice(0, index), item, ...cards.slice(index)];
    return seq.map((c, i) => [c, i * 10]);
  }
  const order = prev === null && next === null ? 0 : prev === null ? next - 10 : next === null ? prev + 10 : (prev + next) / 2;
  return [[item, order]];
}

/**
 * The label filter of every list that shows labels (TSK-052): `labels` picked, and how several combine — 'or' (any of
 * them, the default) or 'and' (all of them). None picked lets every item through.
 */
export const LABEL_MODES = { or: 'Any (OR)', and: 'All (AND)' };
export function labelsPass(item, labels, mode = 'or') {
  if (!labels?.length) return true;
  const have = new Set(item.fields.labels || []);
  return mode === 'and' ? labels.every((l) => have.has(l)) : labels.some((l) => have.has(l));
}

/** A saved filter from before TSK-052 held one label (`label`): it becomes a list of one. */
export const labelsOf = (saved) => (Array.isArray(saved?.labels) ? saved.labels : saved?.label ? [saved.label] : []);
