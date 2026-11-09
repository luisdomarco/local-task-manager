// The sidebar's width and whether it is shown: drag the edge (or ←/→ on it) to resize, double-click
// to reset; the button in its header, ⌘\ or the button in the top bar hides and shows it. Both are
// remembered (prefs.js); index.html applies them before first paint so the layout does not jump. On a phone it is a
// drawer instead (setDrawer).
// It has three modes, picked in its foot (⌘⇧E goes round them): Project, the views built from the vault's structure,
// Explorer, the vault's folders and files (explorer.js), and Agents, the commands of the agent folders of Settings
// (agentspane.js), to run from the app. Switching never navigates: the page stays where it is. The
// mode is each vault's own, Explorer until one is picked: it needs nothing of the structure, so a vault just added
// shows what its folder holds; index.html applies it before first paint too, from the vault the address names.
// (Docs is a view with its own tree, views/docs.js, reached from its link in Project.)
import { pref, setPref } from './prefs.js';
import { cssWidth, wireResizer } from './resizer.js';
import { h, icon } from './ui.js';

const root = document.documentElement;
const width = cssWidth({ cssVar: '--sidebar-w', key: 'sidebar.w', def: 248, min: 180, max: 420,
  measure: () => document.getElementById('sidebar').getBoundingClientRect().width });
export const sidebarCollapsed = () => root.classList.contains('side-collapsed');

const MODES = [['project', 'project', 'Project', 'The views of the vault'], ['explorer', 'foldertree', 'Explorer', 'The vault\'s folders and files'],
  ['agents', 'zap', 'Agents', 'Run the Claude Code commands of your agent folders']];
const MODE_NAMES = MODES.map(([m]) => m);
export const sidebarMode = () => (root.classList.contains('side-mode-explorer') ? 'explorer'
  : root.classList.contains('side-mode-agents') ? 'agents' : 'project');
const modeListeners = [];
/** Calls `fn(mode)` whenever the sidebar switches mode. */
export const onSidebarMode = (fn) => modeListeners.push(fn);

function showMode(next) {
  root.classList.toggle('side-mode-explorer', next === 'explorer');
  root.classList.toggle('side-mode-agents', next === 'agents');
  renderModes();
  modeListeners.forEach((fn) => fn(next));
}

/** Shows the sidebar in `mode` ('project' | 'explorer' | 'agents'; the next one round when left out), and remembers it
 *  for this vault. */
export function setSidebarMode(mode) {
  const next = MODE_NAMES.includes(mode) ? mode : MODE_NAMES[(MODE_NAMES.indexOf(sidebarMode()) + 1) % MODE_NAMES.length];
  setPref('sidebar.mode', next);
  showMode(next);
}

/** Once the page knows its vault: the mode that vault was left in (Explorer when none), if it is not the one shown. */
export function syncSidebarMode() {
  const saved = ['project', 'agents'].includes(pref('sidebar.mode')) ? pref('sidebar.mode') : 'explorer';
  if (saved !== sidebarMode()) showMode(saved);
}

function renderModes() {
  const box = document.getElementById('side-mode');
  const mode = sidebarMode();
  box.replaceChildren(...MODES.map(([m, ico, label, hint]) => h('button', {
    class: `btn icon ${mode === m ? 'active' : ''}`, title: `${label} — ${hint} (⌘⇧E)`, 'aria-label': label, 'aria-pressed': String(mode === m),
    onclick: () => { if (sidebarMode() !== m) setSidebarMode(m); },
  }, icon(ico, 14))));
}

// A phone (CSS: max-width 760px): the sidebar is a drawer over the page, opened from ☰ and closed by its backdrop, Esc,
// ⌘\ or going anywhere. Never remembered: it starts closed. A tablet (760–1000px) starts with the sidebar hidden until
// it is shown once (index.html); from then on, `sidebar.collapsed` as on a desktop.
const narrow = matchMedia('(max-width: 760px)');
export const drawerOpen = () => root.classList.contains('side-drawer-open');

function setDrawer(open) {
  if (open === drawerOpen()) return;
  root.classList.toggle('side-drawer-open', open);
  document.getElementById('main')?.toggleAttribute('inert', open);
  document.getElementById('side-expand')?.setAttribute('aria-expanded', String(open));
  if (open) document.querySelector('#sidebar a:not([hidden]), #sidebar button')?.focus({ preventScroll: true });
  else if (document.getElementById('sidebar').contains(document.activeElement)) document.getElementById('side-expand')?.focus();
}

/** Hides or shows the sidebar (`force` picks one), and remembers it. On a phone, opens or closes the drawer instead. */
export function toggleSidebar(force) {
  if (narrow.matches) {
    setDrawer(force === undefined ? !drawerOpen() : !force);
    return;
  }
  const collapsed = root.classList.toggle('side-collapsed', force);
  setPref('sidebar.collapsed', collapsed); // false too: a tablet then keeps it shown (index.html)
  syncButtons();
}

function syncButtons() {
  const btn = document.getElementById('side-collapse');
  if (btn && !btn.firstChild) btn.append(icon('sidebar', 15));
}

// The nav's folding groups (index.html: Plan, Items, More), open or folded as last left; More starts folded.
const GROUPS_OPEN = { plan: true, items: true, more: false };
function initGroups() {
  const open = { ...GROUPS_OPEN, ...pref('side.groups', {}) };
  for (const d of document.querySelectorAll('#sidebar details.side-group')) {
    d.open = !!open[d.dataset.group];
    d.addEventListener('toggle', () => {
      if (d.dataset.revealed) { delete d.dataset.revealed; return; } // opened to show the current view: not a choice to remember
      setPref('side.groups', { ...pref('side.groups', {}), [d.dataset.group]: d.open });
    });
  }
}
/** Opens the folded group that holds the current view's link, so the page always has its link in sight. */
export function revealActiveLink() {
  const d = document.querySelector('#sidebar details.side-group:not([open]) a.active')?.closest('details');
  if (d) { d.dataset.revealed = '1'; d.open = true; }
}

export function initSidebar() {
  width.apply();
  initGroups();
  document.getElementById('side-collapse').addEventListener('click', () => toggleSidebar(true));
  document.getElementById('side-backdrop').addEventListener('click', () => setDrawer(false));
  addEventListener('hashchange', () => setDrawer(false)); // a link followed, a file opened: the page is what you wanted
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerOpen() && !e.defaultPrevented) { e.preventDefault(); setDrawer(false); }
  });
  narrow.addEventListener('change', () => setDrawer(false)); // wider again: the sidebar is back in its place
  syncButtons();
  renderModes();

  wireResizer(document.getElementById('side-resizer'), { ...width, cls: 'side-resizing' });
}
