// The sidebar's Agents mode: the commands of the agent folders of Settings → Agents (server.py list_agents,
// tm/commands.py), as a tree — a section per folder (its public name; folded from its title), a folder per namespace
// (`dev/` holds /dev:start), the agents pinned above them all — drawn by treePane in its read-only shape (nothing is
// dragged or renamed: the files are the folders' own). An agent opens its page in the middle (#/runs/<folder>/<name>,
// views/runs.js), where it is run. Pinned and hidden agents, folded and open folders are this browser's (prefs.js): the
// folders are the same in every vault, so these are too. "+ Add folder" adds one to the list Settings edits.
import { api } from './api.js';
import { agentEntries, agentHref, agentKey, agentPath, agentPathOfHash, folderCounts, pinnedAgents, runMessage, toggled } from './agentsmodel.js';
import { trapFocus } from './create.js';
import { buildTree, findNode } from './filetree.js';
import { folderButton } from './folderpick.js';
import { pref, setPref } from './prefs.js';
import { onSidebarMode, sidebarMode } from './sidebar.js';
import { onChange, saveConfig, state, toast } from './state.js';
import { treePane } from './treepane.js';
import { dropdown, h, icon } from './ui.js';

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

const PINNED = '~pinned'; // the pinned section's id: never a folder's (those are 8 hex digits)
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

/** The pinned agents, as a folder of their own: their rows keep their own paths, so the one shown lights up in both. */
function pinnedNode() {
  const children = pinnedAgents(dirs, pref('agents.pinned', [])).map((a) => ({
    name: a.name, path: agentPath(a.dir, a.name), kind: 'file', agent: { ...a, pinned: true }, search: `/${a.name} ${a.description || ''}`,
  }));
  return children.length ? { name: '', path: '', kind: 'dir', children } : null;
}

function sections(t) {
  if (!dirs?.length) return [{ id: 'none', path: '', head: emptyHead(), node: null }];
  const pins = pinnedNode();
  const fold = folded();
  return [
    ...(pins ? [{ id: PINNED, path: '', head: head({ id: PINNED, name: 'Pinned', exists: true, pinned: true }, pins.children.length), node: fold.has(PINNED) ? null : pins }] : []),
    ...dirs.map((d) => ({ id: d.id, path: d.id, head: head(d, folderCounts(d, hidden()).shown), node: fold.has(d.id) ? null : findNode(t, d.id) })),
  ];
}

/** A section's head: its title folds it (the folder's path in its tooltip), its count, and ⋯ for the folder. */
function head(d, count) {
  const isFolded = folded().has(d.id);
  const gone = !d.exists;
  return h('div', { class: `docs-head agents-head ${gone ? 'dim' : ''}`, 'data-agents': d.id },
    h('button', { class: 'docs-title', 'aria-expanded': String(!isFolded), title: d.pinned ? 'The agents you pinned' : gone ? `${d.path}\nThis folder is not there any more` : d.path,
      onclick: () => { setPref('agents.folded', toggled(pref('agents.folded', []), d.id)); rebuild(); } },
    icon(isFolded ? 'right' : 'down', 12), d.pinned ? icon('pin', 12) : null, h('span', {}, d.name),
    h('span', { class: 'agents-count' }, gone ? 'not found' : String(count))),
    d.pinned ? null : h('button', { class: 'btn icon docs-add', title: `${d.name}: actions`, 'aria-label': `Actions on ${d.name}`, 'aria-haspopup': 'menu',
      onclick: (e) => folderMenu(e.currentTarget, d) }, icon('more', 14)));
}

/** No folder yet: what the section is for, and the way to add the first one. */
function emptyHead() {
  return h('div', { class: 'agents-empty' },
    h('p', { class: 'muted small' }, 'No agent folders yet. Add a folder whose .claude/commands holds your agents: each command is one.'),
    h('button', { class: 'btn secondary agents-add', type: 'button', onclick: () => addFolderDialog() }, icon('plus', 14), 'Add folder'));
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
  const isPinned = (pref('agents.pinned', []) || []).includes(key);
  return [
    { label: 'Open', icon: 'play', onSelect: () => { location.hash = agentHref(a.dir, a.name); } },
    { label: isPinned ? 'Unpin' : 'Pin to the top', icon: 'pin', onSelect: () => { setPref('agents.pinned', toggled(pref('agents.pinned', []), key)); rebuild(); } },
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
  },
  menu: agentMenu,
  bar: [
    h('button', { class: 'btn icon', title: 'Add an agent folder', 'aria-label': 'Add an agent folder', onclick: () => addFolderDialog() }, icon('plus', 15)),
    h('button', { class: 'btn icon', title: 'Re-read the agents of every folder', 'aria-label': 'Re-read the agents', onclick: () => { sig = ''; loadAgents(); } }, icon('reset', 15)),
  ],
});

/** "+ Add folder": a folder's absolute path and the name the sidebar shows for it, added to Settings → Agents. */
export function addFolderDialog() {
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal');
  const opener = document.activeElement;
  const close = () => {
    backdrop.hidden = true; modal.className = ''; modal.replaceChildren();
    if (opener && document.contains(opener)) opener.focus();
  };
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
      close();
      sig = '';
      await loadAgents();
      toast(`${name.value.trim() || p.split('/').pop()} added`);
    } catch { add.disabled = false; /* toasted by the state: "not a directory: …" */ }
  } },
  h('div', { class: 'fields prop-rows' },
    h('label', { class: 'field' }, h('span', {}, 'Folder'),
      h('span', { class: 'folder-field' }, path, folderButton(path, { prompt: 'Choose a folder whose .claude/commands holds agents' }))),
    h('label', { class: 'field' }, h('span', {}, 'Name'), name)),
  h('p', { class: 'muted small' }, state.config.can_pick_folder ? 'Its absolute path, typed or chosen. Every command in its ' : 'Its absolute path. Every command in its ', h('code', {}, '.claude/commands'), ' (a link there is followed) is an agent you can run from here, in that folder.'),
  h('div', { class: 'agents-add-actions' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), add));
  modal.className = 'agents-modal';
  modal.setAttribute('aria-label', 'Add an agent folder');
  modal.replaceChildren(h('div', { class: 'modal-head' }, h('h2', {}, icon('zap', 18), 'Add an agent folder'),
    h('button', { class: 'btn icon', title: 'Close (Esc)', onclick: close }, icon('x', 16))), form);
  backdrop.hidden = false;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  modal.onkeydown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') trapFocus(modal, e);
  };
  path.focus();
}

export function initAgents() {
  const listed = () => sidebarMode() === 'agents';
  onSidebarMode((mode) => { if (mode === 'agents') loadAgents().then(() => pane.reveal(agentPathOfHash(location.hash))); });
  // A save in Settings (a folder added, renamed or removed) reloads the page's state: the list follows.
  onChange(() => { if (listed() || dirs) loadAgents(); });
  window.addEventListener('hashchange', () => { if (listed() && tree) pane.reveal(agentPathOfHash(location.hash)); });
  if (listed()) loadAgents().then(() => pane.reveal(agentPathOfHash(location.hash)));
}
