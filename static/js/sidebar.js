// The sidebar's width and whether it is shown: drag the edge (or ←/→ on it) to resize, double-click
// to reset; the button in its header, ⌘\ or the button in the top bar hides and shows it. Both are
// remembered (prefs.js); index.html applies them before first paint so the layout does not jump. On a phone it is a
// drawer instead (setDrawer).
// It has two modes, picked in its header (or ⌘⇧E): Project, the views built from the vault's structure, and
// Explorer, the vault's folders and files (explorer.js). Switching never navigates: the page stays where it is. The
// mode is each vault's own, Explorer until one is picked: it needs nothing of the structure, so a vault just added
// shows what its folder holds; index.html applies it before first paint too, from the vault the address names.
// (Docs is a view with its own tree, views/docs.js, reached from its link in Project.)
import { pref, setPref } from './prefs.js';
import { h, icon } from './ui.js';

const DEFAULT_W = 248;
const MIN_W = 180;
const MAX_W = 420;
const root = document.documentElement;
const clamp = (w) => Math.max(MIN_W, Math.min(MAX_W, Math.round(w)));

const setWidth = (w) => root.style.setProperty('--sidebar-w', `${clamp(w)}px`);
const width = () => document.getElementById('sidebar').getBoundingClientRect().width;
export const sidebarCollapsed = () => root.classList.contains('side-collapsed');

const MODES = [['project', 'project', 'Project', 'The views of the vault'], ['explorer', 'foldertree', 'Explorer', 'The vault\'s folders and files']];
export const sidebarMode = () => (root.classList.contains('side-mode-explorer') ? 'explorer' : 'project');
const modeListeners = [];
/** Calls `fn(mode)` whenever the sidebar switches mode. */
export const onSidebarMode = (fn) => modeListeners.push(fn);

function showMode(next) {
  root.classList.toggle('side-mode-explorer', next === 'explorer');
  renderModes();
  modeListeners.forEach((fn) => fn(next));
}

/** Shows the sidebar in `mode` ('project' | 'explorer'; the other one when left out), and remembers it for this vault. */
export function setSidebarMode(mode) {
  const next = mode || (sidebarMode() === 'explorer' ? 'project' : 'explorer');
  setPref('sidebar.mode', next);
  showMode(next);
}

/** Once the page knows its vault: the mode that vault was left in (Explorer when none), if it is not the one shown. */
export function syncSidebarMode() {
  const saved = pref('sidebar.mode') === 'project' ? 'project' : 'explorer';
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

export function initSidebar() {
  setWidth(pref('sidebar.w', DEFAULT_W));
  document.getElementById('side-collapse').addEventListener('click', () => toggleSidebar(true));
  document.getElementById('side-backdrop').addEventListener('click', () => setDrawer(false));
  addEventListener('hashchange', () => setDrawer(false)); // a link followed, a file opened: the page is what you wanted
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerOpen() && !e.defaultPrevented) { e.preventDefault(); setDrawer(false); }
  });
  narrow.addEventListener('change', () => setDrawer(false)); // wider again: the sidebar is back in its place
  syncButtons();
  renderModes();

  const grip = document.getElementById('side-resizer');
  const save = () => setPref('sidebar.w', clamp(width()));
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { grip.setPointerCapture(e.pointerId); } catch { /* the moves still arrive while the pointer stays on it */ }
    const startX = e.clientX;
    const startW = width();
    root.classList.add('side-resizing');
    const move = (ev) => setWidth(startW + ev.clientX - startX);
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      root.classList.remove('side-resizing');
      save();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('dblclick', () => { setWidth(DEFAULT_W); setPref('sidebar.w', null); });
  grip.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
    if (!step) return;
    e.preventDefault();
    setWidth(width() + step);
    save();
  });
}
