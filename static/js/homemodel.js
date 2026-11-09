// The Agents section's Home (views/agentshome.js), the pure part: which agents it offers, what runs now, what is
// scheduled next, what ended lately and the week in one line — all read from what the page already has (the activity
// of agentactivity.js, the agent folders, the schedules). No DOM here; tested in tests/js/homemodel.test.mjs.
import { agentKey } from './agentsmodel.js';
import { runStatus } from './runmodel.js';

const DAY = 86_400_000;
const ENDED = new Set(['done', 'failed', 'stopped']);

/** When a run started, in ms: its started_ts, or its `at` stamp for a record from before. */
export const startedAt = (r) => r?.started_ts || Date.parse(String(r?.at || '').replace(' ', 'T')) || 0;

/**
 * The agents Home offers under *Your agents*: the pinned ones first (in the order pinned), then the most run in the
 * last `days` days (ties: the latest run first), up to `limit` — every pinned one even past it; each { dir, dirName,
 * command, last (its newest run or null), count (its runs in those days), pinned }. Only agents still in the folders.
 */
export function yourAgents(dirs, runs, { pinned = [], limit = 6, days = 30, now = Date.now() } = {}) {
  const byKey = new Map();
  for (const d of dirs || []) for (const c of d.commands || []) byKey.set(agentKey(d.id, c.name), { dir: d.id, dirName: d.name, command: c, last: null, count: 0 });
  const since = now - days * DAY;
  for (const r of runs || []) { // newest first, as the server lists them
    const a = byKey.get(agentKey(r.dir, r.cmd));
    if (!a) continue;
    if (!a.last) a.last = r;
    if (startedAt(r) >= since) a.count += 1;
  }
  const out = [];
  const seen = new Set();
  for (const k of pinned || []) {
    const a = byKey.get(k);
    if (a && !seen.has(k)) { seen.add(k); out.push({ ...a, pinned: true }); }
  }
  const used = [...byKey.entries()].filter(([k, a]) => !seen.has(k) && a.count > 0)
    .sort(([, x], [, y]) => y.count - x.count || startedAt(y.last) - startedAt(x.last));
  for (const [, a] of used) out.push({ ...a, pinned: false });
  return out.slice(0, Math.max(limit, seen.size));
}

/** The runs going on now (working), the longest-running first. */
export const runningNow = (runs) => (runs || []).filter((r) => runStatus(r) === 'working').sort((a, b) => startedAt(a) - startedAt(b));

/** The runs that wait for you. */
export const needingYou = (runs) => (runs || []).filter((r) => runStatus(r) === 'needs_you');

/** The runs that ended, the latest to end first, at most `limit`. */
export function recentResults(runs, limit = 6) {
  return (runs || []).filter((r) => r.outcome && ENDED.has(runStatus(r)))
    .sort((a, b) => (b.ended_ts || startedAt(b)) - (a.ended_ts || startedAt(a))).slice(0, limit);
}

/** The schedules that fire next (not paused), soonest first, at most `limit`. */
export function upNext(schedules, limit = 5) {
  return (schedules || []).filter((s) => !s.paused && s.next_ts).sort((a, b) => a.next_ts - b.next_ts).slice(0, limit);
}

/** The last 7 days: { runs, done, failed, cost } of the runs started since. */
export function weekStats(runs, now = Date.now()) {
  const since = now - 7 * DAY;
  const out = { runs: 0, done: 0, failed: 0, cost: 0 };
  for (const r of runs || []) {
    if (startedAt(r) < since) continue;
    out.runs += 1;
    const st = runStatus(r);
    if (st === 'done') out.done += 1;
    if (st === 'failed') out.failed += 1;
    if (typeof r.cost === 'number') out.cost += r.cost;
  }
  return out;
}

/** The week in words: '23 runs · 20 done · 2 failed · $4.10' ('' with no run). */
export function weekLine({ runs, done, failed, cost }) {
  if (!runs) return '';
  return [`${runs} run${runs === 1 ? '' : 's'}`, done ? `${done} done` : '', failed ? `${failed} failed` : '',
    cost >= 0.01 ? `$${cost.toFixed(2)}` : ''].filter(Boolean).join(' · ');
}

/** One agent's runs (newest first) summed up for its page: { last (its newest run or null), runs, done, failed,
 *  success (done of those that ended done or failed, 0–1, or null with none), avgMs (the mean time of those that ended
 *  with both stamps, or null), cost } over the last `days` days — `last` whenever it ran. */
export function agentStats(runs, now = Date.now(), days = 30) {
  const since = now - days * DAY;
  const out = { last: (runs || [])[0] || null, runs: 0, done: 0, failed: 0, success: null, avgMs: null, cost: 0 };
  let took = 0;
  let timed = 0;
  for (const r of runs || []) {
    if (startedAt(r) < since) continue;
    out.runs += 1;
    const st = runStatus(r);
    if (st === 'done') out.done += 1;
    if (st === 'failed') out.failed += 1;
    if (typeof r.cost === 'number') out.cost += r.cost;
    if (r.ended_ts && r.started_ts && r.ended_ts >= r.started_ts) { took += r.ended_ts - r.started_ts; timed += 1; }
  }
  if (out.done + out.failed) out.success = out.done / (out.done + out.failed);
  if (timed) out.avgMs = Math.round(took / timed);
  return out;
}
