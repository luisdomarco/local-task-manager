// The view model of a list or a board: what can filter it, whether an item passes, how many items hold each value,
// how they group, which closed ones show, and which columns give way on a narrow window. Pure: no DOM and no state
// (what a field needs from the vault — the items by id, the labels, a project's name — comes in `ctx`), so every rule
// is tested on its own (tests/js/viewmodel.test.mjs). The bar that draws it is viewbar.js.
//
// A view, as saved per list (prefs.js `list.<type>`):
//   { v: 2, filters: [{ field, op: 'is' | 'isnot', values: [...] }], groupBy, orderInGroups, showEmpty,
//     closed: 'none' | 'week' | 'all', orderBy, props: { <column or card property>: false }, folded: [group keys],
//     layout: 'list' | 'board', and on a board: boardSort, boardFold: { <column key>: folded }, emptyCols,
//     colOrder: { <groupBy>: [column keys, as dragged] } (colorder.js) }
import { dayLabel, isoWeek, lateBy, monthLabel, monthOf, shiftWeek, thisWeek, today } from './dates.js';
import { GROUPS, NONE, PLAN_BUCKETS, ancestorsOf, projectOf } from './grouping.js';
import { byGoalRank } from './goals.js';
import {
  ACTIVITY_SOURCES, EXTERNAL_REF, PARENT_TYPES, PLANNABLE, PLAN_FILTERS, PRIORITIES, PRIORITY_RANK, TYPE_DEFS, anyStatusRank, hasExternalRef,
  hasField, isDone, labelsOf, planFilter, statusesOf,
} from './rules.js';

export const DEFAULT_VIEW = Object.freeze({
  v: 2, filters: [], groupBy: null, orderInGroups: null, showEmpty: false, closed: 'none', orderBy: null, props: {}, folded: [],
  layout: 'list', cards: {},
});
export const fresh = () => ({ ...DEFAULT_VIEW, filters: [], props: {}, folded: [], cards: {} });

const uniq = (xs) => [...new Set(xs)];
/** An item's labels (its `labels` field). */
const labelsOfItem = (i) => (Array.isArray(i.fields.labels) ? i.fields.labels : []);
const DATE_VALUES = [['today', 'Today'], ['week', 'This week'], ['nextweek', 'Next week'], ['month', 'This month']];
const DUE_VALUES = [['overdue', 'Overdue'], ['today', 'Today'], ['week', 'This week'], [NONE, 'No due date']];
// A plain field the structure keeps in `props` (a select, a set of checks) filters as its options; these are drawn by
// fields of their own.
const OWN = new Set(['status', 'priority', 'project', 'labels', 'source', 'related_to', 'date', 'due']);

/** The spans a date falls in among DATE_VALUES (a meeting's date: Today, This week, Next week, This month). */
function dateKeys(d, now = today()) {
  if (!d) return [];
  const out = [];
  if (d === now) out.push('today');
  if (isoWeek(d) === isoWeek(now)) out.push('week');
  if (isoWeek(d) === shiftWeek(isoWeek(now), 1)) out.push('nextweek');
  if (monthOf(d) === monthOf(now)) out.push('month');
  return out;
}
function dueKeys(item, now = today()) {
  const d = item.fields.due;
  if (!d) return [NONE];
  const out = [];
  if (d < now && !isDone(item)) out.push('overdue');
  if (d === now) out.push('today');
  if (isoWeek(d) === thisWeek()) out.push('week');
  return out;
}

/**
 * The fields a page of these types can filter by, from the vault's structure: [{ key, label, kind, multi?,
 * values(ctx, items) → [{ value, label }], of(item, ctx) → [values it holds] }]. `kind` tells the bar how to draw a
 * value: 'status' (a dot), 'priority', 'project', 'item' (a type's icon), or 'plain'. An item may hold several values
 * (its labels; an item under an initiative holds that initiative and every one above it), and passes "is" when it
 * holds any picked one.
 */
export function filterFields(types, ctx = {}) {
  const defs = types.map((t) => TYPE_DEFS[t]).filter(Boolean);
  const any = (field) => types.some((t) => hasField(t, field));
  const out = [];
  if (types.length > 1) {
    out.push({ key: 'type', label: 'Type', kind: 'item', values: () => defs.map((d) => ({ value: d.name, label: d.plural })), of: (i) => [i.type] });
  }
  const statuses = uniq(types.flatMap(statusesOf));
  if (statuses.length && defs.some((d) => d.statuses?.length)) {
    out.push({
      key: 'status', label: 'Status', kind: 'status',
      values: () => [...statuses].sort((a, b) => anyStatusRank(a) - anyStatusRank(b)).map((s) => ({ value: s, label: s })),
      of: (i) => [i.fields.status || 'Backlog'],
    });
  }
  if (any('priority')) {
    out.push({ key: 'priority', label: 'Priority', kind: 'priority', values: () => PRIORITIES.map((p) => ({ value: p, label: p })), of: (i) => [i.fields.priority || 'Normal'] });
  }
  if (any('project')) {
    out.push({
      key: 'project', label: 'Project', kind: 'project',
      values: (c, items = []) => {
        const keys = uniq([...(c.projects || []), ...items.map(projectOf).filter(Boolean)]);
        const name = c.projectName || ((k) => k);
        return [...keys.sort((a, b) => name(a).localeCompare(name(b))).map((k) => ({ value: k, label: name(k) })), { value: NONE, label: 'No project' }];
      },
      of: (i) => [projectOf(i)],
    });
  }
  const parents = uniq(defs.flatMap((d) => d.parents || []));
  const byId = (c) => c.byId || new Map();
  const items = (c, type) => [...byId(c).values()].filter((i) => (type ? i.type === type : parents.includes(i.type)));
  if (parents.includes('initiative')) {
    out.push({
      key: 'initiative', label: 'Initiative', kind: 'item',
      values: (c) => [...items(c, 'initiative').sort((a, b) => a.title.localeCompare(b.title)).map((i) => ({ value: i.id, label: i.title, type: i.type })),
        { value: NONE, label: 'No initiative' }],
      // Under an initiative at any depth: through a story, a task, or a sub-initiative.
      of: (i, c) => { const up = ancestorsOf(i, byId(c)).filter((p) => p.type === 'initiative').map((p) => p.id); return up.length ? up : [NONE]; },
    });
  }
  if (any('goal')) { // Projects: the goal an item names; its open goals in their order, then No goal
    out.push({
      key: 'goal', label: 'Goal', kind: 'item',
      values: (c) => [...items(c, 'goal').filter((g) => !isDone(g)).sort(byGoalRank).map((g) => ({ value: g.id, label: g.title, type: 'goal' })),
        { value: NONE, label: 'No goal' }],
      of: (i) => [i.type === 'goal' ? i.id : i.fields.goal || NONE],
    });
  }
  if (parents.some((p) => p !== 'initiative')) {
    const label = defs.length === 1 && defs[0].parent_label ? defs[0].parent_label : 'Parent';
    out.push({
      key: 'parent', label, kind: 'item',
      values: (c) => [...items(c).sort((a, b) => a.title.localeCompare(b.title)).map((i) => ({ value: i.id, label: i.title, type: i.type })),
        { value: NONE, label: `No ${label.toLowerCase()}` }],
      of: (i, c) => { const up = ancestorsOf(i, byId(c)).map((p) => p.id); return up.length ? up : [NONE]; },
    });
  }
  if (defs.some((d) => d.plannable)) {
    const plans = Object.entries(PLAN_FILTERS).filter(([k]) => k !== 'any');
    out.push({ key: 'plan', label: 'Planned', kind: 'plain', values: () => plans.map(([k, f]) => ({ value: k, label: f.label })), of: (i) => plans.filter(([k]) => planFilter(k)(i)).map(([k]) => k) });
  }
  if (any('due') && defs.some((d) => d.plannable)) {
    out.push({ key: 'due', label: 'Due date', kind: 'plain', values: () => DUE_VALUES.map(([value, label]) => ({ value, label })), of: (i, c) => dueKeys(i, c.today) });
  }
  if (defs.some((d) => d.list?.scopes === 'date')) {
    out.push({ key: 'date', label: 'Date', kind: 'plain', values: () => DATE_VALUES.map(([value, label]) => ({ value, label })), of: (i, c) => dateKeys(i.fields.date, c.today) });
  }
  if (any('source')) {
    out.push({ key: 'source', label: 'Source', kind: 'plain', values: () => ACTIVITY_SOURCES.map((s) => ({ value: s, label: s })), of: (i) => [i.fields.source || NONE] });
  }
  for (const p of uniq(defs.flatMap((d) => (d.props || []).filter((q) => ['select', 'checks'].includes(q.kind) && q.options?.length && !OWN.has(q.key)).map((q) => q.key)))) {
    const prop = defs.flatMap((d) => d.props || []).find((q) => q.key === p);
    out.push({
      key: `prop:${p}`, label: prop.label, kind: 'plain',
      values: () => [...prop.options.filter(([v]) => v !== '').map(([value, label]) => ({ value, label })), { value: NONE, label: 'Empty' }],
      of: (i) => { const v = i.fields[p]; const vs = Array.isArray(v) ? v : v == null || v === '' ? [] : [String(v)]; return vs.length ? vs : [NONE]; },
    });
  }
  if (any('labels')) {
    out.push({
      key: 'labels', label: 'Labels', kind: 'label',
      values: (c, its = []) => [...uniq([...(c.labels || []), ...its.flatMap(labelsOfItem)]).sort((a, b) => a.localeCompare(b)).map((l) => ({ value: l, label: l })),
        { value: NONE, label: 'No labels' }],
      of: (i) => { const ls = labelsOfItem(i); return ls.length ? ls : [NONE]; },
    });
  }
  return out;
}

/**
 * Whether an item passes every filter: "is" when it holds any of the picked values, "is not" when it holds none of
 * them. A filter on a field this page does not have, or with nothing picked, lets everything through.
 */
export function matches(item, filters, fields, ctx = {}) {
  return filters.every((f) => {
    const field = fields.find((x) => x.key === f.field);
    if (!field || !f.values?.length) return true;
    const held = field.of(item, ctx);
    // `all`: every picked value (labels a and b), not any of them (an old "All (AND)" label filter).
    const hit = f.all ? f.values.every((v) => held.includes(v)) : f.values.some((v) => held.includes(v));
    return f.op === 'isnot' ? !hit : hit;
  });
}

/** How many of the items hold each value of a field: { value: n } (a value nobody holds is absent: 0). */
export function valueCounts(items, field, ctx = {}) {
  const out = {};
  for (const i of items) for (const v of uniq(field.of(i, ctx))) out[v] = (out[v] || 0) + 1;
  return out;
}

/** A filter as its chip says it, in two parts: what and how ("Status is") and the values' labels ("Backlog, To do"). */
export function filterParts(f, fields, ctx = {}, items = []) {
  const field = fields.find((x) => x.key === f.field);
  if (!field) return null;
  const names = new Map(field.values(ctx, items).map((v) => [v.value, v.label]));
  return { head: `${field.label} ${f.op === 'isnot' ? 'is not' : 'is'}`, values: f.values.map((v) => names.get(v) ?? v).join(', ') };
}

/** "Status is Backlog, To do": a filter as one line. */
export function filterText(f, fields, ctx = {}, items = []) {
  const p = filterParts(f, fields, ctx, items);
  return p ? `${p.head} ${p.values}` : '';
}

// ── grouping ─────────────────────────────────────────────────────────────────
/** The ways a page of these types can group: its structure's list `group_by` (Status, Priority, Project,
 *  Initiative, Planned) — the first type's on a page of several — and Label wherever the items have labels. */
export function groupOptions(types) {
  const defs = types.map((t) => TYPE_DEFS[t]).filter(Boolean);
  const keys = uniq(defs.flatMap((d) => d.list?.group_by || [])).filter((k) => GROUPS[k]);
  if (types.some((t) => hasField(t, 'labels'))) keys.push('label');
  return keys;
}
export const groupLabel = (key) => (key === 'label' ? 'Label' : GROUPS[key]?.label || 'None');

/**
 * Items in groups: [{ key, items }] in the group's order (the rows with no value last). Grouped by label an item sits
 * in each of its labels' groups. `keys` are the group keys to show even with no item (Show empty groups: a type's
 * statuses, the priorities…); `sort` orders the items inside each group; a group's `lead` (an initiative heading its
 * own tree) goes first.
 */
export function groupItems(items, by, { byId = new Map(), projectName, sort = null, showEmpty = false, keys = [] } = {}) {
  const g = by === 'label' ? null : GROUPS[by];
  const keysOf = by === 'label' ? (i) => { const ls = labelsOfItem(i); return ls.length ? ls : [NONE]; } : (i) => [g.by(i, byId)];
  const groups = new Map();
  if (showEmpty) for (const k of keys) groups.set(k, []);
  for (const i of items) for (const k of keysOf(i)) { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
  const order = by === 'label' ? (a, b) => (a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b)) : (a, b) => g.order(a, b, byId, projectName);
  return [...groups.keys()].sort(order).map((key) => {
    const rows = sort ? [...groups.get(key)].sort(sort) : groups.get(key);
    const lead = g?.lead ? rows.findIndex((i) => g.lead(key, i)) : -1;
    return { key, items: lead > 0 ? [rows[lead], ...rows.slice(0, lead), ...rows.slice(lead + 1)] : rows };
  });
}

/** The keys a field's values give a group by it (Show empty groups): a status, priority, project… with no item.
 *  Planned groups by its buckets (Overdue, Today… Unplanned), not by the filter's values; Planned before only holds
 *  closed items, so it never shows empty. */
export function emptyKeys(by, fields, ctx = {}, items = []) {
  if (by === 'plan') return PLAN_BUCKETS.map(([k]) => k).filter((k) => k !== 'past');
  const field = fields.find((f) => f.key === (by === 'label' ? 'labels' : by));
  return field ? field.values(ctx, items).map((v) => v.value) : [];
}

// ── closed items ─────────────────────────────────────────────────────────────
const WEEK_MS = 7 * 24 * 3600 * 1000;
/** When an item was closed: its completed_at (or resolved_at), else when it last changed. */
const closedOn = (i) => i.fields.completed_at || i.fields.resolved_at || i.fields.updated_at || '';

/**
 * Display → Show closed: 'none' keeps only the open items, 'week' adds those closed in the last seven days, 'all'
 * keeps every one. Returns { items, hidden } — `hidden` how many closed ones were left out ("12 closed are hidden").
 */
export function closedShown(items, mode, { isClosed = isDone, now = Date.now() } = {}) {
  if (mode === 'all') return { items, hidden: 0 };
  const out = items.filter((i) => !isClosed(i) || (mode === 'week' && now - Date.parse(closedOn(i)) <= WEEK_MS));
  return { items: out, hidden: items.length - out.length };
}

/** The closed items after the open ones, each part keeping its order (closed rows go grey at a group's end). */
export const closedLast = (items, isClosed = isDone) => [...items.filter((i) => !isClosed(i)), ...items.filter(isClosed)];

// ── which columns a list shows ───────────────────────────────────────────────
// The columns a list leaves out until Display → Show columns turns them on: Goal (Projects), shown by its own view.
export const COLUMNS_OFF = new Set(['goal']);
/** Whether a list shows column `key`, by its view's Show columns (`props`: true or false where it was picked). */
export const columnOn = (props, key) => (COLUMNS_OFF.has(key) ? props?.[key] === true : props?.[key] !== false);

// ── columns on a narrow window ───────────────────────────────────────────────
// Never a sideways scroll: as the table narrows, its columns give way — first any beyond the core set, the right-most
// first, then Due, a parent (or meeting), Labels, Project, Initiative, Planned and Type. ID, Subject, Status and Priority
// always stay.
const CORE = new Set(['pick', 'id', 'subject', 'subjectPlain', 'status', 'priority']);
const LATE = [['goal'], ['start'], ['due'], ['parent', 'meetingOf'], ['labels'], ['project'], ['initiative'], ['plan'], ['type']];
export const SUBJECT_MIN = 220;

/** The keys of the columns to hide so the rest fit `width`: columns [{ key, width }] (the subject's is its least). */
export function hiddenColumns(columns, width, { subjectMin = SUBJECT_MIN } = {}) {
  const w = (c) => (c.key === 'subject' || c.key === 'subjectPlain' ? Math.max(subjectMin, c.width || 0) : c.width || 0);
  let total = columns.reduce((n, c) => n + w(c), 0);
  const order = [
    ...columns.filter((c) => !CORE.has(c.key) && !LATE.flat().includes(c.key)).reverse().map((c) => [c.key]),
    ...LATE,
  ];
  const hidden = [];
  for (const keys of order) {
    if (total <= width) break;
    for (const c of columns.filter((x) => keys.includes(x.key))) { total -= w(c); hidden.push(c.key); }
  }
  return hidden;
}

/**
 * The order a list draws its columns in, whatever order the structure lists them: the box, ID, Subject, Status, the
 * priority (or a level), what it hangs from (Initiative, Project, its parent, a meeting), Planned, Due (a meeting's Date,
 * Time, Duration), Labels; then a type's own columns (Size, Severity…) in the structure's order; Resolved, Created and
 * Updated last. Sorting is stable, so two of a rank keep theirs.
 */
const COLUMN_RANK = ['pick', 'id', 'subject', 'subjectPlain', 'type', 'status', 'state', 'priority', 'prop:level', 'goal', 'initiative', 'project', 'parent', 'meetingOf',
  'plan', 'start', 'due', 'date', 'time', 'duration', 'attendees', 'source', 'from', 'labels'];
const COLUMN_LAST = ['resolved', 'created_at', 'updated_at']; // after a type's own columns, in every list
export function columnOrder(columns) {
  const rank = (c) => {
    const r = COLUMN_RANK.indexOf(c.key);
    if (r >= 0) return r;
    const last = COLUMN_LAST.indexOf(c.key);
    return last >= 0 ? COLUMN_RANK.length + 1 + last : COLUMN_RANK.length;
  };
  return columns.map((c, n) => [c, n]).sort(([a, x], [b, y]) => rank(a) - rank(b) || x - y).map(([c]) => c);
}

/**
 * The column a table's sort ({ col, dir }) orders by: `sort.col` among `columns`, every column it may name, shown or
 * not (one left out for width, or turned off in Display, still orders the rows); not there, the first of them.
 */
export function sortColumn(sort, columns) {
  return columns.find((c) => c.key === sort?.col) || columns[0];
}

/**
 * A row's Planned, short: "Today", "Tue 10", "W45", "Nov", or "Not planned"; past its plan, how late
 * ("19 d late", dates.js lateBy) with `late` set, for red.
 */
export function planText(fields = {}) {
  const late = lateBy(fields);
  if (late) return { text: late.text, late: true, since: late.since };
  const { plan_day: day, plan_week: week, plan_month: month } = fields;
  if (day) return { text: day === today() ? 'Today' : dayLabel(day), late: false };
  if (week) return { text: week === thisWeek() ? 'This week' : week.split('-')[1], late: false };
  if (month) return { text: monthLabel(month, true), late: false };
  return { text: 'Not planned', late: false, none: true };
}

// ── a saved view of before (filters panel and Open / Closed / All) ───────────
/** A saved view's filters without Tomorrow, a Planned and a Date value no more: a filter left with no value goes. */
const withoutTomorrow = (filters) => filters
  .map((f) => (['plan', 'date'].includes(f.field) ? { ...f, values: (f.values || []).filter((v) => v !== 'tomorrow') } : f))
  .filter((f) => !['plan', 'date'].includes(f.field) || f.values.length);

/**
 * A view saved before this bar (version 1: `scope`, `status`, `priority`, `related`, `project`, `initiative`, `plan`,
 * `labels`, `source`, `groupBy`), as the bar's: the same items show. A meeting's date scope becomes a Date filter;
 * Open is closed hidden, All every one, Closed every one too (the bar keeps no "closed only").
 */
// ── what a board's cards show (Display → Show on cards) ───────────────────
/** Off on a fresh board: the card stays short (priority, plan and where it hangs show; Display turns the rest on). */
export const CARD_OFF = new Set(['id', 'labels', 'due', 'project', 'extref']);

/** The properties a card of these types can show, [[key, label]], as Display lists them (the mockup's order): the
 *  meta row's first (status, priority, id, planned, due, labels), then the line under the title (what it hangs from, its
 *  project), and the tracker's ticket. */
export function cardProps(types) {
  const any = (f) => types.some(f);
  const parents = uniq(types.flatMap((t) => PARENT_TYPES[t] || []));
  return [
    any((t) => hasField(t, 'status')) ? ['status', 'Status'] : null,
    any((t) => hasField(t, 'priority')) ? ['priority', 'Priority'] : null,
    ['id', 'ID'],
    any((t) => PLANNABLE.has(t)) ? ['plan', 'Planned'] : null,
    any((t) => hasField(t, 'due')) ? ['due', 'Due'] : null,
    any((t) => hasField(t, 'labels')) ? ['labels', 'Labels'] : null,
    parents.length ? ['parent', parents.length === 1 ? TYPE_DEFS[parents[0]]?.label || 'Parent' : 'Parent'] : null,
    any((t) => hasField(t, 'project') && t !== 'project') ? ['project', 'Project'] : null,
    any(hasExternalRef) ? ['extref', EXTERNAL_REF.label || 'Ticket'] : null,
  ].filter(Boolean);
}

/** Whether a board's cards show `key`: what the view says (view.cards), else its default. */
export const cardShows = (view, key) => (view?.cards && key in view.cards ? !!view.cards[key] : !CARD_OFF.has(key));

export function migrateView(old) {
  if (!old) return fresh();
  if (old.v === 2) return { ...fresh(), ...old, props: { ...(old.props || {}) }, cards: { ...(old.cards || {}) }, filters: withoutTomorrow(old.filters || []), folded: old.folded || [] };
  const view = fresh();
  const add = (field, values) => { if (values?.length) view.filters.push({ field, op: 'is', values }); };
  add('status', old.status);
  add('priority', old.priority);
  if (old.project) add('project', [old.project]);
  if (old.initiative) add('initiative', [old.initiative]);
  if (old.related) add('parent', [old.related]);
  if (old.plan && old.plan !== 'any') add('plan', [old.plan]);
  add('labels', labelsOf(old));
  if (old.labelMode === 'and') { const f = view.filters.find((x) => x.field === 'labels'); if (f) f.all = true; }
  if (old.source) add('source', [old.source]);
  if (['today', 'week'].includes(old.scope)) add('date', [old.scope]); // Tomorrow is gone: that view shows every date
  view.closed = old.scope === 'open' ? 'none' : 'all';
  view.groupBy = old.groupBy || null;
  return view;
}

/** A view with the filters this page cannot apply dropped (a field it does not have) and a group it does not offer
 *  reset: what a saved view keeps when the structure changes under it. */
export function fitView(view, fields, groups) {
  const keys = new Set(fields.map((f) => f.key));
  return {
    ...view,
    filters: view.filters.filter((f) => keys.has(f.field) && f.values?.length),
    groupBy: view.groupBy && groups.includes(view.groupBy) ? view.groupBy : null,
  };
}

/** Priority order, for "Order by" and "Order in groups" (Urgent first). */
export const byPriorityRank = (a, b) => (PRIORITY_RANK[a.fields.priority || 'Normal'] || 9) - (PRIORITY_RANK[b.fields.priority || 'Normal'] || 9);
