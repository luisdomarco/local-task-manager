// The Agents section's middle (its sidebar is agentspane.js).
// #/runs: the Home (views/agentshome.js) — the week, what needs you, runs now, up next, your agents, recent results.
// #/runs/inbox: the Inbox — every run of every agent on this computer (agentactivity.js), grouped by what it asks of you:
// Needs you, Running, Unread, Earlier; a search and filters by status, folder and where it came from.
// #/runs/all: every agent folder and its agents, in rows.
// #/runs/<folder id>/<name>: one agent — its head (where it lives, its name as typed in Claude Code, what it does, and
// Run · Schedule… · Open in ▾), how it has gone the last 30 days, and its tabs: its Instructions (its prompt), what it
// works with — Skills, Subagents, Commands, Files of its folder (tm/agentlinks.py), each tab only when it has some — and
// its Details. Run opens its chat in the dock with the command written, not sent (agentstart.js): the arguments, mode,
// model and effort are settled in the dock's composer, the only one. Open in ▾ starts it in Terminal, Claude Desktop,
// Cursor or Antigravity instead. On the right, as on an item's page, its Runs and Schedules (tm/agentruns.py).
import { activity, markRead, onActivity, openRun, refreshActivity } from '../agentactivity.js';
import { scheduleDialog, scheduleList } from '../agentschedules.js';
import { startAgent, startChoices } from '../agentstart.js';
import { homePage } from './agentshome.js';
import { agentDirs, onAgents, loadAgents, addFolderDialog } from '../agentspane.js';
import { agentHref, parseRunsParam, runMessage, runMeta, RUN_MODES, RUN_PLACES } from '../agentsmodel.js';
import { api } from '../api.js';
import { TARGET_ICON, claudeTargets, openInMenu, resumeClaude } from '../claude.js';
import { DETAIL_PAGE, paged } from '../datatable.js';
import { agoLabel } from '../dates.js';
import { sideFold } from '../itemform.js';
import { pref, setPref } from '../prefs.js';
import { diffBlock } from '../diffview.js';
import { agentStats } from '../homemodel.js';
import { costLabel, durationLabel, filterRuns, groupActivity, inboxCount, isUnread, RUN_SOURCES, RUN_STATUSES, runLabel, runStatus } from '../runmodel.js';
import { parseUnifiedDiff } from '../udiff.js';
import { state, toast } from '../state.js';
import { setAlertTitle, setPageTitle } from '../tabtitle.js';
import { dropdown, emptyState, h, icon, pageEmpty, pageHead, renderMarkdown, searchBox, secondaryButton, select, tabPanels } from '../ui.js';

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
    if (!name) { view?.stop(); view = null; root.replaceChildren(...overview(dirs)); setPageTitle('Agents'); return; }
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
      h('p', {}, 'Run your Claude Code agents from here instead of a terminal.'),
      h('p', { class: 'muted' }, 'Add a folder (a repository, a system…): every command in its ', h('code', {}, '.claude/commands'),
        ' is an agent. It runs in that folder, as a chat in the dock, where you answer its questions and permissions.'))];
}

/** Home · Inbox · All agents: the pages of the section that are not an agent's, as a section's tab links; the Inbox's
 *  with what waits for you or ended unseen. */
const sectionTabs = (on) => {
  const n = inboxCount(activity()?.counts);
  return h('nav', { class: 'tabs-bar section-tabs', 'aria-label': 'Agents' },
    [['home', 'Home', 'home', '#/runs'], ['inbox', 'Inbox', 'inbox', '#/runs/inbox'], ['all', 'All agents', 'zap', '#/runs/all']].map(([key, text, ico, href]) => h('a', {
      class: `tab-btn ${key === on ? 'active' : ''}`, href, ...(key === on ? { 'aria-current': 'page' } : {}),
    }, icon(ico, 14), text, key === 'inbox' && n ? h('span', { class: 'tab-count' }, String(n)) : null)));
};

// ── #/runs/inbox: the Inbox ──────────────────────────────────────────────────
const FILTERS = 'agents.inbox'; // { status, dir, source }: this browser's
const STATUS_OPTIONS = [['', 'Any status'], ...Object.entries(RUN_STATUSES).map(([k, v]) => [k, v.label])];
const SOURCE_OPTIONS = [['', 'Anywhere'], ...RUN_SOURCES];

/** A run's status as the dock draws a session's: its dot and its word. */
const statusDot = (r) => {
  const st = RUN_STATUSES[runStatus(r)];
  return h('span', { class: `td-dot tone-${st.tone}`, title: st.label, 'aria-hidden': 'true' });
};

function inboxPage(dirs) {
  const saved = pref(FILTERS, {}) || {};
  const f = { q: '', status: saved.status || '', dir: saved.dir || '', source: saved.source || '' };
  const keep = () => setPref(FILTERS, { status: f.status, dir: f.dir, source: f.source });
  const count = h('span', { class: 'muted view-count' });
  const list = h('div', { class: 'agents-inbox-list' });
  const q = h('input', { type: 'search', placeholder: 'Search runs', 'aria-label': 'Search runs', oninput: () => { f.q = q.value; paint(true); } });
  const pickOf = (options, key, label) => select(options, f[key], (v) => { f[key] = v || ''; keep(); paint(true); }, { class: 'small', 'aria-label': label, title: label });
  const folderPick = () => pickOf([['', 'Every folder'], ...dirs.map((d) => [d.id, d.name])], 'dir', 'Folder');
  let folderBox = h('span', { class: 'agents-folder-pick' }, folderPick());
  const readAll = h('button', { class: 'btn small ghost', type: 'button', title: 'Mark every run that ended as seen',
    onclick: () => markRead((activity()?.runs || []).filter(isUnread).map((r) => r.id)) }, icon('check', 13), 'Mark all read');
  const bar = h('div', { class: 'view-bar agents-inbox-bar' }, searchBox(q), pickOf(STATUS_OPTIONS, 'status', 'Status'), folderBox,
    pickOf(SOURCE_OPTIONS, 'source', 'Started from'), h('span', { class: 'spacer' }), readAll);

  let drawn = '';
  function paint(force = false) {
    const data = activity();
    const now = JSON.stringify([data, f]);
    if (!force && now === drawn) return;
    drawn = now;
    if (!data) { list.replaceChildren(pageEmpty('Reading the runs…')); return; }
    const all = data.runs || [];
    readAll.hidden = !all.some(isUnread);
    const runs = filterRuns(all, f);
    count.textContent = all.length ? `${all.length} run${all.length === 1 ? '' : 's'}` : '';
    if (!all.length) { list.replaceChildren(pageEmpty('No runs yet. Open an agent in the sidebar and Run it: its run shows here, and here is where it tells you when it needs you.')); return; }
    if (!runs.length) { list.replaceChildren(pageEmpty('No run matches.')); return; }
    list.replaceChildren(...groupActivity(runs).map((g) => {
      const page = g.key === 'earlier' ? paged({ key: 'agents.inbox', rows: g.runs, size: DETAIL_PAGE * 2, onChange: () => paint(true) }) : { rows: g.runs, pager: null };
      return h('section', { class: `agents-inbox-group group-${g.key}`, 'aria-label': g.label },
        h('h2', { class: 'agents-section-title' }, g.label, h('span', { class: 'muted' }, String(g.runs.length))),
        h('ul', { class: 'cs-list' }, page.rows.map(inboxRow)), page.pager);
    }));
  }
  function inboxRow(r) {
    const title = runMessage(r.cmd, r.args);
    const unread = isUnread(r);
    const more = h('button', { class: 'btn icon', title: 'More actions', 'aria-label': `More actions for ${title}`, 'aria-haspopup': 'menu',
      onclick: (e) => { e.stopPropagation(); inboxMenu(more, r); } }, icon('more', 14));
    const open = () => openRun(r);
    return h('li', { class: `cs-item surface-card hover-host agents-inbox-row${unread ? ' unread' : ''}`, tabindex: '0', role: 'button',
      title: [title, `${r.dir_name || ''} · started ${when(r.at)}`, r.live && ['needs_you', 'working'].includes(runStatus(r)) ? 'Opens in the dock' : 'Shows what it did and changed'].join('\n'),
      onclick: open, onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); } },
    statusDot(r),
    h('div', { class: 'cs-item-text' },
      h('span', { class: 'cs-item-title mono' }, title),
      h('span', { class: 'cs-item-meta muted' }, h('strong', { class: 'agents-status-word' }, RUN_STATUSES[runStatus(r)].label), ' · ', runLabel(r),
        r.dir_name ? [' · ', h('span', { class: 'nowrap' }, r.dir_name)] : null, ' · ', h('span', { class: 'nowrap' }, agoLabel(r.at)),
        r.source === 'schedule' ? [' · ', h('span', { class: 'nowrap' }, icon('clock', 11), ' Scheduled')] : null)),
    unread ? h('span', { class: 'agents-unread', title: 'Ended: not seen yet', 'aria-label': 'Not seen yet' }) : null,
    h('div', { class: 'cs-item-actions hover-reveal' }, more));
  }
  function inboxMenu(anchor, r) {
    dropdown(anchor, [
      { label: 'Show its detail', icon: 'panel', onSelect: () => { location.hash = `${agentHref(r.dir, r.cmd)}?run=${encodeURIComponent(r.id)}`; } },
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
    nodes: [pageHead({ title: 'Inbox', count, action: secondaryButton('Add folder', { ico: 'plus', onclick: () => addFolderDialog() }) }), sectionTabs('inbox'), bar, list],
    stop: off,
    refresh(next) {
      dirs = next;
      const fresh = h('span', { class: 'agents-folder-pick' }, folderPick());
      folderBox.replaceWith(fresh);
      folderBox = fresh;
      paint(true);
    },
  };
}

// ── #/runs/all: the folders and their agents ─────────────────────────────────
function overview(dirs) {
  const total = dirs.reduce((n, d) => n + d.commands.length, 0);
  const add = secondaryButton('Add folder', { ico: 'plus', onclick: () => addFolderDialog() });
  return [
    pageHead({ title: 'Agents', count: h('span', { class: 'muted view-count' }, String(total)), action: add }), sectionTabs('all'),
    ...dirs.map((d) => h('section', { class: 'agents-group' },
      h('div', { class: 'agents-group-head' },
        h('h2', {}, d.name), h('span', { class: 'muted small agents-group-path', title: d.path }, d.path),
        h('span', { class: 'spacer' }), h('span', { class: 'muted small' }, d.exists ? `${d.commands.length}` : 'not found')),
      d.commands.length ? h('div', { class: 'agents-rows', role: 'list' }, d.commands.map((c) => agentRow(d, c)))
        : h('p', { class: 'muted small agents-none' }, d.exists ? 'No commands in its .claude/commands.' : 'This folder is not there any more: remove it in Settings → Agents.'))),
  ];
}

function agentRow(d, c) {
  return h('a', { class: 'agents-row', role: 'listitem', href: agentHref(d.id, c.name), title: c.argument_hint ? `/${c.name} ${c.argument_hint}` : `/${c.name}` },
    icon('slash', 15), h('span', { class: 'agents-row-name' }, `/${c.name}`),
    h('span', { class: 'agents-row-desc' }, c.description || h('span', { class: 'muted' }, 'No description')),
    c.argument_hint ? h('code', { class: 'agents-row-hint' }, c.argument_hint) : null);
}

// ── #/runs/<folder>/<name>: one agent ────────────────────────────────────────
const TAB_KEY = 'agents.tab'; // the agent page's tab last shown: one choice for every agent
const RELATED = [ // its tabs of what it works with (tm/agentlinks.py), shown only when there is something in them
  ['skills', 'Skills', 'book', 'Skills of its folder its instructions name (or a subagent of it does)'],
  ['agents', 'Subagents', 'bot', 'Subagents of its folder it hands work to'],
  ['commands', 'Commands', 'slash', 'Other commands of its folder it names'],
  ['files', 'Files', 'file', 'Files of its folder it points at'],
];

function agentPage(folder, agent, openRunId = '') {
  const editor = state.config.editor_app || 'Cursor';
  const openFile = () => api.agentOpenFile(folder.id, agent.name).catch((e) => toast(e.message, true));
  let where = folder.git && pref('agents.where', 'here') === 'worktree' ? 'worktree' : 'here';

  // ── the head: where it lives, its name, what it does, and what to do with it ──
  const crumbs = h('nav', { class: 'agents-crumbs muted small', 'aria-label': 'Where it lives' },
    icon('folder', 13), h('a', { href: '#/runs/all', title: folder.path }, folder.name),
    ...(agent.ns ? agent.ns.split(':').flatMap((n) => [h('span', { class: 'agents-crumb-sep', 'aria-hidden': 'true' }, '/'), h('span', {}, n)]) : []));
  const title = h('h1', { class: 'agents-title' }, `/${agent.name}`);
  const desc = h('p', { class: 'agents-desc' });

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
      { label: `Open its file in ${editor}`, icon: 'pencil', onSelect: openFile },
      { label: 'Copy the command', icon: 'copy', onSelect: () => navigator.clipboard.writeText(`/${agent.name}`).then(() => toast(`/${agent.name} copied`), () => toast('Could not copy', true)) },
      { label: 'Show its folder in Finder', icon: 'folderopen', onSelect: () => api.agentReveal(folder.id).catch((e) => toast(e.message, true)) },
    ], { align: 'end' }) }, icon('more', 16));
  const actions = h('div', { class: 'agents-actions' }, wherePick, runBtn, scheduleBtn, openIn, more);

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

  // ── its numbers: how it has gone lately (homemodel.js agentStats), from its runs once the panel has them ──
  let stats = agentStats([]);
  const statsBox = h('div', { class: 'agents-stats', role: 'list', 'aria-label': 'How it has gone, the last 30 days' });
  const stat = (label, value, sub = null, tip = '') => h('div', { class: 'agents-stat', role: 'listitem', title: tip },
    h('span', { class: 'agents-stat-label' }, label), h('span', { class: 'agents-stat-value' }, value), sub ? h('span', { class: 'agents-stat-sub muted' }, sub) : null);
  function paintStats(list) {
    stats = agentStats(list || []);
    const l = stats.last;
    const st = l ? runStatus(l) : null;
    statsBox.replaceChildren(
      stat('Last run', l ? h('button', { class: 'link-btn agents-stat-run', type: 'button', onclick: () => runs.show(l.id), title: 'Its detail' },
        statusDot(l), RUN_STATUSES[st].label) : 'Never',
      l ? agoLabel(l.at) : 'not yet'),
      stat('Runs', String(stats.runs), 'in 30 days'),
      stat('Success', stats.success == null ? '—' : `${Math.round(stats.success * 100)}%`,
        stats.done + stats.failed ? `${stats.done} done · ${stats.failed} failed` : 'none ended', 'Of the runs that ended done or failed'),
      stat('Usual time', stats.avgMs == null ? '—' : durationLabel(stats.avgMs), 'per run', 'The mean time of the runs that ended'),
      stat('Cost', stats.cost >= 0.01 ? costLabel(stats.cost) : stats.cost ? '<$0.01' : '—', 'in 30 days'));
  }
  paintStats([]);

  // ── its tabs: its instructions, what it works with (only the kinds it has), and its details ──
  const prompt = h('div', { class: 'md agents-prompt' }, h('p', { class: 'muted' }, 'Reading…'));
  const instructions = () => h('section', { class: 'agents-doc' },
    h('div', { class: 'agents-doc-head' }, icon('text', 13), h('span', { class: 'mono' }, agent.file),
      h('button', { class: 'link-btn small', type: 'button', title: `${folder.path}/${agent.file}`, onclick: openFile }, `Open in ${editor}`)),
    prompt);
  const loadPrompt = (a) => api.agentCommand(folder.id, a.name).then((r) => {
    prompt.innerHTML = r.command.body.trim() ? renderMarkdown(r.command.body) : '<p class="muted">Empty.</p>'; // sanitized by renderMarkdown (DOMPurify)
  }, (e) => { prompt.replaceChildren(h('p', { class: 'muted' }, e.message)); });

  const details = (a) => h('div', { class: 'fields prop-rows quiet agents-props' },
    prop('Arguments', a.argument_hint ? h('code', {}, a.argument_hint) : h('span', { class: 'muted' }, 'None')),
    prop('Allowed tools', a.allowed_tools.length ? h('div', { class: 'agents-tools' }, a.allowed_tools.map((t) => h('span', { class: 'chip mono', title: t }, t)))
      : h('span', { class: 'muted' }, 'None: it asks for each one')),
    prop('Model', a.model || h('span', { class: 'muted' }, 'The one it is run with')),
    prop('Started by', a.disable_model_invocation ? 'You only' : 'You, or Claude when it fits'),
    prop('File', h('button', { class: 'link-btn mono small agents-file', type: 'button', title: `Open in ${editor}`, onclick: openFile }, a.file)),
    prop('Folder', h('span', { class: 'mono small agents-path', title: folder.path }, folder.path)));

  const opened = new Map(); // path → its body, read once
  function relatedList(kind, items) {
    const [, , ico] = RELATED.find(([k]) => k === kind);
    return h('ul', { class: 'agents-rel-list', role: 'list' }, items.map((it) => {
      const body = h('div', { class: 'agents-rel-body', hidden: true });
      const toggle = h('button', { class: 'agents-rel-row', type: 'button', 'aria-expanded': 'false', title: it.path,
        onclick: async () => {
          if (kind === 'commands') { location.hash = agentHref(folder.id, it.name); return; }
          const open = toggle.getAttribute('aria-expanded') !== 'true';
          toggle.setAttribute('aria-expanded', String(open));
          body.hidden = !open;
          if (!open || opened.has(it.path)) return;
          body.replaceChildren(h('p', { class: 'muted small' }, 'Reading…'));
          try {
            const f = await api.agentRelatedFile(folder.id, agent.name, it.path);
            opened.set(it.path, f);
            body.replaceChildren(h('p', { class: 'muted small mono agents-rel-path' }, it.path), f.markdown
              ? Object.assign(h('div', { class: 'md agents-prompt' }), { innerHTML: renderMarkdown(f.body || '') }) // sanitized (DOMPurify)
              : h('pre', { class: 'agents-rel-text' }, f.body));
          } catch (e) { body.replaceChildren(h('p', { class: 'muted small' }, e.message)); }
        } },
      h('span', { class: 'agents-rel-ico' }, icon(ico, 14)),
      h('span', { class: 'agents-rel-text-col' },
        h('span', { class: 'agents-rel-name mono' }, kind === 'commands' ? `/${it.name}` : it.name,
          it.via ? h('span', { class: 'chip agents-rel-via', title: `Named by ${it.via}, not by its own instructions` }, `via ${it.via}`) : null),
        it.description ? h('span', { class: 'agents-rel-desc muted' }, it.description) : null),
      icon(kind === 'commands' ? 'right' : 'down', 13));
      return h('li', { class: 'agents-rel' }, toggle, body);
    }));
  }

  const tabsBox = h('div', { class: 'agents-tabs' });
  let related = null;
  function paintTabs(a) {
    const tabs = [{ key: 'instructions', label: 'Instructions', content: instructions() }];
    for (const [kind, label] of RELATED) {
      const items = related?.[kind] || [];
      if (items.length) tabs.push({ key: kind, label, count: items.length, content: relatedList(kind, items) });
    }
    tabs.push({ key: 'details', label: 'Details', content: details(a) });
    tabsBox.replaceChildren(...tabPanels(tabs, pref(TAB_KEY, 'instructions'), (k) => setPref(TAB_KEY, k)));
  }
  const loadRelated = () => api.agentRelated(folder.id, agent.name).then((r) => { related = r; paintTabs(current); }, () => {});

  const paintHead = (a) => { desc.textContent = a.description || ''; desc.hidden = !a.description; };
  let current = agent;
  paintHead(agent);
  paintTabs(agent);
  loadPrompt(agent);
  loadRelated();

  const head = h('header', { class: 'view-head agents-head-page' }, crumbs,
    h('div', { class: 'agents-title-row' }, h('div', { class: 'agents-title-col' }, title, desc), actions));
  const main = h('div', { class: 'page-main agents-page', onkeydown: (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); } } },
    head, statsBox, tabsBox);
  // On the right, as on an item's page (panel.js pageLayout): its runs, in a panel that folds away.
  const runs = runsPanel(folder, agent, (args) => startAgent(folder, agent.name, { args, where }), openRunId, (sch) => scheduleIt(sch), paintStats);
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
      paintHead(a);
      loadPrompt(a);
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
const FILE_STATUS = { M: 'Changed', A: 'New', D: 'Deleted', T: 'Type changed' };

/** The runs of one agent, newest first, as an item's AI tab lists its conversations (claude.js sessionList, on a card):
 *  each row is what it sent, its status and how it went, and when Claude Code last wrote it; on hover, its arrow
 *  (resume it in this app, or open it in Terminal, Claude Desktop, Cursor…) and its ⋯ (its arguments back into the
 *  composer, Copy the session id, Forget). A row opens the run's detail in its place: its facts, its actions, and its
 *  Changes — the files of its folder that differ from when it started, each with its diff (tm/runchanges.py).
 *  `useArgs(args)` runs it again with those arguments (in the dock, unsent); `onRuns(list)` hears each list it reads; `openId` is the run to show first (the address's ?run=, from the Inbox). */
function runsPanel(folder, agent, useArgs, openId = '', editSchedule = () => {}, onRuns = () => {}) {
  const box = h('div', { class: 'agents-runs' });
  const schedBox = h('div', { class: 'agents-runs agents-sched-box' });
  let list = null;      // the runs, once the server answers
  let updated = null;   // { session id → last written | null }
  let detail = openId || null; // the run shown in detail, or null for the list
  const [bar, ...panels] = tabPanels([{ key: 'runs', label: 'Runs', content: box }, { key: 'schedules', label: 'Schedules', content: schedBox }], 'runs');
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
  const showSchedules = () => { loadSchedules(); bar.querySelector('[data-tab="schedules"]')?.click(); };
  return { nodes: [bar, ...panels], load, showSchedules, show, showing: () => Boolean(detail), stop: () => { off(); stamp += 1; schedStamp += 1; } };
}

const prop = (label, value) => h('div', { class: 'field' }, h('span', {}, label), h('div', { class: 'agents-value' }, value));
