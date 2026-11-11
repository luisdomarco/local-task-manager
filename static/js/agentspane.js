// The sidebar's Agents mode: the commands of the agent folders of Settings → Agents (server.py list_agents,
// tm/commands.py), as a tree — a section per folder (its public name; folded from its title), a folder per namespace
// (`dev/` holds /dev:start), under Favourites (the agents starred, as the Projects mode's) — drawn by treePane in its read-only shape (nothing is
// dragged or renamed: the files are the folders' own). An agent opens its page in the middle (#/runs/<folder>/<name>,
// views/runs.js), where it is run. Favourite and hidden agents, folded and open folders are this browser's (prefs.js): the
// folders are the same in every vault, so these are too. "+ Add folder" adds one to the list Settings edits.
import { activity, initActivity, onActivity } from './agentactivity.js';
import { api } from './api.js';
import { agentEntries, agentHref, agentKey, agentPath, agentPathOfHash, folderCounts, pinnedAgents, runMessage, toggled } from './agentsmodel.js';
import { buildTree, findNode } from './filetree.js';
import { folderButton } from './folderpick.js';
import { pref, setPref } from './prefs.js';
import { onSidebarMode, sidebarMode } from './sidebar.js';
import { onChange, saveConfig, state, toast } from './state.js';
import { agentMarks, inboxCount, RUN_STATUSES } from './runmodel.js';
import { treePane } from './treepane.js';
import { countOf, dropdown, foldHead, formActions, h, icon, openDialog, propRow } from './ui.js';

let dirs = null;      // the latest list: [{ id, name, path, exists, commands }]
let tree = null;      // buildTree of it
let sig = '';
let loading = null;
const listeners = new Set();

/** The agent folders as the latest load left them (views/runs.js reads its agent from them), or null before one. */
export const agentDirs = () => dirs;
/** Calls `fn()` after each load that changed the list. → a function that stops it. */
export function onAgents(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const FAVS = '~pinned'; // the Favourites section's id: never a folder's (those are 8 hex digits)
const FAV_KEY = 'agents.pinned'; // its pref keeps the name it had when they were "pinned"
/** Whether an agent is a favourite; a star toggles it (the sidebar's ⋯, its page's head). */
export const isFavourite = (dir, name) => (pref(FAV_KEY, []) || []).includes(agentKey(dir, name));
export function toggleFavourite(dir, name) {
  setPref(FAV_KEY, toggled(pref(FAV_KEY, []), agentKey(dir, name)));
  rebuild();
}
const hidden = () => new Set(pref('agents.hidden', []));
const folded = () => new Set(pref('agents.folded', []));
const showingHidden = () => new Set(pref('agents.showHidden', []));
const box = () => document.getElementById('side-agents');
const agentOf = (node) => node?.agent || null;

/** Fetches the list again; draws the tree when it changed. */
export function loadAgents() {
  if (loading) return loading;
  loading = api.agents().then((res) => {
    const next = JSON.stringify(res.dirs);
    if (next === sig) return;
    sig = next;
    dirs = res.dirs;
    rebuild();
    listeners.forEach((fn) => fn());
  }).catch((e) => {
    box()?.replaceChildren(h('p', { class: 'muted small side-explorer-msg' }, `Cannot list the agents: ${e.message}`));
  }).finally(() => { loading = null; });
  return loading;
}

/** The tree again from the list (a pin, a hide or a fold changes what it holds), then drawn. */
function rebuild() {
  const off = hidden();
  const shown = showingHidden();
  tree = buildTree((dirs || []).flatMap((d) => agentEntries([d], { hidden: off, showHidden: shown.has(d.id) })));
  pane.render();
}

/** The favourite agents, as a folder of their own: their rows keep their own paths, so the one shown lights up in both. */
function favsNode() {
  const children = pinnedAgents(dirs, pref(FAV_KEY, [])).map((a) => ({
    name: a.name, path: agentPath(a.dir, a.name), kind: 'file', agent: { ...a, pinned: true }, search: `/${a.name} ${a.description || ''}`,
  }));
  return children.length ? { name: '', path: '', kind: 'dir', children } : null;
}

function sections(t) {
  if (!dirs?.length) return [{ id: '~inbox', path: '', head: inboxRow(), node: null }]; // no folder yet: + on top adds one
  const favs = favsNode();
  const fold = folded();
  marks = agentMarks(activity()?.runs);
  return [
    { id: '~inbox', path: '', head: inboxRow(), node: null },
    ...(favs ? [{ id: FAVS, path: '', head: favsHead(), node: favs }] : []), // none: no section
    ...dirs.map((d) => ({ id: d.id, path: d.id, head: head(d, folderCounts(d, hidden()).shown), node: fold.has(d.id) ? null : findNode(t, d.id) })),
  ];
}

/** A section's head: its title folds it (the folder's path in its tooltip), its count, and ⋯ for the folder. */
function head(d, count) {
  const isFolded = folded().has(d.id);
  const gone = !d.exists;
  return h('div', { class: `docs-head agents-head ${gone ? 'dim' : ''}`, 'data-agents': d.id },
    foldHead({ open: !isFolded, small: true, class: 'docs-title', tip: gone ? `${d.path}\nThis folder is not there any more` : d.path,
      title: [h('span', { class: 'fold-title' }, d.name), countOf(gone ? 'not found' : count, { plain: true, cls: 'agents-count' })],
      onToggle: () => { setPref('agents.folded', toggled(pref('agents.folded', []), d.id)); rebuild(); } }),
    h('button', { class: 'btn icon docs-add', title: `${d.name}: actions`, 'aria-label': `Actions on ${d.name}`, 'aria-haspopup': 'menu',
      onclick: (e) => folderMenu(e.currentTarget, d) }, icon('more', 14)));
}

/** Favourites' title, as the Projects mode's section (index.html #side-favs): it never folds, and shows only once an
 *  agent is starred. */
const favsHead = () => h('div', { class: 'agents-favs' }, h('div', { class: 'side-title' }, 'Favourites'));

let marks = {}; // agentKey → 'needs_you' | 'working' | 'unread' (runmodel.js agentMarks), as the tree was last drawn
const MARK_TIP = { needs_you: 'A run waits for you', working: 'Running', unread: 'A run ended: not seen yet' };

/** Home, Inbox and Routines, above the folders (views/agentshome.js #/runs, views/runs.js #/runs/inbox): the Inbox with how many
 *  runs wait for you or ended unread, and a dot while one runs. */
function inboxRow() {
  const counts = activity()?.counts || {};
  const n = inboxCount(counts);
  const at = location.hash.split('?')[0];
  const link = (href, ico, name, lit, title, ...after) => h('a', { class: `agents-inbox${lit ? ' active' : ''}`, href, 'aria-current': lit ? 'page' : null, title },
    icon(ico, 15), h('span', { class: 'agents-inbox-name' }, name), ...after);
  return h('div', { class: 'agents-nav' },
    link('#/runs', 'home', 'Home', at === '#/runs', 'Start an agent, and what runs, waits and ended'),
    link('#/runs/inbox', 'inbox', 'Inbox', at === '#/runs/inbox',
      n ? `${counts.needs_you || 0} waiting for you · ${counts.unread || 0} ended, not seen yet` : 'Every run of your agents',
      counts.running ? h('span', { class: 'td-dot tone-accent', title: `${counts.running} running`, 'aria-label': `${counts.running} running` }) : null,
      n ? h('span', { class: `agents-inbox-count${counts.needs_you ? ' warn' : ''}` }, String(n)) : null),
    link('#/runs/routines', 'clock', 'Routines', at === '#/runs/routines', 'Everything scheduled, of every agent'));
}

function folderMenu(anchor, d) {
  const { hidden: off } = folderCounts(d, hidden());
  const showing = showingHidden().has(d.id);
  dropdown(anchor, [
    { label: 'Show in Finder', icon: 'external', onSelect: () => api.agentReveal(d.id).catch((e) => toast(e.message, true)) },
    off ? { label: showing ? 'Leave out the hidden ones' : `Show hidden (${off})`, icon: 'eye', onSelect: () => {
      setPref('agents.showHidden', toggled(pref('agents.showHidden', []), d.id));
      rebuild();
    } } : null,
    { label: 'Re-read its agents', icon: 'reset', onSelect: () => { sig = ''; loadAgents(); } },
    '-',
    { label: 'Rename or remove… (Settings)', icon: 'settings', onSelect: () => { location.hash = '#/settings/agents'; } },
  ].filter(Boolean), { width: 230 });
}

function agentMenu(node) {
  const a = agentOf(node);
  if (!a) return [];
  const key = agentKey(a.dir, a.name);
  const fav = isFavourite(a.dir, a.name);
  return [
    { label: 'Open', icon: 'play', onSelect: () => { location.hash = agentHref(a.dir, a.name); } },
    { label: fav ? 'Remove from Favourites' : 'Add to Favourites', icon: 'star', onSelect: () => toggleFavourite(a.dir, a.name) },
    { label: a.hidden ? 'Show it again' : 'Hide', icon: 'eye', onSelect: () => {
      setPref('agents.hidden', toggled(pref('agents.hidden', []), key));
      rebuild();
      if (!a.hidden) toast(`/${a.name} hidden: “Show hidden” in its folder’s menu brings it back`);
    } },
    '-',
    { label: `Open in ${state.config.editor_app || 'Cursor'}`, icon: 'code', onSelect: () => api.agentOpenFile(a.dir, a.name).catch((e) => toast(e.message, true)) },
    { label: 'Copy command', icon: 'copy', onSelect: () => navigator.clipboard.writeText(runMessage(a.name)).then(() => toast(`/${a.name} copied`), () => toast('Could not copy', true)) },
  ];
}

const pane = treePane({
  box, tree: () => tree, openKey: 'agents.open', label: 'Agents', readonly: true, placeholder: 'Filter agents…',
  empty: 'This folder has no agents in .claude/commands.',
  href: (path) => { const a = agentOf(findNode(tree, path)); return a ? agentHref(a.dir, a.name) : null; },
  current: () => agentPathOfHash(location.hash),
  sections,
  nameOf: (node) => (node.agent ? `/${node.agent.name}` : node.name),
  iconOf: () => icon('slash', 15),
  tipOf: (node) => {
    const a = node.agent;
    if (!a) return node.name;
    return [`/${a.name}${a.argument_hint ? ` ${a.argument_hint}` : ''}`, a.description].filter(Boolean).join('\n');
  },
  decorate: (node, row) => {
    if (node.agent?.hidden) row.classList.add('is-hidden'); // a namespace has no href (above): it only folds
    const mark = node.agent && marks[agentKey(node.agent.dir, node.agent.name)];
    if (mark) {
      const tone = mark === 'unread' ? 'success' : RUN_STATUSES[mark].tone;
      row.querySelector('.tree-more')?.before(h('span', { class: `td-dot agents-mark tone-${tone}${mark === 'unread' ? ' unread' : ''}`,
        title: MARK_TIP[mark], 'aria-label': MARK_TIP[mark] }));
    }
  },
  menu: agentMenu,
  bar: [
    h('button', { class: 'btn icon', title: 'Add an agent folder', 'aria-label': 'Add an agent folder', onclick: () => addFolderDialog() }, icon('plus', 15)),
    h('button', { class: 'btn icon', title: 'Re-read the agents of every folder', 'aria-label': 'Re-read the agents', onclick: () => { sig = ''; loadAgents(); } }, icon('reset', 15)),
  ],
});

/** "+ Add folder": a folder's absolute path and the name the sidebar shows for it, added to Settings → Agents. */
export function addFolderDialog() {
  let close = () => {};
  const path = h('input', { class: 'input', placeholder: '/absolute/path/to/a/repository', 'aria-label': 'Folder', spellcheck: 'false', autocomplete: 'off' });
  const name = h('input', { class: 'input', placeholder: 'Its name in the sidebar (optional)', 'aria-label': 'Name' });
  const add = h('button', { class: 'btn primary', type: 'submit' }, icon('plus', 14), 'Add folder');
  const form = h('form', { class: 'agents-add-form', onsubmit: async (e) => {
    e.preventDefault();
    const p = path.value.trim().replace(/\/+$/, '');
    if (!p) { path.focus(); return; }
    const list = state.config.agent_dirs || [];
    if (list.includes(p)) { toast('That folder is already in the list', true); return; }
    add.disabled = true;
    try {
      const names = { ...(state.config.agent_dir_names || {}) };
      if (name.value.trim()) names[p] = name.value.trim();
      await saveConfig({ agent_dirs: [...list, p], agent_dir_names: names });
      close(true);
      sig = '';
      await loadAgents();
      toast(`${name.value.trim() || p.split('/').pop()} added`);
    } catch { add.disabled = false; /* toasted by the state: "not a directory: …" */ }
  } },
  h('div', { class: 'fields prop-rows' },
    propRow('Folder', h('span', { class: 'folder-field' }, path, folderButton(path, { prompt: 'Choose a folder whose .claude/commands holds agents' }))),
    propRow('Name', name)),
  h('p', { class: 'muted small' }, state.config.can_pick_folder ? 'Its absolute path, typed or chosen. Every command in its ' : 'Its absolute path. Every command in its ', h('code', {}, '.claude/commands'), ' (a link there is followed) is an agent you can run from here, in that folder.'),
  formActions({ onCancel: () => close(), actions: add }));
  ({ close } = openDialog({ title: 'Add an agent folder', ico: 'zap', cls: 'agents-modal', body: form, focus: path }));
}

export function initAgents() {
  const listed = () => sidebarMode() === 'agents';
  onSidebarMode((mode) => { if (mode === 'agents') loadAgents().then(() => pane.reveal(agentPathOfHash(location.hash))); });
  // A save in Settings (a folder added, renamed or removed) reloads the page's state: the list follows.
  onChange(() => { if (listed() || dirs) loadAgents(); });
  window.addEventListener('hashchange', () => { if (listed() && tree) { pane.render(); pane.reveal(agentPathOfHash(location.hash)); } });
  if (listed()) loadAgents().then(() => pane.reveal(agentPathOfHash(location.hash)));
  // The Inbox's count and each agent's mark follow the runs.
  onActivity(() => { if (tree) pane.render(); });
  initActivity();
}
