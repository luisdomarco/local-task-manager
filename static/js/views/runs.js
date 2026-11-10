// The Agents section's middle (its sidebar is agentspane.js).
// #/runs: the Home (views/agentshome.js) — the week, what needs you, runs now, up next, your agents, recent results.
// #/runs/inbox: the Inbox — every run of every agent on this computer (agentactivity.js), as a list's table (a view
// bar: Filter, Order, Group — by what it asks of you at first: Needs you, Running, Unread, Earlier —, Display, and a
// board by status), its view inboxview.js's.
// #/runs/<folder id>/<name>: one agent — its head (where it lives, its name as typed in Claude Code, what it does, and
// Run · Schedule… · Open in ▾), how it has gone the last 30 days, and its tabs: its Instructions (its prompt), what it
// works with — Skills, Subagents, Commands, Files of its folder (tm/agentlinks.py), each tab only when it has some — and
// its Details. Run opens its chat in the dock with the command written, not sent (agentstart.js): the arguments, mode,
// model and effort are settled in the dock's composer, the only one. Open in ▾ starts it in Terminal, Claude Desktop,
// Cursor or Antigravity instead. On the right, as on an item's page, its Runs and Schedules (tm/agentruns.py).
import { activity, markRead, onActivity, openRun, refreshActivity } from '../agentactivity.js';
import { scheduleDialog, scheduleList } from '../agentschedules.js';
import { agentFile } from '../agentfile.js';
import { startAgent, startChoices } from '../agentstart.js';
import { homePage } from './agentshome.js';
import { agentDirs, onAgents, loadAgents, addFolderDialog, isFavourite, toggleFavourite } from '../agentspane.js';
import { agentHref, parseRunsParam, runMessage, runMeta, RUN_MODES, RUN_PLACES } from '../agentsmodel.js';
import { api } from '../api.js';
import { TARGET_ICON, claudeTargets, openInMenu, resumeClaude } from '../claude.js';
import { DETAIL_PAGE, LIST_PAGE, dataTable, paged } from '../datatable.js';
import { agoLabel } from '../dates.js';
import { sideFold } from '../itemform.js';
import { pref, setPref } from '../prefs.js';
import { diffBlock } from '../diffview.js';
import { agentStats } from '../homemodel.js';
import { INBOX_GROUPS, INBOX_ORDERS, INBOX_PROPS, filtersFromOld, groupName, groupRuns, groupTone, inboxFields, inboxGroupLabel, orderValue, runMs, sortRuns, sourceLabel } from '../inboxview.js';
import { wantsNewTab } from '../links.js';
import { costLabel, durationLabel, filterRuns, inboxCount, isUnread, RUN_STATUSES, runLabel, runStatus } from '../runmodel.js';
import { closePopover, viewBar } from '../viewbar.js';
import { applyOrder, reorderColumns } from '../colorder.js';
import { dragsList, listDropZone } from '../kanban.js';
import { columnOn, fresh, matches } from '../viewmodel.js';
import { parseUnifiedDiff } from '../udiff.js';
import { toast } from '../state.js';
import { setAlertTitle, setPageTitle } from '../tabtitle.js';
import { dropdown, emptyState, h, icon, pageEmpty, pageHead, secondaryButton, select, tabPanels } from '../ui.js';

const SIDE_KEY = 'tm.agentsSidePanel'; // its Runs panel folded or not: one choice for every agent

export function mount(root, param) {
  const { dir, name, run } = parseRunsParam(param);
  let view = null;
  let live = true;
  const draw = () => {
    if (!live) return;
    const dirs = agentDirs();
    if (!dirs) { root.replaceChildren(emptyState('Reading the agent folders…')); return; }
    if (!dirs.length) { view?.stop(); view = null; root.replaceChildren(...intro()); setPageTitle('Agents'); return; }
    if (!dir) { // the Home
      if (view?.sig === '~home') { view.refresh(dirs); return; }
      view?.stop();
      view = homePage(dirs, { sectionTabs });
      root.replaceChildren(...view.nodes);
      setPageTitle('Agents');
      return;
    }
    if (dir === 'inbox' && !name) {
      if (view?.sig === '~inbox') { view.refresh(dirs); return; }
      view?.stop();
      view = inboxPage(dirs);
      root.replaceChildren(...view.nodes);
      setPageTitle('Inbox');
      return;
    }
    if (!name) { location.replace('#/runs'); return; } // a folder alone (#/runs/all once): the Home
    const folder = dirs.find((d) => d.id === dir);
    const agent = folder?.commands.find((c) => c.name === name);
    if (!folder || !agent) {
      root.replaceChildren(pageHead({ title: `/${name || ''}` }),
        emptyState(folder ? `${folder.name} has no agent /${name} any more.` : 'That agent folder is not in Settings → Agents any more.'));
      return;
    }
    if (view?.sig === `${dir} ${name}`) { view.refresh(agent, folder); return; } // the list reloaded: keep what is being typed
    view?.stop();
    view = agentPage(folder, agent, run);
    root.replaceChildren(...view.nodes);
    setPageTitle(`/${name}`);
  };
  draw();
  loadAgents().then(draw);
  const stop = onAgents(draw);
  return { update() {}, unmount() { live = false; view?.stop(); view = null; stop(); } };
}

// ── No folder yet ────────────────────────────────────────────────────────────
function intro() {
  return [pageHead({ title: 'Agents', action: secondaryButton('Add folder', { ico: 'plus', onclick: () => addFolderDialog() }) }),
    h('div', { class: 'agents-intro' },
      h('p', {}, 'Run your Claude Code agents from here instead of a terminal.'))];
}

/** Home · Inbox: the pages of the section that are not an agent's, as a section's tab links; the Inbox's
 *  with what waits for you or ended unseen. */
const sectionTabs = (on) => {
  const n = inboxCount(activity()?.counts);
  return h('nav', { class: 'tabs-bar section-tabs', 'aria-label': 'Agents' },
    [['home', 'Home', 'home', '#/runs'], ['inbox', 'Inbox', 'inbox', '#/runs/inbox']].map(([key, text, ico, href]) => h('a', {
      class: `tab-btn ${key === on ? 'active' : ''}`, href, ...(key === on ? { 'aria-current': 'page' } : {}),
    }, icon(ico, 14), text, key === 'inbox' && n ? h('span', { class: 'tab-count' }, String(n)) : null)));
};

// ── #/runs/inbox: the Inbox ──────────────────────────────────────────────────
// A list's view (viewbar.js): Filter, Order, Group, Display and List | Board, kept in this browser (VIEW_KEY). Its fields,
// groups and orders are inboxview.js's.
const VIEW_KEY = 'agents.inbox.view';
const OLD_FILTERS = 'agents.inbox'; // { status, dir, source }: the three selects before the view bar
const OLD_LAYOUT = 'agents.inboxLayout';

/** The Inbox's view: a list's, grouped by what each run asks of you and newest first at first. A browser that kept the
 *  old selects starts with them as filters. */
function inboxView() {
  const saved = pref(VIEW_KEY, null);
  const view = { ...fresh(), groupBy: 'attention', orderBy: 'started', orderDir: -1, ...(saved || {}) };
  if (!saved) {
    view.filters = filtersFromOld(pref(OLD_FILTERS, null));
    view.layout = pref(OLD_LAYOUT, 'list') === 'board' ? 'board' : 'list';
  }
  view.filters = Array.isArray(view.filters) ? view.filters : [];
  view.folded = Array.isArray(view.folded) ? view.folded : [];
  return { view, save: () => setPref(VIEW_KEY, view) };
}

/** A run's status as the dock draws a session's: its dot and its word. */
const statusDot = (r) => {
  const st = RUN_STATUSES[runStatus(r)];
  return h('span', { class: `td-dot tone-${st.tone}`, title: st.label, 'aria-hidden': 'true' });
};
const runHref = (r) => `${agentHref(r.dir, r.cmd)}?run=${encodeURIComponent(r.id)}`;

function inboxPage(dirs) {
  const { view, save } = inboxView();
  let q = '';
  const count = h('span', { class: 'muted view-count' });
  const list = h('div', { class: 'agents-inbox-list' });
  const readAll = h('button', { class: 'btn small ghost', type: 'button', title: 'Mark every run that ended as seen',
    onclick: () => markRead((activity()?.runs || []).filter(isUnread).map((r) => r.id)) }, icon('check', 13), 'Mark all read');
  const ctx = () => ({ dirs });
  const all = () => activity()?.runs || [];
  const searched = () => filterRuns(all(), { q });
  const order = () => view.orderBy || 'started';
  const dir = () => view.orderDir || -1;
  const isBoard = () => view.layout === 'board';
  const vb = viewBar({
    view, save, fields: () => inboxFields(ctx()), ctx, items: searched,
    groups: INBOX_GROUPS.map(([k]) => k), groupLabel: inboxGroupLabel, emptyGroups: false, boardGroups: false,
    orders: INBOX_ORDERS, order, dir,
    onOrder: (k) => { view.orderBy = k || 'started'; if (!k) view.orderDir = -1; save(); paint(true); },
    onDir: (d) => { view.orderDir = d; save(); paint(true); },
    props: INBOX_PROPS,
    layout: { current: () => (isBoard() ? 'board' : 'list'), pick: (l) => { view.layout = l; save(); vb.update(); paint(true); } },
    placeholder: 'Search runs', onText: (text) => { q = text; paint(true); },
    note: readAll,
    // A board whose columns were moved: Display puts them back in the Inbox's order (Group, where a list's board has it, is not there)
    displayRows: () => (isBoard() && view.colOrder?.status?.length ? [h('button', { type: 'button', class: 'menu-item',
      onclick: () => { const { status: _, ...rest } = view.colOrder; view.colOrder = rest; save(); closePopover(); paint(true); } }, h('span', {}, 'Reset column order')),
    h('div', { class: 'menu-sep' })] : []),
    onReset: () => { view.groupBy = 'attention'; view.orderInGroups = null; view.folded = []; view.boardFold = {}; view.colOrder = {}; },
    onChange: () => paint(true),
  });
  vb.bar.classList.add('agents-inbox-bar');

  // ── the table's columns: the run (what it was sent) is always there; Display hides the others ──
  const more = (r, compact = false) => {
    const title = runMessage(r.cmd, r.args);
    const btn = h('button', { class: `btn icon${compact ? ' row-action' : ''}`, type: 'button', title: 'More actions', 'aria-label': `More actions for ${title}`, 'aria-haspopup': 'menu',
      onclick: (e) => { e.stopPropagation(); inboxMenu(btn, r); } }, icon('more', 14));
    return btn;
  };
  const COLUMNS = [
    { key: 'status', label: 'Status', get: (r) => orderValue('status', r), cell: (r) => h('span', { class: 'agents-status-cell' }, statusDot(r), RUN_STATUSES[runStatus(r)].label) },
    {
      key: 'run', label: 'Run', get: (r) => orderValue('run', r),
      cell: (r) => h('span', { class: 'agents-run-cell', title: runLabel(r) },
        h('span', { class: 'mono agents-run-msg' }, runMessage(r.cmd, r.args)),
        runStatus(r) === 'needs_you' ? h('span', { class: 'agents-run-ask' }, runLabel(r)) : null,
        r.worktree ? h('span', { class: 'agents-run-tag', title: `In a worktree, on ${r.branch || 'a branch of its own'}` }, icon('branch', 12)) : null),
    },
    { key: 'folder', label: 'Folder', get: (r) => orderValue('folder', r), cell: (r) => h('span', { title: r.cwd || '' }, r.dir_name || '') },
    { key: 'source', label: 'Started from', get: (r) => orderValue('source', r), cell: (r) => sourceLabel(r) },
    { key: 'time', label: 'Time', cls: 'num', get: (r) => orderValue('time', r), cell: (r) => durationLabel(runMs(r)) },
    { key: 'cost', label: 'Cost', cls: 'num', get: (r) => orderValue('cost', r), cell: (r) => costLabel(r.cost) },
    { key: 'started', label: 'Started', get: (r) => orderValue('started', r), cell: (r) => h('span', { title: when(r.at) }, agoLabel(r.at)) },
    {
      key: 'actions', label: '', blank: true, get: () => 0,
      cell: (r) => h('span', { class: 'agents-row-end' }, isUnread(r) ? h('span', { class: 'agents-unread', title: 'Ended: not seen yet', 'aria-label': 'Not seen yet' }) : null,
        h('span', { class: 'hover-reveal' }, more(r, true))),
    },
  ];
  const WIDTHS = { status: 120, folder: 140, source: 116, time: 84, cost: 76, started: 104, actions: 60 };
  const hideable = new Set(INBOX_PROPS.map(([k]) => k));

  function table(runs) {
    const cols = COLUMNS.filter((c) => !hideable.has(c.key) || columnOn(view.props, c.key));
    const folded = new Set(view.folded);
    const inGroups = view.groupBy && view.orderInGroups ? view.orderInGroups : order();
    const group = view.groupBy ? {
      list: groupRuns(sortRuns(runs, inGroups, dir()), view.groupBy, ctx()),
      header: (key, rows) => {
        const tone = groupTone(view.groupBy, key);
        return [tone ? h('span', { class: `td-dot tone-${tone}`, 'aria-hidden': 'true' }) : null,
          h('strong', {}, groupName(view.groupBy, key, ctx(), rows)), h('span', { class: 'group-count' }, String(rows.length))];
      },
      collapsed: folded,
      onToggle: (k) => { view.folded = folded.has(k) ? view.folded.filter((x) => x !== k) : [...view.folded, k]; save(); paint(true); },
    } : null;
    return h('div', { class: 'list-main agents-inbox-table' }, dataTable({ // a list's table: 40px rows, its quiet head
      columns: cols, rows: runs, sort: { col: order(), dir: dir() },
      onSort: ({ col, dir: d }) => { view.orderBy = col; view.orderDir = d; save(); vb.update(); paint(true); },
      onRow: (r) => openRun(r), rowHref: runHref, rowLabel: (r) => `${runMessage(r.cmd, r.args)}, ${RUN_STATUSES[runStatus(r)].label}`,
      rowClass: (r) => `hover-host${isUnread(r) ? ' unread' : ''}`,
      label: 'Runs', empty: 'No run matches.', group, paging: { key: 'agents.inbox', size: LIST_PAGE },
      flex: { run: 260 }, widths: WIDTHS,
    }));
  }

  let drawn = '';
  function paint(force = false) {
    const data = activity();
    const now = JSON.stringify([data, q]);
    if (!force && now === drawn) return;
    drawn = now;
    vb.update();
    if (!data) { list.replaceChildren(pageEmpty('Reading the runs…')); return; }
    const runs = all();
    readAll.hidden = !runs.some(isUnread);
    count.textContent = runs.length ? `${runs.length} run${runs.length === 1 ? '' : 's'}` : '';
    if (!runs.length) { list.replaceChildren(pageEmpty('No runs yet. Open an agent in the sidebar and Run it: its run shows here, and here is where it tells you when it needs you.')); return; }
    const fs = inboxFields(ctx());
    const shown = searched().filter((r) => matches(r, view.filters, fs, ctx()));
    if (!shown.length) { list.replaceChildren(pageEmpty('No run matches.')); return; }
    list.replaceChildren(isBoard() ? board(sortRuns(shown, order(), dir())) : table(shown));
  }
  /** The board: a column per status, in the Inbox's order (what needs you first) until one is dragged by its head (or
   *  moved with Shift+←/→): then in yours, kept with the view (view.colOrder.status, colorder.js), as a list's board;
   *  an empty one folds to a strip, or shows or hides (Display → Empty columns). Started only when a run is. */
  function board(runs) {
    const by = new Map(Object.keys(RUN_STATUSES).map((k) => [k, []]));
    for (const r of runs) by.get(runStatus(r))?.push(r);
    const empties = view.emptyCols || 'fold';
    const fold = view.boardFold || {};
    const setFold = (k, f) => { view.boardFold = { ...fold, [k]: f }; save(); paint(true); };
    const saved = view.colOrder?.status;
    const keys = applyOrder([...by.keys()], saved).filter((k) => (k !== 'started' || by.get(k).length) && (by.get(k).length || empties !== 'hide'));
    const move = (from, to) => { view.colOrder = { ...(view.colOrder || {}), status: reorderColumns(saved, keys, from, to) }; save(); paint(true); };
    const tip = 'drag, or Shift+←/→, to move the column';
    const handle = (el, k, idx) => {
      dragsList(el, idx);
      el.dataset.colHandle = '';
      el.addEventListener('keydown', (e) => {
        if (!e.shiftKey || e.target !== el || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        const to = idx + (e.key === 'ArrowLeft' ? -1 : 1);
        if (to < 0 || to >= keys.length) return;
        e.preventDefault();
        move(idx, to);
        requestAnimationFrame(() => list.querySelector(`.board-col[data-list="${k}"] [data-col-handle]`)?.focus()); // drawn again: back on it
      });
      return el;
    };
    const face = (k) => [h('span', { class: `td-dot tone-${RUN_STATUSES[k].tone}`, 'aria-hidden': 'true' }), RUN_STATUSES[k].label];
    const el = h('div', { class: 'board vboard agents-board', role: 'list', 'aria-label': 'Runs by status' },
      keys.map((k, idx) => {
        const rs = by.get(k);
        const attrs = { role: 'listitem', 'aria-label': `${RUN_STATUSES[k].label} column`, 'data-list': k };
        if (fold[k] ?? (!rs.length && empties === 'fold')) {
          return h('section', { class: 'board-col folded', ...attrs },
            handle(h('button', { class: 'fold-strip', type: 'button', title: `Open ${RUN_STATUSES[k].label} — ${tip}`, onclick: () => setFold(k, false) },
              h('span', { class: 'strip-name' }, ...face(k)), h('span', { class: 'strip-count' }, String(rs.length))), k, idx));
        }
        return h('section', { class: 'board-col', ...attrs },
          handle(h('header', { class: 'list-head vb-col-head', tabindex: '0', title: `${RUN_STATUSES[k].label} — ${tip}` },
            h('span', { class: 'group-title' }, ...face(k)), h('span', { class: 'count' }, String(rs.length))), k, idx),
          rs.length ? h('ul', { class: 'col-cards cs-list' }, rs.map(inboxCard)) : h('p', { class: 'col-empty' }, 'None'));
      }));
    listDropZone(el, move);
    return el;
  }
  function inboxCard(r) {
    const title = runMessage(r.cmd, r.args);
    const unread = isUnread(r);
    const open = () => openRun(r);
    return h('li', { class: `cs-item surface-card hover-host agents-inbox-row${unread ? ' unread' : ''}`, tabindex: '0', role: 'button',
      title: [title, `${r.dir_name || ''} · started ${when(r.at)}`, r.live && ['needs_you', 'working'].includes(runStatus(r)) ? 'Opens in the dock' : 'Shows what it did and changed'].join('\n'),
      ...hrefOpen(runHref(r), open), onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); } },
    statusDot(r),
    h('div', { class: 'cs-item-text' },
      h('span', { class: 'cs-item-title mono' }, title),
      h('span', { class: 'cs-item-meta muted' }, runLabel(r),
        r.dir_name ? [' · ', h('span', { class: 'nowrap' }, r.dir_name)] : null, ' · ', h('span', { class: 'nowrap' }, agoLabel(r.at)),
        r.source === 'schedule' ? [' · ', h('span', { class: 'nowrap' }, icon('clock', 11), ' Scheduled')] : null)),
    unread ? h('span', { class: 'agents-unread', title: 'Ended: not seen yet', 'aria-label': 'Not seen yet' }) : null,
    h('div', { class: 'cs-item-actions hover-reveal' }, more(r)));
  }
  function inboxMenu(anchor, r) {
    dropdown(anchor, [
      { label: 'Show its detail', icon: 'panel', onSelect: () => { location.hash = runHref(r); } },
      { label: 'Go to its agent', icon: 'slash', onSelect: () => { location.hash = agentHref(r.dir, r.cmd); } },
      isUnread(r) ? { label: 'Mark as read', icon: 'check', onSelect: () => markRead([r.id]) } : null,
      { label: 'Copy session id', icon: 'copy', onSelect: () => navigator.clipboard.writeText(r.id).then(() => toast('Session id copied'), () => toast('Could not copy', true)) },
      '-',
      { label: 'Forget this run', icon: 'trash', danger: true, title: 'The conversation itself stays in Claude Code', onSelect: async () => {
        try { await api.agentRunForget(r.id); await refreshActivity(); } catch (e) { toast(e.message, true); }
      } },
    ].filter(Boolean), { align: 'end' });
  }
  paint(true);
  setAlertTitle(''); // looking at the Inbox is coming back to what it told
  const off = onActivity(() => paint());
  refreshActivity();
  return {
    sig: '~inbox',
    nodes: [pageHead({ title: 'Inbox', count, action: secondaryButton('Add folder', { ico: 'plus', onclick: () => addFolderDialog() }) }), sectionTabs('inbox'), vb.bar, vb.chips, list],
    stop: off,
    refresh(next) { dirs = next; paint(true); },
  };
}

/** links.js opener for a card that is not an item: a click opens it, ⌘/Ctrl or the middle button `href` in a new tab. */
const hrefOpen = (href, open) => {
  const go = (e) => { if (wantsNewTab(e)) { e.preventDefault(); e.stopPropagation(); window.open(href, '_blank', 'noopener'); } else open(); };
  return { onclick: go, onauxclick: (e) => { if (e.button === 1) go(e); }, onmousedown: (e) => { if (e.button === 1) e.preventDefault(); } };
};

// ── #/runs/<folder>/<name>: one agent ────────────────────────────────────────
const TAB_KEY = 'agents.tab'; // the agent page's tab last shown: one choice for every agent
const RELATED = [ // its tabs of what it works with (tm/agentlinks.py), shown only when there is something in them
  ['skills', 'Skills', 'book', 'Skills of its folder its instructions name (or a subagent of it does)'],
  ['agents', 'Subagents', 'bot', 'Subagents of its folder it hands work to'],
  ['commands', 'Commands', 'slash', 'Other commands of its folder it names'],
  ['files', 'Files', 'file', 'Files of its folder it points at'],
];

function agentPage(folder, agent, openRunId = '') {
  let where = folder.git && pref('agents.where', 'here') === 'worktree' ? 'worktree' : 'here';

  // ── the head: where it lives, its name and what to do with it (what it does is its Instructions' first row) ──
  const crumbs = h('nav', { class: 'agents-crumbs muted small', 'aria-label': 'Where it lives' },
    icon('folder', 13), h('span', { title: folder.path }, folder.name),
    ...(agent.ns ? agent.ns.split(':').flatMap((n) => [h('span', { class: 'agents-crumb-sep', 'aria-hidden': 'true' }, '/'), h('span', {}, n)]) : []));
  const title = h('h1', { class: 'agents-title' }, `/${agent.name}`);

  const runBtn = h('button', { class: 'btn primary agents-run', type: 'button',
    title: 'Opens it in the dock with the command written: add its arguments, pick its mode and model there, and send (⌘↵)',
    onclick: () => run() }, icon('play', 14), 'Run');
  const wherePick = folder.git ? select(RUN_PLACES, where, (v) => { where = v || 'here'; setPref('agents.where', where); },
    { class: 'small agents-where-pick', 'aria-label': 'Where', title: 'Where it runs: this folder as it is, or a new git worktree of it on a branch of its own (only what is committed is there)' }) : null;
  const scheduleIt = (existing = null) => scheduleDialog({ folder, agent, existing,
    preset: { args: stats.last?.args || '', ...startChoices(folder.id, agent.name), where }, onSaved: () => runs.showSchedules() });
  const scheduleBtn = h('button', { class: 'btn secondary agents-schedule', type: 'button', title: 'Run it on its own, every day, weekday or few hours', onclick: () => scheduleIt() },
    icon('clock', 14), 'Schedule…');
  const targets = claudeTargets();
  const openIn = h('button', { class: 'btn ghost agents-openin', type: 'button', 'aria-haspopup': targets.length > 1 ? 'menu' : null,
    title: 'Start it outside the app: Terminal, or another app where you send it',
    onclick: () => (targets.length > 1 ? openInMenu(openIn, targets, launchIn, null, 'auto') : launchIn(targets[0])) },
  icon('external', 14), targets.length > 1 ? 'Open in ▾' : `Open in ${targets[0].label}`);
  const more = h('button', { class: 'btn icon', type: 'button', title: 'More', 'aria-label': 'More actions', 'aria-haspopup': 'menu',
    onclick: () => dropdown(more, [
      { label: 'Copy the command', icon: 'copy', onSelect: () => navigator.clipboard.writeText(`/${agent.name}`).then(() => toast(`/${agent.name} copied`), () => toast('Could not copy', true)) },
      { label: 'Show its folder in Finder', icon: 'folderopen', onSelect: () => api.agentReveal(folder.id).catch((e) => toast(e.message, true)) },
    ], { align: 'end' }) }, icon('more', 16));
  // The Favourites star, as an initiative's page has (panel.js sidebarButton): filled while it is one
  const star = h('button', { class: 'btn icon toggle fav', type: 'button', onclick: () => { toggleFavourite(folder.id, agent.name); paintStar(); } }, icon('star', 16));
  const paintStar = () => {
    const on = isFavourite(folder.id, agent.name);
    star.classList.toggle('on', on);
    star.setAttribute('aria-pressed', String(on));
    star.title = on ? 'In Favourites — click to remove' : 'Not in Favourites — click to add';
  };
  paintStar();
  const actions = h('div', { class: 'agents-actions' }, star, runBtn, wherePick, scheduleBtn, openIn, more);

  let running = false;
  async function run() {
    if (running) return;
    running = true;
    runBtn.disabled = true;
    await startAgent(folder, agent.name, { where });
    running = false;
    runBtn.disabled = false;
  }

  /** Open in ▾: the same run started elsewhere. Terminal sends it at once, so a command that takes arguments asks for
   *  them first; the other apps get it written and not sent (Enter, there). */
  async function launchIn(t) {
    let args = '';
    if (t.key === 'terminal' && agent.argument_hint) {
      args = await askArgs(agent, stats.last?.args || '');
      if (args === null) return;
    }
    const c = startChoices(folder.id, agent.name);
    openIn.disabled = true;
    try {
      const out = await api.agentLaunch(folder.id, agent.name, args, c.mode, c.model, c.effort, t.key, where);
      const on = out.branch ? ` (worktree on ${out.branch})` : '';
      toast(t.key === 'terminal' ? `${runMessage(agent.name, args)} opened in ${out.terminal}${on}` : `Ready in ${out.target_label}${on} — add its arguments and press Enter there`);
      if (out.recorded) { runs.load(); refreshActivity(); }
    } catch (e) { toast(e.message, true); } finally { openIn.disabled = false; }
  }

  // ── its numbers: how it has gone lately (homemodel.js agentStats), from its runs once the panel has them. Its side
  // panel's Overview, as an item's properties: a name, then the figure and what it counts ──
  let stats = agentStats([]);
  const statsBox = h('div', { class: 'fields prop-rows quiet agents-overview', role: 'list', 'aria-label': 'How it has gone, the last 30 days' });
  const stat = (label, value, sub = null, tip = '') => h('div', { class: 'field', role: 'listitem', title: tip },
    h('span', {}, label), h('div', { class: 'agents-ov-value' }, h('strong', {}, value), sub ? h('span', { class: 'muted' }, sub) : null));
  function paintStats(list) {
    stats = agentStats(list || []);
    const l = stats.last;
    const st = l ? runStatus(l) : null;
    statsBox.replaceChildren(
      stat('Last run', l ? h('button', { class: 'link-btn agents-stat-run', type: 'button', onclick: () => runs.show(l.id), title: 'Its detail' },
        statusDot(l), RUN_STATUSES[st].label) : 'Never',
      l ? agoLabel(l.at) : 'not yet'),
      stat('Runs', String(stats.runs), 'in the last 30 days'),
      stat('Success', stats.success == null ? '—' : `${Math.round(stats.success * 100)}%`,
        stats.done + stats.failed ? `${stats.done} done · ${stats.failed} failed` : 'none ended', 'Of the runs that ended done or failed'),
      stat('Usual time', stats.avgMs == null ? '—' : durationLabel(stats.avgMs), stats.avgMs == null ? null : 'per run', 'The mean time of the runs that ended'),
      stat('Cost', stats.cost >= 0.01 ? costLabel(stats.cost) : stats.cost ? '<$0.01' : '—', 'in the last 30 days'),
      stat('Cost per run', stats.avgCost == null ? '—' : costLabel(stats.avgCost) || '$0.00', stats.avgCost == null ? null : 'on average',
        'The mean cost of the runs that say one (a run in Terminal does not)'));
  }
  paintStats([]);

  // ── its tabs: its instructions, what it works with (only the kinds it has), and its details ──
  // Its files as cards (agentfile.js: Preview · Source · Edit), each built once and kept across the tabs' redraws, so
  // an edit under way survives a refresh of the page. Its own file saved: the list is read again (its description,
  // arguments… may have changed).
  const cards = new Map(); // path ('' its own) → card
  const openRows = new Set(); // the rows unfolded: they stay so when the tabs are drawn again
  const card = (path) => {
    if (!cards.has(path)) cards.set(path, agentFile({ dir: folder.id, cmd: agent.name, path, onSaved: () => { if (!path) loadAgents(); loadRelated(); } }));
    return cards.get(path).el;
  };

  const details = (a) => h('div', { class: 'fields prop-rows quiet agents-props' },
    prop('Arguments', a.argument_hint ? h('code', {}, a.argument_hint) : h('span', { class: 'muted' }, 'None')),
    prop('Allowed tools', a.allowed_tools.length ? h('div', { class: 'agents-tools' }, a.allowed_tools.map((t) => h('span', { class: 'chip mono', title: t }, t)))
      : h('span', { class: 'muted' }, 'None: it asks for each one')),
    prop('Model', a.model || h('span', { class: 'muted' }, 'The one it is run with')),
    prop('Started by', a.disable_model_invocation ? 'You only' : 'You, or Claude when it fits'),
    prop('File', h('span', { class: 'mono small agents-path', title: `${folder.path}/${a.file}` }, a.file)),
    prop('Folder', h('span', { class: 'mono small agents-path', title: folder.path }, folder.path)));

  function relatedList(kind, items) {
    const [, , ico] = RELATED.find(([k]) => k === kind);
    return h('ul', { class: 'agents-rel-list', role: 'list' }, items.map((it) => {
      const body = h('div', { class: 'agents-rel-body', hidden: true });
      const toggle = h('button', { class: 'agents-rel-row', type: 'button', 'aria-expanded': 'false', title: it.path,
        onclick: () => {
          if (kind === 'commands') { location.hash = agentHref(folder.id, it.name); return; }
          const open = toggle.getAttribute('aria-expanded') !== 'true';
          toggle.setAttribute('aria-expanded', String(open));
          body.hidden = !open;
          li.classList.toggle('open', open);
          if (open) { openRows.add(it.path); if (!body.firstChild) body.append(card(it.path)); } else openRows.delete(it.path);
        } },
      h('span', { class: 'agents-rel-ico' }, icon(ico, 14)),
      h('span', { class: 'agents-rel-text-col' },
        h('span', { class: 'agents-rel-name mono' }, kind === 'commands' ? `/${it.name}` : it.name,
          it.via ? h('span', { class: 'chip agents-rel-via', title: `Named by ${it.via}, not by its own instructions` }, `via ${it.via}`) : null),
        it.description ? h('span', { class: 'agents-rel-desc muted' }, it.description) : null),
      icon(kind === 'commands' ? 'right' : 'down', 13));
      const li = h('li', { class: 'agents-rel' }, toggle, body);
      if (openRows.has(it.path)) { toggle.setAttribute('aria-expanded', 'true'); body.hidden = false; li.classList.add('open'); body.append(card(it.path)); }
      return li;
    }));
  }

  const tabsBox = h('div', { class: 'agents-tabs' });
  let related = null;
  function paintTabs(a) {
    const tabs = [{ key: 'instructions', label: 'Instructions', content: card('') }];
    for (const [kind, label] of RELATED) {
      const items = related?.[kind] || [];
      if (items.length) tabs.push({ key: kind, label, count: items.length, content: relatedList(kind, items) });
    }
    tabs.push({ key: 'details', label: 'Details', content: details(a) });
    tabsBox.replaceChildren(...tabPanels(tabs, pref(TAB_KEY, 'instructions'), (k) => setPref(TAB_KEY, k)));
  }
  const loadRelated = () => api.agentRelated(folder.id, agent.name).then((r) => { related = r; paintTabs(current); }, () => {});

  let current = agent;
  paintTabs(agent);
  loadRelated();

  const head = h('header', { class: 'view-head agents-head-page' }, crumbs,
    h('div', { class: 'agents-title-row' }, title, actions));
  const main = h('div', { class: 'page-main agents-page', onkeydown: (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); } } },
    head, tabsBox);
  // On the right, as on an item's page (panel.js pageLayout): its runs, in a panel that folds away.
  const runs = runsPanel(folder, agent, (args) => startAgent(folder, agent.name, { args, where }), openRunId, (sch) => scheduleIt(sch), paintStats, statsBox);
  const columns = h('div', { class: 'page-body agents-body' });
  columns.append(main, h('aside', { class: 'page-side im-side tabbed agents-side' }, sideFold(columns, SIDE_KEY), ...runs.nodes));
  if (openRunId) columns.classList.remove('collapsed'); // a run asked for by the address: its detail in sight, the panel's fold left as it was
  return {
    sig: `${folder.id} ${agent.name}`,
    nodes: [h('div', { class: 'page two-panel agents-two' }, columns)],
    stop: runs.stop,
    refresh(a, f) {
      if (JSON.stringify(a) === JSON.stringify(current)) return;
      current = a;
      folder = f;
      loadRelated();
      paintTabs(a);
    },
  };
}

/** Open in Terminal of a command that takes arguments: they are asked first, as Terminal sends the message at once.
 *  → the arguments, or null when cancelled. */
function askArgs(agent, value) {
  return new Promise((resolve) => {
    const backdrop = document.getElementById('modal-backdrop');
    const modal = document.getElementById('modal');
    const opener = document.activeElement;
    const close = (out) => {
      backdrop.hidden = true; modal.className = ''; modal.replaceChildren();
      if (opener && document.contains(opener)) opener.focus();
      resolve(out);
    };
    const input = h('input', { class: 'input mono', value, placeholder: agent.argument_hint, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Arguments' });
    const form = h('form', { class: 'agents-add-form', onsubmit: (e) => { e.preventDefault(); close(input.value); } },
      h('label', { class: 'field' }, h('span', {}, 'Arguments'), input),
      h('p', { class: 'muted small' }, 'Terminal sends ', h('code', {}, `/${agent.name} …`), ' as soon as it opens.'),
      h('div', { class: 'agents-add-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'submit' }, icon('terminal', 14), 'Open in Terminal')));
    modal.className = 'agents-modal';
    modal.setAttribute('aria-label', `Open /${agent.name} in Terminal`);
    modal.replaceChildren(h('div', { class: 'modal-head' }, h('h2', {}, icon('terminal', 18), `/${agent.name} in Terminal`),
      h('button', { class: 'btn icon', title: 'Close (Esc)', onclick: () => close(null) }, icon('x', 16))), form);
    backdrop.hidden = false;
    backdrop.onclick = (e) => { if (e.target === backdrop) close(null); };
    modal.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    input.focus();
    input.select();
  });
}

// ── Its Runs: the side panel ─────────────────────────────────────────────────
const when = (at) => String(at || '').replace('T', ' ');
const SIDE_TAB_KEY = 'agents.sideTab'; // the side panel's tab last picked: Overview, Runs or Schedules
const FILE_STATUS = { M: 'Changed', A: 'New', D: 'Deleted', T: 'Type changed' };

/** The runs of one agent, newest first, as an item's AI tab lists its conversations (claude.js sessionList, on a card):
 *  each row is what it sent, its status and how it went, and when Claude Code last wrote it; on hover, its arrow
 *  (resume it in this app, or open it in Terminal, Claude Desktop, Cursor…) and its ⋯ (its arguments back into the
 *  composer, Copy the session id, Forget). A row opens the run's detail in its place: its facts, its actions, and its
 *  Changes — the files of its folder that differ from when it started, each with its diff (tm/runchanges.py).
 *  `useArgs(args)` runs it again with those arguments (in the dock, unsent); `onRuns(list)` hears each list it reads; `openId` is the run to show first (the address's ?run=, from the Inbox). */
function runsPanel(folder, agent, useArgs, openId = '', editSchedule = () => {}, onRuns = () => {}, overview = null) {
  const box = h('div', { class: 'agents-runs' });
  const schedBox = h('div', { class: 'agents-runs agents-sched-box' });
  let list = null;      // the runs, once the server answers
  let updated = null;   // { session id → last written | null }
  let detail = openId || null; // the run shown in detail, or null for the list
  // Overview first (how it has gone: the page's figures), then its Runs and Schedules; a run asked for by the address
  // opens on Runs. Which one was last picked is this browser's, for every agent.
  const [bar, ...panels] = tabPanels([
    ...(overview ? [{ key: 'overview', label: 'Overview', content: overview }] : []),
    { key: 'runs', label: 'Runs', content: box }, { key: 'schedules', label: 'Schedules', content: schedBox },
  ], openId ? 'runs' : pref(SIDE_TAB_KEY, 'overview'), (k) => setPref(SIDE_TAB_KEY, k));
  const toTab = (key) => { if (bar.querySelector(`[data-tab="${key}"]`)?.getAttribute('aria-selected') !== 'true') bar.querySelector(`[data-tab="${key}"]`)?.click(); };
  const setCount = (n, tab = 'runs') => {
    const btn = bar.querySelector(`[data-tab="${tab}"]`);
    btn.querySelector('.tab-count')?.remove();
    if (n) btn.append(h('span', { class: 'tab-count' }, String(n)));
  };

  // Its Schedules tab (agentschedules.js): this agent's schedules, each with Run now, Edit, Pause, Delete.
  let schedStamp = 0;
  async function loadSchedules() {
    const mine = ++schedStamp;
    let items;
    try { items = (await api.agentSchedules(folder.id, agent.name)).schedules || []; } catch (e) {
      schedBox.replaceChildren(h('p', { class: 'muted small cs-empty' }, e.message));
      return;
    }
    if (mine !== schedStamp) return;
    setCount(items.length, 'schedules');
    schedBox.replaceChildren(
      items.length ? scheduleList(items, { edit: editSchedule, changed: loadSchedules })
        : h('p', { class: 'muted small cs-empty' }, 'Not scheduled. Schedule… runs it on its own — every day, every weekday, on some days or every few hours.'));
  }
  loadSchedules();

  const resumeHere = async (r) => {
    try { const { resumeClaudeHere } = await import('../term.js'); await resumeClaudeHere(null, r.id); } catch { /* toasted */ }
  };
  const openMenu = (anchor, r, unsaved) => {
    const why = unsaved ? 'Nothing to resume: Claude Code never saved this conversation' : null;
    dropdown(anchor, [{ heading: 'Open the run in' },
      { label: 'This app', icon: 'panel', disabled: unsaved, title: why || `claude --resume ${r.id}, in the dock`, onSelect: () => resumeHere(r) },
      ...claudeTargets().map((t) => {
        const blocked = r.live && t.key === 'desktop';
        return { label: t.key === r.target ? `${t.label} — where it started` : t.label, icon: TARGET_ICON[t.key] || 'external',
          disabled: unsaved || blocked, title: why || (blocked ? 'Still running in the dock — close it there first' : null),
          onSelect: () => resumeClaude(null, r.id, t.key).catch(() => {}) };
      })], { align: 'end', width: 240 });
  };
  const moreMenu = (anchor, r) => dropdown(anchor, [
    { label: r.args ? 'Run again with these arguments' : 'Run it again', icon: 'play', title: 'Opens it in the dock with these arguments written, not sent', onSelect: () => useArgs(r.args || '') },
    { label: 'Copy session id', icon: 'copy', onSelect: () => navigator.clipboard.writeText(r.id).then(() => toast('Session id copied'), () => toast('Could not copy', true)) },
    r.branch ? { label: 'Copy branch name', icon: 'branch', onSelect: () => navigator.clipboard.writeText(r.branch).then(() => toast('Branch name copied'), () => toast('Could not copy', true)) } : null,
    '-',
    r.worktree && !r.removed_ts ? { label: 'Remove worktree…', icon: 'trash', title: `Takes ${r.worktree} away; the branch ${r.branch} stays`,
      disabled: Boolean(r.live), onSelect: () => removeWorktree(r) } : null,
    { label: 'Forget this run', icon: 'trash', danger: true, title: 'The conversation itself stays in Claude Code', onSelect: async () => {
      try {
        await api.agentRunForget(r.id);
        if (detail === r.id) detail = null;
        load();
        refreshActivity();
      } catch (e) { toast(e.message, true); }
    } },
  ].filter(Boolean), { align: 'end' });

  /** Takes a run's worktree away, its branch kept: asked first when it holds changes nobody committed. */
  async function removeWorktree(r, force = false) {
    try {
      const out = await api.agentRunRemoveWorktree(r.id, force);
      if (out.dirty) {
        if (confirm(`${out.message}.\n\nRemove it anyway? The branch ${r.branch} stays, with what was committed on it.`)) await removeWorktree(r, true);
        return;
      }
      toast(`Worktree removed — the branch ${out.branch} stays`);
      load();
    } catch (e) { toast(e.message, true); }
  }
  const unsavedOf = (r) => Boolean(updated && !updated[r.id] && !r.live); // a run still starting has written nothing yet

  /** Shows run `id` in detail (null: back to the list); its result is seen, so it is read. */
  function show(id) {
    if (id) toTab('runs');
    detail = id;
    drawn = '';
    paint();
    const r = id && list?.find((x) => x.id === id);
    if (r && isUnread(r)) markRead([r.id]);
  }

  const row = (r) => {
    const title = runMessage(agent.name, r.args);
    const unsaved = unsavedOf(r);
    const last = updated ? (updated[r.id] ? agoLabel(updated[r.id]) : agoLabel(r.at)) : '…';
    const go = h('button', { class: 'btn icon', title: unsaved ? 'Nothing to resume: Claude Code never saved this conversation' : 'Open in…',
      'aria-label': `Open ${title}`, 'aria-haspopup': 'menu', onclick: (e) => { e.stopPropagation(); openMenu(go, r, unsaved); } }, icon('external', 14));
    const more = h('button', { class: 'btn icon', title: 'More actions', 'aria-label': `More actions for ${title}`, 'aria-haspopup': 'menu',
      onclick: (e) => { e.stopPropagation(); moreMenu(more, r); } }, icon('more', 14));
    const st = RUN_STATUSES[runStatus(r)];
    return h('li', { class: `cs-item surface-card hover-host agents-run-row${r.live ? ' live' : ''}${isUnread(r) ? ' unread' : ''}`, tabindex: '0', role: 'button',
      'aria-label': `${title}: ${st.label}. Show its detail`, onclick: () => show(r.id),
      onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) show(r.id); } },
    statusDot(r),
    h('div', { class: 'cs-item-text', title: [title, `${st.label} · ${runLabel(r)}`, runMeta(r).join(' · '),
      `Started ${when(r.at)} · Updated ${updated?.[r.id] ? when(updated[r.id]) : '—'}`, r.cwd, r.id].join('\n') },
      h('span', { class: 'cs-item-title mono' }, title),
      h('span', { class: 'cs-item-meta muted' }, ...[runLabel(r), last].filter(Boolean).flatMap((part, i) => [i ? ' · ' : null, h('span', { class: 'nowrap' }, part)]),
        r.target === 'terminal' ? [' · ', h('span', { class: 'nowrap', title: 'Started in Terminal' }, icon('terminal', 11), ' Terminal')] : null,
        r.branch ? [' · ', h('span', { class: 'nowrap', title: `In a worktree on ${r.branch}${r.removed_ts ? ' (removed)' : ''}` }, icon('branch', 11), ' Worktree')] : null,
        unsaved ? h('span', { class: 'chip warn', title: 'Claude Code has no conversation saved for this run: it cannot be resumed' }, 'not saved') : null)),
    h('div', { class: 'cs-item-actions hover-reveal' }, go, more));
  };

  /** The folder a run ran in, short: the agent's folder by its name, a folder inside it (a worktree) by its path from
   *  there, any other by its path. */
  const whereIn = (cwd) => (cwd === folder.path ? folder.name
    : String(cwd || '').startsWith(`${folder.path}/`) ? `${folder.name}/${cwd.slice(folder.path.length + 1)}` : cwd);

  // ── the detail of one run ──
  function detailView(r) {
    const title = runMessage(agent.name, r.args);
    const st = runStatus(r);
    const unsaved = unsavedOf(r);
    const modeLabel = RUN_MODES.find(([m]) => m === (r.mode || 'default'))?.[1] || r.mode;
    const openIn = h('button', { class: 'btn small ghost', type: 'button', 'aria-haspopup': 'menu', title: 'Open the run in another app',
      onclick: () => openMenu(openIn, r, unsaved) }, icon('external', 13), 'Open in ▾');
    const more = h('button', { class: 'btn icon small', type: 'button', title: 'More actions', 'aria-label': 'More actions', 'aria-haspopup': 'menu',
      onclick: () => moreMenu(more, r) }, icon('more', 14));
    const stop = r.live && (r.busy || r.pending) ? h('button', { class: 'btn small ghost danger', type: 'button', title: 'Stop the turn it is on: the conversation stays',
      onclick: async () => { try { await api.chatInterrupt(r.id); toast(`${title} stopped`); load(); } catch (e) { toast(e.message, true); } } }, icon('x', 13), 'Stop') : null;
    return [
      h('button', { class: 'btn small ghost agents-back', type: 'button', onclick: () => show(null) }, icon('left', 13), 'Runs'),
      h('div', { class: 'agents-run-head' },
        h('div', { class: 'agents-run-status' }, statusDot(r), h('strong', {}, RUN_STATUSES[st].label), h('span', { class: 'muted' }, runLabel(r))),
        h('p', { class: 'agents-run-title mono' }, title)),
      h('div', { class: 'agents-run-actions' },
        h('button', { class: `btn small ${st === 'needs_you' ? 'primary' : 'secondary'}`, type: 'button', disabled: unsaved,
          title: unsaved ? 'Nothing to resume: Claude Code never saved this conversation' : r.live ? 'Bring it to the front in the dock' : `claude --resume ${r.id}, in the dock`,
          onclick: () => resumeHere(r) }, icon('panel', 13), r.live ? 'Show in dock' : 'Open in dock'),
        stop, openIn, more),
      h('div', { class: 'fields prop-rows quiet agents-run-facts' },
        prop('Started', h('span', { title: when(r.at) }, `${agoLabel(r.at)} · ${when(r.at).slice(11, 16)}`)),
        prop('Where', r.target === 'terminal' ? 'Terminal' : r.source === 'schedule' ? 'This app, by a schedule' : 'This app (the dock)'),
        prop('Folder', h('span', { class: 'mono agents-run-cwd', title: r.cwd }, whereIn(r.cwd), r.removed_ts ? h('span', { class: 'muted' }, ' — removed') : null)),
        r.branch ? prop('Branch', h('span', { class: 'agents-run-branch' }, icon('branch', 12), h('code', { title: r.branch }, r.branch))) : null,
        prop('Mode', modeLabel),
        prop('Model', [r.model || 'The default', r.effort ? ` · ${r.effort} effort` : ''].join('')),
        r.turns ? prop('Turns', String(r.turns)) : null,
        r.cost ? prop('Cost', costLabel(r.cost)) : null,
        prop('Session', h('code', { class: 'agents-run-id', title: `${r.id}\nCopy it from ⋯` }, `${r.id.slice(0, 8)}…`))),
      changesBox,
    ];
  }

  // ── its Changes: kept apart from the rows, so a look again by the panel leaves an open diff as it is ──
  const changesBox = h('section', { class: 'agents-changes', 'aria-label': 'Changes' });
  const changes = { id: null, st: '', data: null, error: '', loading: false, open: new Set(), diffs: new Map() };
  function loadChanges(r) {
    const id = r.id;
    changes.loading = true;
    api.agentRunChanges(id).then((d) => { if (changes.id === id) { changes.data = d; changes.error = ''; } },
      (e) => { if (changes.id === id) changes.error = e.message; }).finally(() => {
      if (changes.id !== id) return;
      changes.loading = false;
      changes.diffs.clear();
      changes.open.forEach((p) => loadDiff(id, p));
      drawChanges();
    });
  }
  function loadDiff(id, path) {
    api.agentRunDiff(id, path).then((d) => changes.diffs.set(path, d), (e) => changes.diffs.set(path, { error: e.message }))
      .finally(() => { if (changes.id === id) drawChanges(); });
  }
  function drawChanges() {
    const d = changes.data;
    const run = list?.find((x) => x.id === changes.id);
    const files = run?.removed_ts ? [] : d?.files || [];
    const add = files.reduce((n, f) => n + (f.added || 0), 0);
    const del = files.reduce((n, f) => n + (f.deleted || 0), 0);
    const again = h('button', { class: 'btn icon small', type: 'button', title: 'Look again', 'aria-label': 'Look at its changes again',
      onclick: () => { const r = list?.find((x) => x.id === changes.id); if (r) loadChanges(r); } }, icon('reset', 13));
    const head = h('h3', { class: 'agents-section-title agents-changes-head' }, 'Changes',
      files.length ? h('span', { class: 'muted' }, String(files.length)) : null,
      files.length ? h('span', { class: 'cv-counts' }, h('span', { class: 'add' }, `+${add}`), del ? [' ', h('span', { class: 'del' }, `−${del}`)] : null) : null,
      h('span', { class: 'spacer' }), again);
    const say = (text) => h('p', { class: 'muted small agents-changes-msg' }, text);
    let body;
    if (run?.removed_ts) body = say(`Its worktree was removed: nothing to compare with. What it committed is on its branch, ${run.branch}.`);
    else if (changes.error) body = say(changes.error);
    else if (!d) body = say('Looking…');
    else if (!d.git) body = say('Nothing to compare with: its folder is not a git repository, or it started before this app noted where the folder stood.');
    else if (d.error) body = say(d.error);
    else if (!files.length) body = say('Nothing changed in its folder since it started.');
    else body = h('ul', { class: 'agents-files', role: 'list' }, files.map(fileRow));
    changesBox.replaceChildren(head, body, ...(files.length
      ? [h('p', { class: 'muted small agents-changes-note' }, 'What differs in its folder from when it started: a change made there meanwhile, by anyone, shows too.')] : []));
  }
  function fileRow(f) {
    const open = changes.open.has(f.path);
    const name = f.path.split('/').pop();
    const dir = f.path.slice(0, f.path.length - name.length);
    const toggle = h('button', { class: 'agents-file-btn', type: 'button', 'aria-expanded': String(open), title: `${f.path}\n${FILE_STATUS[f.status] || f.status}`,
      onclick: () => {
        if (changes.open.has(f.path)) changes.open.delete(f.path);
        else { changes.open.add(f.path); if (!changes.diffs.has(f.path)) loadDiff(changes.id, f.path); }
        drawChanges();
      } },
    icon(open ? 'down' : 'right', 12),
    h('span', { class: `agents-fstatus fs-${f.status}`, 'aria-label': FILE_STATUS[f.status] || f.status }, f.status),
    h('span', { class: 'agents-fpath mono' }, dir ? h('span', { class: 'muted' }, dir) : null, name),
    h('span', { class: 'cv-counts' }, f.binary ? 'binary' : [f.added != null ? h('span', { class: 'add' }, `+${f.added}`) : null, ' ',
      f.deleted ? h('span', { class: 'del' }, `−${f.deleted}`) : null]));
    let shown = null;
    if (open) {
      const got = changes.diffs.get(f.path);
      shown = !got ? h('p', { class: 'muted small agents-changes-msg' }, 'Reading…')
        : got.error ? h('p', { class: 'muted small agents-changes-msg' }, got.error)
          : got.binary ? h('p', { class: 'muted small agents-changes-msg' }, 'A binary file: no lines to show.')
            : [diffBlock(parseUnifiedDiff(got.diff)), got.truncated ? h('p', { class: 'muted small agents-changes-msg' }, 'Cut short: the rest is too long to show here.') : null];
    }
    return h('li', { class: `agents-change${open ? ' open' : ''}` }, toggle, shown);
  }

  const render = () => {
    if (!list) { box.replaceChildren(h('p', { class: 'muted small cs-empty' }, 'Reading its runs…')); return; }
    setCount(list.length);
    const r = detail && list.find((x) => x.id === detail);
    if (detail && !r) {
      box.replaceChildren(h('button', { class: 'btn small ghost agents-back', type: 'button', onclick: () => show(null) }, icon('left', 13), 'Runs'),
        h('p', { class: 'muted small cs-empty' }, 'That run is not on record any more.'));
      return;
    }
    if (r) {
      const st = runStatus(r);
      if (changes.id !== r.id) { Object.assign(changes, { id: r.id, st: '', data: null, error: '', loading: false }); changes.open.clear(); changes.diffs.clear(); }
      if (!changes.loading && (changes.st !== st || !changes.data)) { changes.st = st; loadChanges(r); } // it moved on: its files may have too
      drawChanges();
      box.replaceChildren(h('div', { class: 'agents-run-detail' }, ...detailView(r)));
      return;
    }
    if (!list.length) {
      box.replaceChildren(h('p', { class: 'muted small cs-empty' }, 'No runs yet — Run opens it in the dock, Open in ▾ in Terminal. Each one resumes from here.'));
      return;
    }
    const page = paged({ key: 'agents.runs', at: `agents.runs.${folder.id} ${agent.name}`, rows: list, size: DETAIL_PAGE * 2, onChange: render });
    box.replaceChildren(h('ul', { class: 'cs-list', 'aria-label': `Runs of /${agent.name}` }, page.rows.map(row)), ...(page.pager ? [page.pager] : []));
  };
  let stamp = 0;
  let drawn = ''; // what the panel shows now: drawn again only when it changes (a row being hovered or its menu open stays)
  const paint = () => {
    const now = JSON.stringify([list, updated, detail]);
    if (now !== drawn) { drawn = now; render(); }
  };
  async function load() {
    const mine = ++stamp;
    try {
      const r = await api.agentRuns(folder.id, agent.name);
      if (mine !== stamp) return;
      list = r.runs || [];
      onRuns(list);
    } catch (e) { drawn = ''; box.replaceChildren(h('p', { class: 'muted small cs-empty' }, e.message)); return; }
    paint();
    if (openId) { // the address asked for this run (the Inbox): it is seen now
      const r = list.find((x) => x.id === openId);
      if (r && isUnread(r)) markRead([r.id]);
      openId = '';
    }
    // When Claude Code last wrote each one (its transcript): unknown is left as the start, never taken as "not saved".
    api.claudeUpdated(list).then((u) => { if (mine === stamp) { updated = u.updated || {}; paint(); } }, () => {});
  }
  render();
  load();
  // A run of this agent that changed (it started, waits for you, ended): the Inbox's look tells (agentactivity.js).
  let mine = '';
  const off = onActivity((a) => {
    const now = JSON.stringify((a.runs || []).filter((r) => r.dir === folder.id && r.cmd === agent.name));
    if (now !== mine) { mine = now; load(); loadSchedules(); } // a scheduled one started: its schedule moved on
  });
  const showSchedules = () => { loadSchedules(); toTab('schedules'); };
  return { nodes: [bar, ...panels], load, showSchedules, show, showing: () => Boolean(detail), stop: () => { off(); stamp += 1; schedStamp += 1; } };
}

const prop = (label, value) => h('div', { class: 'field' }, h('span', {}, label), h('div', { class: 'agents-value' }, value));
