// The Agents section's middle (its sidebar is agentspane.js). #/runs: every agent folder and its agents, in rows.
// #/runs/<folder id>/<name>: one agent — its head (its name as typed in Claude Code, its folder and file, what it does,
// Run) and two tabs: Run (its arguments, the mode, model and effort it starts with, and the exact message it sends)
// and Definition (its frontmatter as properties, and its prompt). Running it starts a chat in the dock (term.js), in
// the agent's own folder so Claude loads that folder's commands; the arguments go as text after the command. Open in ▾
// starts it in Terminal, Claude Desktop, Cursor or Antigravity instead. On the right, as on an item's page, its Runs:
// every run of it on this computer (tm/agentruns.py), each resumed in the dock or opened elsewhere.
import { agentDirs, onAgents, loadAgents, addFolderDialog } from '../agentspane.js';
import { agentHref, agentKey, parseRunsParam, runMessage, runMeta, RUN_MODES } from '../agentsmodel.js';
import { api } from '../api.js';
import { CLAUDE_EFFORTS, TARGET_ICON, claudeModelOptions, claudeTargets, openInMenu, resumeClaude } from '../claude.js';
import { DETAIL_PAGE, paged } from '../datatable.js';
import { agoLabel } from '../dates.js';
import { sideFold } from '../itemform.js';
import { pref, setPref } from '../prefs.js';
import { agentRun, state, toast } from '../state.js';
import { setPageTitle } from '../tabtitle.js';
import { dropdown, emptyState, h, icon, pageHead, renderMarkdown, secondaryButton, select, tabPanels } from '../ui.js';

const TAB = 'agents.tab';
const SIDE_KEY = 'tm.agentsSidePanel'; // its Runs panel folded or not: one choice for every agent
const LAST = 'agents.last'; // { "<folder> <name>": { args, mode, model, effort } }: what each agent last ran with

const lastOf = (key) => (pref(LAST, {}) || {})[key] || {};
function remember(key, values) {
  const all = { ...(pref(LAST, {}) || {}) };
  all[key] = values;
  setPref(LAST, all);
}

export function mount(root, param) {
  const { dir, name } = parseRunsParam(param);
  let view = null;
  let live = true;
  const draw = () => {
    if (!live) return;
    const dirs = agentDirs();
    if (!dirs) { root.replaceChildren(emptyState('Reading the agent folders…')); return; }
    if (!name) { root.replaceChildren(...overview(dirs)); return; }
    const folder = dirs.find((d) => d.id === dir);
    const agent = folder?.commands.find((c) => c.name === name);
    if (!folder || !agent) {
      root.replaceChildren(pageHead({ title: `/${name || ''}` }),
        emptyState(folder ? `${folder.name} has no agent /${name} any more.` : 'That agent folder is not in Settings → Agents any more.'));
      return;
    }
    if (view?.sig === `${dir} ${name}`) { view.refresh(agent, folder); return; } // the list reloaded: keep what is being typed
    view?.stop();
    view = agentPage(folder, agent);
    root.replaceChildren(...view.nodes);
    setPageTitle(`/${name}`);
  };
  draw();
  loadAgents().then(draw);
  const stop = onAgents(draw);
  return { update() {}, unmount() { live = false; view?.stop(); view = null; stop(); } };
}

// ── #/runs: the folders and their agents ─────────────────────────────────────
function overview(dirs) {
  const total = dirs.reduce((n, d) => n + d.commands.length, 0);
  const add = secondaryButton('Add folder', { ico: 'plus', onclick: () => addFolderDialog() });
  if (!dirs.length) {
    return [pageHead({ title: 'Agents', action: add }),
      h('div', { class: 'agents-intro' },
        h('p', {}, 'Run your Claude Code agents from here instead of a terminal.'),
        h('p', { class: 'muted' }, 'Add a folder (a repository, a system…): every command in its ', h('code', {}, '.claude/commands'),
          ' is an agent. It runs in that folder, as a chat in the dock, where you answer its questions and permissions.'))];
  }
  return [
    pageHead({ title: 'Agents', count: h('span', { class: 'muted view-count' }, String(total)), action: add }),
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
function agentPage(folder, agent) {
  const key = agentKey(folder.id, agent.name);
  const last = lastOf(key);
  const choice = {
    mode: RUN_MODES.some(([m]) => m === last.mode) ? last.mode : 'default',
    model: last.model ?? (state.config.claude_model || ''),
    effort: last.effort ?? (state.config.claude_effort || ''),
  };
  const args = h('input', { type: 'text', class: 'agents-args', value: last.args || '', autocomplete: 'off', spellcheck: 'false',
    placeholder: agent.argument_hint || 'No arguments', 'aria-label': 'Arguments',
    oninput: () => paintMessage(),
    onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); run(); } } });
  const message = h('code', { class: 'agents-message' });
  const where = h('span', {});
  const runBtn = h('button', { class: 'btn primary agents-run', type: 'button', title: 'Run it as a chat in the dock (⌘↵)', onclick: () => run() },
    icon('play', 13), 'Run');
  const headRun = h('button', { class: 'btn primary', type: 'button', title: 'Run it with the choices of the Run tab (⌘↵)', onclick: () => run() },
    icon('play', 13), 'Run');
  const editor = state.config.editor_app || 'Cursor';
  const openFile = () => api.agentOpenFile(folder.id, agent.name).catch((e) => toast(e.message, true));
  // Open in ▾: the same run started elsewhere — Terminal, and Claude Desktop, Cursor, Antigravity when installed (the
  // Claude terminal's menu). Only Terminal: the plain button.
  const targets = claudeTargets();
  const openIn = h('button', { class: 'btn', type: 'button', 'aria-haspopup': targets.length > 1 ? 'menu' : null,
    title: 'Start it outside the app, with the choices of the Run tab',
    onclick: () => (targets.length > 1 ? openInMenu(openIn, targets, launchIn, null, 'auto') : launchIn(targets[0])) },
  icon('external', 14), targets.length > 1 ? 'Open in ▾' : `Open in ${targets[0].label}`);

  function paintMessage() {
    message.textContent = runMessage(agent.name, args.value);
    where.replaceChildren('in ', h('strong', { title: folder.path }, folder.name));
  }

  async function launchIn(t) {
    openIn.disabled = true;
    remember(key, { args: args.value.trim(), ...choice });
    try {
      const out = await api.agentLaunch(folder.id, agent.name, args.value, choice.mode, choice.model, choice.effort, t.key);
      toast(t.key === 'terminal' ? `${runMessage(agent.name, args.value)} opened in ${out.terminal}` : `Ready in ${out.target_label} — press Enter there`);
      if (out.recorded) runs.load();
    } catch (e) { toast(e.message, true); } finally { openIn.disabled = false; }
  }

  let running = false;
  async function run() {
    if (running) return;
    running = true;
    runBtn.disabled = headRun.disabled = true;
    remember(key, { args: args.value.trim(), ...choice });
    try {
      const out = await agentRun(folder.id, agent.name, args.value, choice.mode, choice.model, choice.effort);
      const { showChatHere } = await import('../term.js');
      showChatHere(out.chat);
      toast(`${runMessage(agent.name, args.value)} is running in the dock`);
      runs.load();
    } catch { /* toasted by the state */ } finally {
      running = false;
      runBtn.disabled = headRun.disabled = false;
    }
  }

  const field = (label, control, help = null) => h('div', { class: 'field' }, h('span', {}, label), h('div', { class: 'agents-control' }, control, help));
  const runTab = h('div', { class: 'agents-run-tab' },
    h('div', { class: 'fields prop-rows quiet agents-form' },
      field('Arguments', args, agent.argument_hint ? h('p', { class: 'muted small agents-help' }, 'Expects ', h('code', {}, agent.argument_hint)) : null),
      field('Mode', select(RUN_MODES, choice.mode, (v) => { choice.mode = v || 'default'; }, { 'aria-label': 'Mode' }),
        h('p', { class: 'muted small agents-help' }, 'What it may do without asking you. Questions and permissions show in the dock.')),
      field('Model', select(claudeModelOptions(choice.model), choice.model, (v) => { choice.model = v || ''; }, { 'aria-label': 'Model' })),
      field('Effort', select(CLAUDE_EFFORTS, choice.effort, (v) => { choice.effort = v || ''; }, { 'aria-label': 'Effort' })),
      field('Folder', h('span', { class: 'agents-folder', title: folder.path }, icon('folder', 14), h('span', {}, folder.name), h('span', { class: 'muted' }, folder.path)))),
    h('div', { class: 'agents-send' }, h('span', { class: 'muted small' }, 'Sends'), message, h('span', { class: 'muted small' }, where), h('span', { class: 'spacer' }), runBtn),
    agent.allowed_tools.length ? h('p', { class: 'muted small agents-allowed' }, icon('lock', 12),
      `Allowed without asking, by the command itself: ${agent.allowed_tools.length} tool${agent.allowed_tools.length === 1 ? '' : 's'} (Definition lists them).`) : null);

  const body = h('div', { class: 'md agents-prompt' });
  const defTab = h('div', { class: 'agents-def' });
  const fillDefinition = (a) => {
    defTab.replaceChildren(
      h('div', { class: 'fields prop-rows quiet agents-props' },
        prop('Description', a.description || h('span', { class: 'muted' }, 'Empty')),
        prop('Arguments', a.argument_hint ? h('code', {}, a.argument_hint) : h('span', { class: 'muted' }, 'None')),
        prop('Allowed tools', a.allowed_tools.length ? h('div', { class: 'agents-tools' }, a.allowed_tools.map((t) => h('span', { class: 'chip mono', title: t }, t)))
          : h('span', { class: 'muted' }, 'None: it asks for each one')),
        prop('Model', a.model || h('span', { class: 'muted' }, 'The one it is run with')),
        prop('Started by', a.disable_model_invocation ? 'You only' : 'You, or Claude when it fits'),
        prop('File', h('button', { class: 'link-btn mono small agents-file', type: 'button', title: `${folder.path}/${a.file}\nOpen in ${editor}`, onclick: openFile }, a.file))),
      h('h3', { class: 'agents-prompt-title' }, 'Prompt'), body);
    body.innerHTML = '<p class="muted">Reading…</p>';
    api.agentCommand(folder.id, a.name).then((r) => {
      body.innerHTML = r.command.body.trim() ? renderMarkdown(r.command.body) : '<p class="muted">Empty.</p>'; // sanitized by renderMarkdown (DOMPurify)
    }, (e) => { body.replaceChildren(h('p', { class: 'muted' }, e.message)); });
  };
  fillDefinition(agent);

  const desc = h('p', { class: 'agents-desc' });
  const paintHead = (a) => { desc.textContent = a.description || ''; desc.hidden = !a.description; };
  paintHead(agent);
  paintMessage();

  const head = h('header', { class: 'view-head agents-head-page' },
    h('div', { class: 'agents-title-row' },
      h('h1', { class: 'agents-title' }, `/${agent.name}`), h('span', { class: 'spacer' }), openIn, headRun),
    h('p', { class: 'muted small agents-where' }, icon('folder', 13), h('span', { title: folder.path }, folder.name), h('span', { 'aria-hidden': 'true' }, '·'),
      h('button', { class: 'link-btn mono agents-file', type: 'button', title: `Open ${agent.file} in ${editor}`, onclick: openFile }, agent.file)),
    desc);
  const tabs = tabPanels([
    { key: 'run', label: 'Run', content: runTab },
    { key: 'definition', label: 'Definition', content: defTab },
  ], pref(TAB, 'run'), (k) => setPref(TAB, k));

  const main = h('div', { class: 'page-main agents-page', onkeydown: (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); } } }, head, ...tabs);
  // On the right, as on an item's page (panel.js pageLayout): its runs, in a panel that folds away.
  const runs = runsPanel(folder, agent, (a) => { args.value = a; paintMessage(); args.focus(); });
  const columns = h('div', { class: 'page-body agents-body' });
  columns.append(main, h('aside', { class: 'page-side im-side tabbed agents-side' }, sideFold(columns, SIDE_KEY), ...runs.nodes));
  setTimeout(() => { if (pref(TAB, 'run') === 'run') args.focus(); });
  let current = agent;
  return {
    sig: `${folder.id} ${agent.name}`,
    nodes: [h('div', { class: 'page two-panel agents-two' }, columns)],
    stop: runs.stop,
    refresh(a, f) {
      if (JSON.stringify(a) === JSON.stringify(current)) return;
      current = a;
      folder = f;
      paintHead(a);
      fillDefinition(a);
    },
  };
}

// ── Its Runs: the side panel ─────────────────────────────────────────────────
const RUN_ICON = { here: 'zap', terminal: 'terminal' };
const when = (at) => String(at || '').replace('T', ' ');

/** The runs of one agent, newest first, as an item's AI tab lists its conversations (claude.js sessionList, on a card):
 *  each row is what it sent over where it ran, what with and when Claude Code last wrote it, a dot while it runs in the
 *  dock; on hover, its arrow (resume it in this app, or open it in Terminal, Claude Desktop, Cursor…) and its ⋯ (its
 *  arguments back into the Run tab, Copy the session id, Forget). `useArgs(args)` fills the Run tab. */
function runsPanel(folder, agent, useArgs) {
  const box = h('div', { class: 'agents-runs' });
  let list = null;      // the runs, once the server answers
  let updated = null;   // { session id → last written | null }
  let timer = null;
  const [bar, ...panels] = tabPanels([{ key: 'runs', label: 'Runs', content: box }], 'runs');
  const setCount = (n) => {
    const btn = bar.querySelector('[data-tab="runs"]');
    btn.querySelector('.tab-count')?.remove();
    if (n) btn.append(h('span', { class: 'tab-count' }, String(n)));
  };

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
    { label: r.args ? 'Use these arguments' : 'Run it again', icon: 'play', title: 'Into the Run tab, to run it again', onSelect: () => useArgs(r.args || '') },
    { label: 'Copy session id', icon: 'copy', onSelect: () => navigator.clipboard.writeText(r.id).then(() => toast('Session id copied'), () => toast('Could not copy', true)) },
    '-',
    { label: 'Forget this run', icon: 'trash', danger: true, title: 'The conversation itself stays in Claude Code', onSelect: async () => {
      try { await api.agentRunForget(r.id); load(); } catch (e) { toast(e.message, true); }
    } },
  ], { align: 'end' });

  const row = (r) => {
    const title = runMessage(agent.name, r.args);
    const unsaved = updated && !updated[r.id] && !r.live; // a run still starting has written nothing yet
    const last = updated ? (updated[r.id] ? agoLabel(updated[r.id]) : agoLabel(r.at)) : '…';
    const go = h('button', { class: 'btn icon', title: unsaved ? 'Nothing to resume: Claude Code never saved this conversation' : 'Open in…',
      'aria-label': `Open ${title}`, 'aria-haspopup': 'menu', onclick: () => openMenu(go, r, unsaved) }, icon('external', 14));
    const more = h('button', { class: 'btn icon', title: 'More actions', 'aria-label': `More actions for ${title}`, 'aria-haspopup': 'menu',
      onclick: () => moreMenu(more, r) }, icon('more', 14));
    return h('li', { class: `cs-item surface-card hover-host${r.live ? ' live' : ''}` },
      icon(RUN_ICON[r.target] || 'external', 14),
      h('div', { class: 'cs-item-text', title: [title, `Started ${when(r.at)} · Updated ${updated?.[r.id] ? when(updated[r.id]) : '—'}`, r.cwd, r.id].join('\n') },
        h('span', { class: 'cs-item-title mono' }, r.live ? h('span', { class: 'cs-live', title: 'Running in the dock', 'aria-label': 'Running in the dock' }) : null, title),
        h('span', { class: 'cs-item-meta muted' }, ...[...runMeta(r), last].filter(Boolean).flatMap((part, i) => [i ? ' · ' : null, h('span', { class: 'nowrap' }, part)]),
          unsaved ? h('span', { class: 'chip warn', title: 'Claude Code has no conversation saved for this run: it cannot be resumed' }, 'not saved') : null)),
      h('div', { class: 'cs-item-actions hover-reveal' }, go, more));
  };
  const render = () => {
    if (!list) { box.replaceChildren(h('p', { class: 'muted small cs-empty' }, 'Reading its runs…')); return; }
    setCount(list.length);
    if (!list.length) {
      box.replaceChildren(h('p', { class: 'muted small cs-empty' }, 'No runs yet — Run starts one in the dock, Open in ▾ in Terminal. Each one resumes from here.'));
      return;
    }
    const page = paged({ key: 'agents.runs', at: `agents.runs.${folder.id} ${agent.name}`, rows: list, size: DETAIL_PAGE * 2, onChange: render });
    box.replaceChildren(h('ul', { class: 'cs-list', 'aria-label': `Runs of /${agent.name}` }, page.rows.map(row)), ...(page.pager ? [page.pager] : []));
  };
  let stamp = 0;
  let drawn = ''; // what the rows show now: drawn again only when it changes (a row being hovered or its menu open stays)
  const paint = () => {
    const now = JSON.stringify([list, updated]);
    if (now !== drawn) { drawn = now; render(); }
  };
  async function load() {
    const mine = ++stamp;
    try {
      const r = await api.agentRuns(folder.id, agent.name);
      if (mine !== stamp) return;
      list = r.runs || [];
    } catch (e) { drawn = ''; box.replaceChildren(h('p', { class: 'muted small cs-empty' }, e.message)); return; }
    paint();
    // A run in the dock: looked at again until it ends, so its dot goes out by itself.
    clearTimeout(timer);
    if (list.some((x) => x.live)) timer = setTimeout(load, 5000);
    // When Claude Code last wrote each one (its transcript): unknown is left as the start, never taken as "not saved".
    api.claudeUpdated(list).then((u) => { if (mine === stamp) { updated = u.updated || {}; paint(); } }, () => {});
  }
  render();
  load();
  return { nodes: [bar, ...panels], load, stop: () => { clearTimeout(timer); stamp += 1; } };
}

const prop = (label, value) => h('div', { class: 'field' }, h('span', {}, label), h('div', { class: 'agents-value' }, value));
