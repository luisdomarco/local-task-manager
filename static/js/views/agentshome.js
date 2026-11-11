// #/runs: the Agents section's Home — where it is, at a glance. From the top: the week in one line, what needs you
// (only when something does: the Inbox has them all), and two columns — Running now and Up next, Your agents (favourites, then the
// most run lately) and Recent results — under one line for the week. Everything comes from what the page already reads
// (agentactivity.js, the agent folders, the schedules); the choices are in homemodel.js (tested). views/runs.js mounts
// it and hands it the section's tabs.
import { activity, onActivity, openRun, refreshActivity } from '../agentactivity.js';
import { addFolderDialog } from '../agentspane.js';
import { startAgent } from '../agentstart.js';
import { agentHref, agentKey, runMessage } from '../agentsmodel.js';
import { api } from '../api.js';
import { agoLabel } from '../dates.js';
import { needingYou, recentResults, runningNow, startedAt, upNext, weekLine, weekStats, yourAgents } from '../homemodel.js';
import { pref } from '../prefs.js';
import { durationLabel, isUnread, RUN_STATUSES, runLabel, runStatus } from '../runmodel.js';
import { inLabel, nextLabel } from '../schedmodel.js';
import { toast } from '../state.js';
import { setAlertTitle } from '../tabtitle.js';
import { emptyLine, h, icon, pageHead, secondaryButton } from '../ui.js';

const TICK = 15000;                   // how often a running run's time is redrawn

/** One of Home's rows: a card (.cs-item) that opens something, with its lead (a dot or an icon), a monospace title, a
 *  muted meta line and its actions on hover. */
function card({ lead, title, meta, actions = [], open, tip = '', unread = false }) {
  return h('li', { class: `cs-item surface-card hover-host agents-home-row${unread ? ' unread' : ''}`, tabindex: '0', role: 'button', title: tip || null,
    onclick: open, onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); } },
  lead,
  h('div', { class: 'cs-item-text' }, h('span', { class: 'cs-item-title mono' }, title), h('span', { class: 'cs-item-meta muted' }, ...meta)),
  unread ? h('span', { class: 'agents-unread', title: 'Ended: not seen yet', 'aria-label': 'Not seen yet' }) : null,
  actions.length ? h('div', { class: 'cs-item-actions hover-reveal' }, ...actions) : null);
}
const dot = (status) => h('span', { class: `td-dot tone-${RUN_STATUSES[status].tone}`, title: RUN_STATUSES[status].label, 'aria-hidden': 'true' });
const word = (status) => h('strong', { class: 'agents-status-word' }, RUN_STATUSES[status].label);
const iconBtn = (ico, title, fn) => h('button', { class: 'btn icon', type: 'button', title, 'aria-label': title,
  onclick: (e) => { e.stopPropagation(); fn(); } }, icon(ico, 14));
const section = (title, count, body, extra = null) => h('section', { class: 'agents-home-section', 'aria-label': title },
  h('h2', { class: 'agents-section-title' }, title, count ? h('span', { class: 'muted' }, String(count)) : null, extra), body);
const list = (rows, empty) => (rows.length ? h('ul', { class: 'cs-list' }, rows) : emptyLine(empty, { cls: 'agents-home-empty' }));

/**
 * The Home page. `dirs` the agent folders (agentspane.js); `sectionTabs(on)` the section's tabs.
 * → { sig, nodes, stop, refresh(dirs) }.
 */
export function homePage(dirs, { sectionTabs }) {
  const alertBox = h('div');
  const runningBox = h('div');
  const nextBox = h('div');
  const agentsBox = h('div');
  const resultsBox = h('div');
  const week = h('p', { class: 'muted small agents-home-week' });
  let schedules = null;

  // Your agents' ▷ starts one: its chat in the dock with its command written, to finish and send there (agentstart.js).
  const agentOf = (key) => {
    for (const d of dirs) for (const c of d.commands || []) if (agentKey(d.id, c.name) === key) return { folder: d, agent: c };
    return null;
  };
  /** Your agents' ▷: that agent in the dock, as Run does. */
  function use(key) {
    const found = agentOf(key);
    if (found) startAgent(found.folder, found.agent.name, { where: found.folder.git && pref('agents.where', 'here') === 'worktree' ? 'worktree' : 'here' });
  }

  // ── What is going on ──
  function paint() {
    const data = activity();
    const runs = data?.runs || [];
    const now = Date.now();
    const waiting = needingYou(runs);
    alertBox.replaceChildren(...(waiting.length ? [h('section', { class: 'agents-home-alert', 'aria-label': 'Needs you' },
      h('h2', { class: 'agents-section-title' }, dot('needs_you'), `${waiting.length} ${waiting.length === 1 ? 'run needs' : 'runs need'} you`,
        h('a', { class: 'agents-home-more', href: '#/runs/inbox' }, 'Open the Inbox →')),
      list(waiting.slice(0, 3).map((r) => card({ lead: dot('needs_you'), title: runMessage(r.cmd, r.args), open: () => openRun(r), tip: 'Opens in the dock, to answer it',
        meta: [word('needs_you'), ' · ', runLabel(r), r.dir_name ? ` · ${r.dir_name}` : ''] })), ''))] : []));

    const live = runningNow(runs);
    runningBox.replaceChildren(section('Running now', live.length, list(live.map((r) => card({
      lead: dot('working'), title: runMessage(r.cmd, r.args), open: () => openRun(r), tip: 'Opens in the dock',
      meta: [word('working'), ' · ', durationLabel(now - startedAt(r)) || 'just started', r.dir_name ? ` · ${r.dir_name}` : '',
        r.source === 'schedule' ? [' · ', icon('clock', 11), ' Scheduled'] : null],
      actions: r.busy ? [iconBtn('stop', 'Stop its turn', () => api.chatInterrupt(r.id).then(refreshActivity, (e) => toast(e.message, true)))] : [],
    })), data ? 'Nothing running.' : 'Reading the runs…')));

    const soon = upNext(schedules || []);
    nextBox.replaceChildren(section('Up next', soon.length, list(soon.map((s) => card({
      lead: h('span', { class: 'agents-home-ico' }, icon('clock', 14)), title: runMessage(s.cmd, s.args),
      open: () => { location.hash = agentHref(s.dir, s.cmd); }, tip: `${s.label}\nOpens its agent`,
      meta: [h('span', { title: new Date(s.next_ts).toLocaleString() }, `${nextLabel(s.next_ts, now)} (${inLabel(s.next_ts, now)})`), ` · ${s.label}`],
      actions: [iconBtn('play', 'Run now (its next time stays)', () => api.agentScheduleRun(s.id).then(() => { refreshActivity(); loadSchedules(); },
        (e) => toast(e.message, true)))],
    })), schedules ? 'Nothing scheduled. Schedule… on an agent\'s page runs it on its own.' : 'Reading the schedules…')));

    const mine = yourAgents(dirs, runs, { pinned: pref('agents.pinned', []) || [], now });
    agentsBox.replaceChildren(section('Your agents', 0, list(mine.map((a) => {
      const key = agentKey(a.dir, a.command.name);
      const st = a.last ? runStatus(a.last) : null;
      return card({
        lead: h('span', { class: 'agents-home-ico' }, icon(a.pinned ? 'star' : 'slash', 14)), title: `/${a.command.name}`,
        open: () => { location.hash = agentHref(a.dir, a.command.name); }, tip: a.command.description || '',
        meta: [a.dirName, ' · ', st ? [dot(st), ' ', `${RUN_STATUSES[st].label} ${agoLabel(a.last.at)}`] : 'Never run',
          a.count ? ` · ${a.count} run${a.count === 1 ? '' : 's'} in 30 days` : ''],
        actions: [iconBtn('play', 'Run: opens it in the dock, its command written', () => use(key))],
      });
    }), 'Star an agent on its page, or run one: it shows here.')));

    const done = recentResults(runs);
    resultsBox.replaceChildren(section('Recent results', 0, list(done.map((r) => {
      const st = runStatus(r);
      return card({ lead: dot(st), title: runMessage(r.cmd, r.args), open: () => openRun(r), tip: 'Shows what it did and changed', unread: isUnread(r),
        meta: [word(st), ' · ', runLabel(r), r.dir_name ? ` · ${r.dir_name}` : '', ` · ${agoLabel(r.at)}`,
          r.source === 'schedule' ? [' · ', icon('clock', 11), ' Scheduled'] : null] });
    }), data ? 'No run has ended yet.' : ''), h('a', { class: 'agents-home-more', href: '#/runs/inbox' }, 'Inbox →')));

    week.textContent = data ? (weekLine(weekStats(runs, now)) ? `This week: ${weekLine(weekStats(runs, now))}` : '') : '';
    week.hidden = !week.textContent;
  }

  let stamp = 0;
  async function loadSchedules() {
    const mine = ++stamp;
    try {
      const r = await api.agentSchedules();
      if (mine === stamp) { schedules = r.schedules || []; paint(); }
    } catch { if (mine === stamp) { schedules = []; paint(); } }
  }

  paint();
  loadSchedules();
  setAlertTitle(''); // here is where what it told shows
  const off = onActivity(() => { paint(); loadSchedules(); }); // a scheduled run started: its next time moved
  const timer = setInterval(() => { if (runningNow(activity()?.runs).length) paint(); }, TICK);
  refreshActivity();
  return {
    sig: '~home',
    nodes: [
      pageHead({ title: 'Agents', action: secondaryButton('Add folder', { ico: 'plus', onclick: () => addFolderDialog() }) }),
      sectionTabs('home'),
      h('div', { class: 'agents-home' }, week, alertBox,
        h('div', { class: 'agents-home-grid' }, runningBox, nextBox, agentsBox, resultsBox)),
    ],
    stop: () => { off(); clearInterval(timer); stamp += 1; },
    refresh(next) {
      const changed = JSON.stringify(next) !== JSON.stringify(dirs);
      dirs = next;
      if (!changed) return; // the list read again, the same: nothing to redraw
      paint();
    },
  };
}
