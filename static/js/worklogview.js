// The Work log's view, as a list's (viewmodel.js) but over log rows instead of items: what Filter offers, what Group
// can group by, which columns Display can hide. Pure: no DOM and no state (what a field needs from the vault comes in
// `ctx`), so it is tested on its own (tests/js/worklogview.test.mjs). The page that draws it is views/log.js.
//
// A row is a log entry ({ id, date, time, kind, note, at, status? }) or a suggestion ({ ..., suggested: true }).
import { isoWeek, relDay, weekLabel } from './dates.js';
import { isTentative, sumTime } from './worktime.js';

/** What a row is: logged (it counts), tentative (proposed, not counted until confirmed) or suggested (not logged). */
export const rowState = (r) => (r.suggested ? 'suggested' : isTentative(r) ? 'tentative' : 'logged');
const STATES = [['logged', 'Logged'], ['tentative', 'Tentative'], ['suggested', 'Suggested']];

/**
 * Filter's fields, in viewbar.js's shape ({ key, label, kind, values(), of(row) }): Kind (the vault's kinds of work,
 * then any other a row holds), Entry (logged, tentative, suggested) and Item type (`ctx.typeOf(id)`, its name
 * `ctx.typeName(type)`; an item deleted for good has none).
 */
export function logFields(ctx) {
  const { kinds = [], typeOf = () => null, typeName = (t) => t } = ctx;
  return [
    { key: 'kind', label: 'Kind', kind: 'plain', values: (_, rows = []) => [...new Set([...kinds, ...rows.map((r) => r.kind)])].map((k) => ({ value: k, label: k })), of: (r) => [r.kind] },
    { key: 'entry', label: 'Entry', kind: 'plain', values: () => STATES.map(([value, label]) => ({ value, label })), of: (r) => [rowState(r)] },
    {
      key: 'type', label: 'Item type', kind: 'item',
      values: (_, rows = []) => [...new Set(rows.map((r) => typeOf(r.id)).filter(Boolean))].sort().map((t) => ({ value: t, label: typeName(t), type: t })),
      of: (r) => [typeOf(r.id)].filter(Boolean),
    },
  ];
}

/** What Group can group by; Day is the default. */
export const LOG_GROUPS = [['day', 'Day'], ['week', 'Week'], ['item', 'Item'], ['kind', 'Kind']];
export const logGroupLabel = (key) => LOG_GROUPS.find(([k]) => k === key)?.[1] || 'None';

/** The columns Display can hide. Date shows only when the rows are not grouped by day, Kind when not by kind. */
export const LOG_PROPS = [['date', 'Date'], ['kind', 'Kind'], ['note', 'Notes'], ['at', 'Logged at']];

const keyOf = { day: (r) => r.date, week: (r) => isoWeek(r.date), item: (r) => r.id, kind: (r) => r.kind };
/** Newest first: by day, then by when it was logged (a suggestion, which has no time, after the day's entries). */
export const byNewest = (a, b) => b.date.localeCompare(a.date) || (b.at || '').localeCompare(a.at || '');

/**
 * The rows in groups: [[key, rows]], each group's rows newest first. Days and weeks go newest first; items by their
 * latest row; kinds in the order of `kinds` (the vault's), any other after them. `by` null: one group, key null.
 */
export function logGroups(rows, by, { kinds = [] } = {}) {
  const sorted = [...rows].sort(byNewest);
  if (!by || !keyOf[by]) return [[null, sorted]];
  const groups = new Map();
  for (const r of sorted) {
    const k = keyOf[by](r);
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
  }
  const out = [...groups];
  if (by === 'day' || by === 'week') out.sort((a, b) => b[0].localeCompare(a[0]));
  else if (by === 'kind') {
    const rank = (k) => (kinds.includes(k) ? kinds.indexOf(k) : kinds.length);
    out.sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
  }
  // by item: already in the order of each one's latest row (Map keeps the first seen, and the rows are newest first)
  return out;
}

/** A day's or a week's name in its group's head: "Today", "Nov 3"; "W45 · Nov 3 – Nov 9". */
export const groupName = (by, key) => (by === 'day' ? relDay(key) : by === 'week' ? weekLabel(key) : String(key ?? ''));

/** What a group's head says after its name: "3 entries · 02:30" (the time counts only logged rows). */
export function groupSummary(rows) {
  const logged = rows.filter((r) => rowState(r) === 'logged').length;
  return `${logged} entr${logged === 1 ? 'y' : 'ies'} · ${sumTime(rows.filter((r) => !r.suggested))}`;
}
