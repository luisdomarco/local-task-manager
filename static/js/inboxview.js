// The Inbox's view, as a list's (viewmodel.js) but over agent runs instead of items: what Filter offers, what Group can
// group by, what Order sorts by and which columns Display can hide. Pure: no DOM and no state (the agent folders come in
// `ctx`), so it is tested on its own (tests/js/inboxview.test.mjs). The page that draws it is views/runs.js.
//
// A run is what GET /api/agents/activity gives (runmodel.js): { id, dir, dir_name, cmd, args, at, started_ts, ended_ts,
// cost, source, target, worktree, outcome, read_at, live, busy, pending, … }.
import { relDay } from './dates.js';
import { RUN_SOURCES, RUN_STATUSES, groupActivity, isUnread, runStatus } from './runmodel.js';

/** Where a run was started: 'here' (this app), 'terminal' or 'schedule' (RUN_SOURCES). */
export const runSource = (r) => r.source || r.target || 'here';
const SOURCE_NAME = Object.fromEntries(RUN_SOURCES);
export const sourceLabel = (r) => SOURCE_NAME[runSource(r)] || runSource(r);

/** How long it took: from its start to its end, or to `now` while it goes on in this app; null when that is not known
 *  (it never started, or it runs in Terminal, out of this app's sight). */
export function runMs(r, now = Date.now()) {
  if (!r.started_ts) return null;
  if (r.ended_ts) return r.ended_ts - r.started_ts;
  return r.live ? now - r.started_ts : null;
}

const STATUS_KEYS = Object.keys(RUN_STATUSES);
const SEEN = [['unread', 'Unread'], ['seen', 'Seen']];
const WHERE = [['here', 'Its folder'], ['worktree', 'A worktree']];
const pairs = (list) => list.map(([value, label]) => ({ value, label }));

/**
 * Filter's fields, in viewbar.js's shape ({ key, label, kind, values(ctx, rows), of(row) }): Status (with its dot's
 * `tone`), Folder (`ctx.dirs`, the agent folders, then any other a run names), Agent, Started from, Seen and Where.
 */
export function inboxFields(ctx = {}) {
  const { dirs = [] } = ctx;
  return [
    { key: 'status', label: 'Status', kind: 'run-status', values: () => STATUS_KEYS.map((k) => ({ value: k, label: RUN_STATUSES[k].label, tone: RUN_STATUSES[k].tone })), of: (r) => [runStatus(r)] },
    {
      key: 'folder', label: 'Folder', kind: 'plain',
      values: (_, rows = []) => {
        const named = new Map(dirs.map((d) => [d.id, d.name]));
        for (const r of rows) if (r.dir && !named.has(r.dir)) named.set(r.dir, r.dir_name || r.dir);
        return [...named].map(([value, label]) => ({ value, label }));
      },
      of: (r) => [r.dir].filter(Boolean),
    },
    { key: 'agent', label: 'Agent', kind: 'plain', values: (_, rows = []) => [...new Set(rows.map((r) => r.cmd).filter(Boolean))].sort().map((c) => ({ value: c, label: `/${c}` })), of: (r) => [r.cmd].filter(Boolean) },
    { key: 'source', label: 'Started from', kind: 'plain', values: () => pairs(RUN_SOURCES), of: (r) => [runSource(r)] },
    { key: 'seen', label: 'Seen', kind: 'plain', values: () => pairs(SEEN), of: (r) => [isUnread(r) ? 'unread' : 'seen'] },
    { key: 'where', label: 'Where', kind: 'plain', values: () => pairs(WHERE), of: (r) => [r.worktree ? 'worktree' : 'here'] },
  ];
}

/** What Group can group by; Attention (Needs you · Running · Unread · Earlier) is the default. */
export const INBOX_GROUPS = [['attention', 'Attention'], ['status', 'Status'], ['folder', 'Folder'], ['agent', 'Agent'], ['day', 'Day'], ['source', 'Started from']];
export const inboxGroupLabel = (key) => INBOX_GROUPS.find(([k]) => k === key)?.[1] || 'None';

/** What Order sorts by: each is a column too (its header sorts by it). Started, newest first, is the default. */
export const INBOX_ORDERS = [['started', 'Started'], ['status', 'Status'], ['run', 'Agent'], ['folder', 'Folder'], ['source', 'Started from'], ['time', 'Time'], ['cost', 'Cost']];

/** The columns Display can hide (the run itself always shows). */
export const INBOX_PROPS = [['status', 'Status'], ['folder', 'Folder'], ['source', 'Started from'], ['time', 'Time'], ['cost', 'Cost'], ['started', 'Started']];

/** A run's value to sort by, for each of INBOX_ORDERS: status in the Inbox's order (what needs you first). */
export function orderValue(key, r, now = Date.now()) {
  switch (key) {
    case 'status': return STATUS_KEYS.indexOf(runStatus(r));
    case 'run': return `${r.cmd || ''} ${r.args || ''}`.toLowerCase();
    case 'folder': return (r.dir_name || r.dir || '').toLowerCase();
    case 'source': return RUN_SOURCES.findIndex(([k]) => k === runSource(r));
    case 'time': return runMs(r, now) ?? -1;
    case 'cost': return Number(r.cost) || 0;
    default: return r.started_ts || Date.parse(r.at || '') || 0; // started
  }
}

/** The runs sorted by `key` (`dir` 1 up, -1 down); equal ones keep their order (the server's: newest first). */
export function sortRuns(runs, key = 'started', dir = -1, now = Date.now()) {
  return runs.map((r, i) => [orderValue(key, r, now), i, r])
    .sort(([a, i], [b, j]) => (a < b ? -1 : a > b ? 1 : 0) * dir || i - j)
    .map(([, , r]) => r);
}

/** The day a run started on, as YYYY-MM-DD (its `at`, this Mac's time). */
const dayOf = (r) => String(r.at || '').slice(0, 10);

/**
 * The runs in groups: [[key, rows]], each group's rows in the order they come (sort them first). Attention and status
 * go in the Inbox's order, sources in RUN_SOURCES's, folders in `ctx.dirs`'s (any other after them), agents A–Z and days
 * newest first. `by` null: one group, key null. Empty groups are left out.
 */
export function groupRuns(runs, by, ctx = {}) {
  if (!by) return [[null, runs]];
  if (by === 'attention') return groupActivity(runs).map((g) => [g.key, g.runs]);
  const keyOf = { status: runStatus, folder: (r) => r.dir || '', agent: (r) => r.cmd || '', day: dayOf, source: runSource }[by];
  if (!keyOf) return [[null, runs]];
  const groups = new Map();
  for (const r of runs) {
    const k = keyOf(r);
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
  }
  const rankBy = (order) => (k) => (order.includes(k) ? order.indexOf(k) : order.length);
  const rank = {
    status: rankBy(STATUS_KEYS),
    source: rankBy(RUN_SOURCES.map(([k]) => k)),
    folder: rankBy((ctx.dirs || []).map((d) => d.id)),
  }[by];
  return [...groups].sort(([a], [b]) => {
    if (by === 'day') return b.localeCompare(a);
    return (rank ? rank(a) - rank(b) : 0) || a.localeCompare(b);
  });
}

const ATTENTION = { needs_you: 'Needs you', running: 'Running', unread: 'Unread', earlier: 'Earlier' }; // runmodel.js groupActivity's

/** A group's name in its head: "Needs you", "Done", a folder's name, "/hello", "Today" or "Nov 3", "Terminal". */
export function groupName(by, key, ctx = {}, rows = []) {
  if (by === 'attention') return ATTENTION[key] || key;
  if (by === 'status') return RUN_STATUSES[key]?.label || key;
  if (by === 'folder') return (ctx.dirs || []).find((d) => d.id === key)?.name || rows[0]?.dir_name || key || 'No folder';
  if (by === 'agent') return key ? `/${key}` : 'No agent';
  if (by === 'source') return SOURCE_NAME[key] || key;
  if (by === 'day') return key ? relDay(key) : 'No date';
  return String(key ?? '');
}

/** The dot's tone (app.css .td-dot.tone-*) of a group that is a status or the Inbox's attention; null for the rest. */
export function groupTone(by, key) {
  if (by === 'status') return RUN_STATUSES[key]?.tone || null;
  if (by === 'attention') return { needs_you: 'warning', running: 'accent', unread: 'accent' }[key] || null;
  return null;
}

/**
 * The view as kept before the view bar: { status, dir, source } (a select each) → its filters, so a choice made then
 * still applies. Anything else gives none.
 */
export function filtersFromOld(old) {
  if (!old || typeof old !== 'object') return [];
  return [['status', old.status], ['folder', old.dir], ['source', old.source]]
    .filter(([, v]) => typeof v === 'string' && v)
    .map(([field, v]) => ({ field, op: 'is', values: [v] }));
}
