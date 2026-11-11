// An agent run, read for people: its status (one of RUN_STATUSES, a dot and a word as the dock draws a session's), the
// sentence under it ("Needs your OK to run Bash", "Done in 3m 10s · $0.42"), and the Activity page's groups. A run is
// what GET /api/agents/activity (server.py _run_now) gives: its record (tm/agentruns.py) and what its chat does now.
// No DOM here; tested in tests/js/runmodel.test.mjs.

// The dot (app.css .td-dot.tone-*) and the word of each status.
export const RUN_STATUSES = {
  needs_you: { label: 'Needs you', tone: 'warning' },
  working: { label: 'Working', tone: 'accent' },
  done: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'error' },
  stopped: { label: 'Stopped', tone: 'muted' },
  started: { label: 'Started', tone: 'muted' }, // opened in Terminal: this app cannot follow it
};

/**
 * The status of a run, from what it is doing now (`live`, `busy`, `pending`: server.py _run_now) and how its last turn
 * ended (`outcome` 'success' | 'error', `stopped`, `exit_code`: tm/agentruns.py).
 *  - a request waiting for an answer wins over everything: the run cannot go on without you;
 *  - a run working on a turn, or still starting its first, is working;
 *  - a run whose turn is over has ended as its turn did, even while its chat stays open in the dock for a reply (claude
 *    -p waits there for one): what it was asked to do is done, or failed;
 *  - a run in Terminal is out of sight: started, unless it recorded an outcome.
 */
export function runStatus(run) {
  if (!run) return 'stopped';
  if (run.pending > 0) return 'needs_you';
  if (run.live && (run.busy || !run.outcome)) return 'working';
  if (run.target === 'terminal' && !run.outcome) return 'started';
  return endedStatus(run);
}

/**
 * How a run that is over ended: 'done', 'failed' or 'stopped'. What it has to go on: `outcome` ('success' | 'error' |
 * undefined: no turn ever finished), `stopped` (you interrupted it, or closed it in the dock), `exit_code` (its
 * process's: 0, another number, or undefined when this app did not see it end).
 *  - you cut it short (Stop, or closed mid-turn): stopped, whatever claude answered — your call, not its failure;
 *  - its last turn decides the rest: a turn that finished did its work, even if the process then ends with a code
 *    (closing it in the dock may end it with one); a turn that erred failed. A permission you deny does not end the
 *    turn: claude is told and goes on, so the turn's own result still says how it went;
 *  - no turn ever finished: it failed if its process ended with an error code, else it stopped before getting
 *    anywhere (it ended cleanly, or this app lost sight of it: the server restarted meanwhile) — never done.
 */
export function endedStatus(run) {
  if (run.stopped) return 'stopped';
  if (run.outcome === 'success') return 'done';
  if (run.outcome === 'error') return 'failed';
  return run.exit_code != null && run.exit_code !== 0 ? 'failed' : 'stopped';
}

/** "42s", "3m 10s", "1h 05m"; '' for nothing (or less than a second). */
export function durationLabel(ms) {
  const s = Math.round((Number(ms) || 0) / 1000);
  if (s < 1) return '';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** "$0.42", "<$0.01"; '' for none. */
export function costLabel(usd) {
  const n = Number(usd);
  if (!(n > 0)) return '';
  return n >= 0.01 ? `$${n.toFixed(2)}` : '<$0.01';
}

// What a waiting run asks, in words (server.py waiting_for: a tool's name, 'question' or 'plan').
const ASKS = { question: 'Has a question for you', plan: 'Wants you to approve its plan', permission: 'Needs your OK' };

/** The sentence under a run: what it waits for, how long it has been at it, or how it ended — time and cost included. */
export function runLabel(run, now = Date.now()) {
  const status = runStatus(run);
  const took = durationLabel((run.ended_ts || now) - (run.started_ts || now));
  const cost = costLabel(run.cost);
  const tail = (...parts) => parts.filter(Boolean).join(' · ');
  switch (status) {
    case 'needs_you': return ASKS[run.waiting_for] || `Needs your OK to run ${run.waiting_for}`;
    case 'working': return tail(took ? `Working for ${took}` : 'Working', cost);
    case 'started': return 'Opened in Terminal';
    case 'done': return tail(took ? `Done in ${took}` : 'Done', cost);
    case 'failed': return tail(took ? `Failed after ${took}` : 'Failed', cost);
    default: return tail(took ? `Stopped after ${took}` : 'Stopped', cost);
  }
}

/** Unread: a run over whose result nobody has looked at yet (opening it, or watching it end in the dock, reads it). */
/** Archived (tm/agentruns.py archive): out of the Inbox and the Home, still on its agent's page. A run resumed and
 *  working again is not: what is under way always shows. */
export const isArchived = (run) => Boolean(run.archived_at) && ['done', 'failed', 'stopped'].includes(runStatus(run));
/** Whether a run can be archived: one that has ended. */
export const canArchive = (run) => ['done', 'failed', 'stopped'].includes(runStatus(run));
export const isUnread = (run) => Boolean(run.outcome) && !run.read_at && ['done', 'failed', 'stopped'].includes(runStatus(run));

/** The Activity page's groups, in this order, each newest first (the server's order); empty ones left out. */
export function groupActivity(runs) {
  const groups = [
    { key: 'needs_you', label: 'Needs you', runs: [] },
    { key: 'running', label: 'Running', runs: [] },
    { key: 'unread', label: 'Unread', runs: [] },
    { key: 'earlier', label: 'Earlier', runs: [] },
  ];
  const at = Object.fromEntries(groups.map((g) => [g.key, g]));
  for (const r of runs || []) {
    const s = runStatus(r);
    const key = s === 'needs_you' ? 'needs_you' : s === 'working' ? 'running' : isUnread(r) ? 'unread' : 'earlier';
    at[key].runs.push(r);
  }
  return groups.filter((g) => g.runs.length);
}

// Where a run came from: the Activity page's Source filter.
export const RUN_SOURCES = [['here', 'In the app'], ['terminal', 'Terminal'], ['schedule', 'Scheduled']];

/** The runs a search and the Activity filters keep: words in its command, arguments or folder; a status; a folder; a source. */
export function filterRuns(runs, { q = '', status = '', dir = '', source = '' } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  return (runs || []).filter((r) => {
    if (status && runStatus(r) !== status) return false;
    if (dir && r.dir !== dir) return false;
    if (source && (r.source || r.target || 'here') !== source) return false;
    const text = `/${r.cmd || ''} ${r.args || ''} ${r.dir_name || ''}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

// What the sidebar marks an agent with, most pressing first: one of its runs waits for you, runs, or ended unread.
const MARKS = ['needs_you', 'working', 'unread'];

/** The sidebar's mark of each agent (`<folder> <name>`, agentsmodel.js agentKey) from its runs: the most pressing of
 *  them — 'needs_you', 'working' or 'unread'. An agent with none of those has no entry. */
export function agentMarks(runs) {
  const out = {};
  for (const r of runs || []) {
    const s = runStatus(r);
    const mark = s === 'needs_you' || s === 'working' ? s : isUnread(r) ? 'unread' : '';
    const key = `${r.dir} ${r.cmd}`;
    if (mark && (!out[key] || MARKS.indexOf(mark) < MARKS.indexOf(out[key]))) out[key] = mark;
  }
  return out;
}

/** The Inbox's count: the runs that wait for you and the ones that ended unread. */
export const inboxCount = (counts) => (counts?.needs_you || 0) + (counts?.unread || 0);
