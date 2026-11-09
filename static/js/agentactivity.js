// The agents' activity, for the whole page: every run on this computer with what it is doing now (GET
// /api/agents/activity, server.py agent_activity), looked at again every 5 s while one is live and every minute
// otherwise. What reads it: the Inbox page (views/runs.js), the sidebar's Inbox row and its marks (agentspane.js), and
// the badge on the Agents mode's button (sidebar.js). A run that starts waiting for you, or ends, is told here
// (term.js notify) unless the dock shows it — the dock tells about its own sessions. A run is read once its result is
// seen: opened from the Inbox, or watched to the end in the dock.
import { api } from './api.js';
import { agentHref } from './agentsmodel.js';
import { inboxCount, runStatus } from './runmodel.js';
import { setModeBadge } from './sidebar.js';
import { notify, resumeClaudeHere, termIsLive, termShowing } from './term.js';

const LIVE_EVERY = 5000;
const IDLE_EVERY = 60000;

let data = null;      // { runs, counts }, once the server answered
let sig = '';
let timer = null;
let loading = null;
let seen = null;      // id → status at the last look (null before the first: those are not news)
const listeners = new Set();

/** The latest activity, or null before the first answer. */
export const activity = () => data;

/** Calls `fn(activity)` whenever it changes. → a function that stops it. */
export function onActivity(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Looks again now (a run started, one was read) and goes on at the pace of what is live. */
export function refreshActivity() {
  if (loading) return loading;
  clearTimeout(timer);
  loading = api.agentActivity().then((next) => {
    const now = JSON.stringify(next);
    if (now !== sig) {
      sig = now;
      data = next;
      announce(next.runs || []);
      paintBadge();
      listeners.forEach((fn) => fn(data));
    }
    readShown(next.runs || []);
  }).catch(() => { /* the server away for a moment: the next look tells */ }).finally(() => {
    loading = null;
    timer = setTimeout(refreshActivity, data?.runs?.some((r) => r.live) ? LIVE_EVERY : IDLE_EVERY);
  });
  return loading;
}

/** Marks runs read (their result seen) and looks again. */
export async function markRead(ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return;
  try { await api.agentRunsRead(list); } catch { return; }
  sig = '';
  await refreshActivity();
}

/** Where a run is opened from a notice or the Inbox: in the dock while it waits for you or works (to answer it, to
 *  watch it), else its detail on its agent's page — what it did, and what it changed. */
export async function openRun(r) {
  const st = runStatus(r);
  if (r.live && (st === 'needs_you' || st === 'working')) {
    try { await resumeClaudeHere(null, r.id); } catch { return; } // toasted by term.js
  } else {
    location.hash = `${agentHref(r.dir, r.cmd)}?run=${encodeURIComponent(r.id)}`;
  }
  if (r.outcome && !r.read_at) markRead([r.id]);
}

const NEWS = { needs_you: 'needs you', done: 'finished', failed: 'failed' };

/** A run whose status changed since the last look: told when it waits for you now, or has just ended — unless it is a
 *  session of the dock, which tells about it itself. */
function announce(runs) {
  const before = seen;
  seen = Object.fromEntries(runs.map((r) => [r.id, runStatus(r)]));
  if (!before) return;
  for (const r of runs) {
    const st = seen[r.id];
    const was = before[r.id];
    if (st === was || termIsLive(r.id)) continue;
    const what = st === 'needs_you' ? NEWS.needs_you : was === 'working' || was === 'needs_you' ? NEWS[st] : '';
    if (what) notify(`/${r.cmd}${r.args ? ` ${r.args}` : ''}`, what, r.id, () => openRun(r));
  }
}

/** A run that ended while you watched it in the dock is read: you saw its result there. */
function readShown(runs) {
  const ids = runs.filter((r) => r.outcome && !r.read_at && runStatus(r) !== 'working' && termShowing(r.id)).map((r) => r.id);
  if (ids.length) markRead(ids);
}

function paintBadge() {
  const counts = data?.counts || {};
  setModeBadge('agents', inboxCount(counts), counts.needs_you ? 'warning' : 'accent');
}

/** From page load: the first look, then on by itself. */
export function initActivity() {
  refreshActivity();
  // Back on the page: look now rather than at the next tick.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshActivity(); });
}
