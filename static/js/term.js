// The dock: Claude's terminals inside the app. A panel across the bottom of the main column, one tab per
// terminal, each an xterm.js screen attached to a pty the server runs (`claude` on an item, on a bare prompt,
// or resumed). Output arrives on a Server-Sent Events stream, keystrokes go back with POSTs. Closing a tab ends
// the process; the conversation itself stays in Claude Code and can be resumed again. xterm.js and its fit
// addon are vendored under static/vendor/xterm/ and loaded the first time a terminal opens.
import { api } from './api.js';
import { pref, setPref } from './prefs.js';
import { claudeTermOpen, state, toast } from './state.js';
import { h, icon } from './ui.js';

const VENDOR = 'vendor/xterm';
const tabs = new Map(); // id → { id, label, term, fit, pane, button, source, alive, writes }
let active = null;
let dock = null;
let libs = null;

const script = (src) => new Promise((resolve, reject) => {
  const el = document.createElement('script');
  el.src = src;
  el.onload = resolve;
  el.onerror = () => reject(new Error(`could not load ${src}`));
  document.head.append(el);
});

/** xterm.js and the fit addon, once. They are UMD builds: `Terminal` and `FitAddon` land on window. */
async function loadLibs() {
  if (libs) return libs;
  libs = (async () => {
    if (!document.querySelector(`link[href="${VENDOR}/xterm.css"]`)) {
      const link = document.createElement('link'); // not h(): its href filter only lets absolute http(s) links through
      link.rel = 'stylesheet';
      link.href = `${VENDOR}/xterm.css`;
      document.head.append(link);
    }
    await script(`${VENDOR}/xterm.js`);
    await script(`${VENDOR}/addon-fit.js`);
    return { Terminal: window.Terminal, FitAddon: window.FitAddon.FitAddon };
  })();
  libs.catch(() => { libs = null; });
  return libs;
}

// The dock's own tokens, not the page's (app.css #termdock): it takes Claude Code's theme (the server reads it,
// config.claude_theme), because Claude draws its screen for that theme whatever the app's light or dark is.
const css = (name) => getComputedStyle(document.getElementById('termdock') || document.documentElement).getPropertyValue(name).trim();
const theme = () => ({
  background: css('--background'), foreground: css('--foreground'), cursor: css('--foreground'),
  selectionBackground: css('--accent'), selectionForeground: css('--foreground'),
});
const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// ── the dock itself ─────────────────────────────────────────────────────────
function ensureDock() {
  if (dock) return dock;
  const tabsEl = h('div', { class: 'td-tabs', role: 'tablist' });
  const body = h('div', { class: 'td-body' });
  const collapse = h('button', { class: 'btn icon', title: 'Collapse', onclick: () => {
    const folded = dock.classList.toggle('collapsed');
    collapse.title = folded ? 'Expand' : 'Collapse';
    collapse.replaceChildren(icon(folded ? 'up' : 'down', 16));
    document.body.classList.toggle('term-collapsed', folded);
    place();
    if (!folded) fitActive();
  } }, icon('down', 16));
  const grip = h('div', { class: 'td-grip', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Resize the terminal', tabindex: '0',
    title: 'Drag to resize · double-click to fill up to the top bar' });
  const max = h('button', { class: 'btn icon td-max', title: 'Fill up to the top bar', onclick: () => toggleMax() }, icon('maximize', 15));
  dock = h('aside', { id: 'termdock', 'aria-label': 'Claude terminals', hidden: true }, grip,
    h('div', { class: 'td-head' }, h('span', { class: 'td-title' }, icon('terminal', 14)), tabsEl, h('span', { class: 'spacer' }),
      max, collapse,
      h('button', { class: 'btn icon', title: 'Close every terminal', onclick: () => [...tabs.keys()].forEach(closeTab) }, icon('x', 16))),
    body);
  // The app's shortcuts (q, /, g…) and its Escape must not fire while typing into a terminal.
  dock.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dock);
  wireGrip(grip);
  new ResizeObserver(() => fitActive()).observe(body);
  addEventListener('resize', () => { if (!dock.hidden) setHeight(dock.getBoundingClientRect().height, false); });
  // Follow the item card: opened, closed or minimized (its backdrop's `hidden`), resized, or scrolled.
  const backdrop = document.getElementById('item-backdrop');
  if (backdrop) {
    new MutationObserver(rehome).observe(backdrop, { attributes: true, attributeFilter: ['hidden'] });
    backdrop.addEventListener('scroll', place, { passive: true });
  }
  if (itemModal()) new ResizeObserver(() => place()).observe(itemModal());
  return dock;
}
const tabsEl = () => dock.querySelector('.td-tabs');
const bodyEl = () => dock.querySelector('.td-body');

/** Light or dark as Claude Code is set up; a theme changed since (/theme) is picked up on the next reload. */
function paintTheme() {
  const light = state.config?.claude_theme === 'light';
  if (dock.classList.contains('td-light') === light && dock.dataset.painted) return;
  dock.classList.toggle('td-light', light);
  dock.dataset.painted = '1';
  for (const t of tabs.values()) t.term.options.theme = theme();
}

// ── where it sits: across the bottom of the page, or, while an item's card is open, inside the card ──
// The same dock and tabs either way: only its box moves. In the card it takes the card's width and bottom,
// the card makes room above it, and it never covers the card's header (as on the page it never covers the top bar).
const itemModal = () => document.getElementById('item-modal');
const inModal = () => document.getElementById('item-backdrop')?.hidden === false;
const heightKey = () => (inModal() ? 'dock.hModal' : 'dock.h');

function place() {
  if (!dock) return;
  const modal = itemModal();
  const anchored = !dock.hidden && inModal() && modal;
  dock.classList.toggle('in-modal', Boolean(anchored));
  modal?.classList.toggle('with-dock', Boolean(anchored));
  if (!anchored) {
    dock.style.left = dock.style.width = dock.style.bottom = '';
    if (modal) modal.style.paddingBottom = '';
    return;
  }
  const r = modal.getBoundingClientRect();
  dock.style.left = `${r.left}px`;
  dock.style.width = `${r.width}px`;
  dock.style.bottom = `${Math.max(0, innerHeight - r.bottom)}px`;
  modal.style.paddingBottom = `${dock.getBoundingClientRect().height}px`; // the card's columns end where the dock starts
}

/** The card opened, closed or was minimized: the dock moves there and takes the height it had in that place. */
function rehome() {
  if (!dock || dock.hidden) { place(); return; }
  setHeight(pref(heightKey(), defaultH()), false);
}

// ── height: drag the top edge (or ↑/↓ on it); double-click or the button fills up to the top bar (the card's header) ──
const MIN_H = 180;
const maxHeight = () => {
  if (inModal() && itemModal()) {
    const head = itemModal().querySelector('.im-head');
    const r = itemModal().getBoundingClientRect();
    return Math.max(MIN_H, r.bottom - (head ? head.getBoundingClientRect().bottom : r.top));
  }
  const bar = document.getElementById('pinbar');
  return Math.max(MIN_H, innerHeight - (bar ? bar.getBoundingClientRect().bottom : 0));
};
const clampH = (px) => Math.round(Math.max(MIN_H, Math.min(maxHeight(), px)));
const defaultH = () => Math.round(innerHeight * 0.42);
function setHeight(px, save = true) {
  if (inModal()) itemModal()?.classList.add('with-dock'); // the card at its full height first: that is the room there is
  const hgt = clampH(px);
  document.documentElement.style.setProperty('--dock-h', `${hgt}px`);
  if (save) setPref(heightKey(), hgt);
  place();
  const max = dock?.querySelector('.td-max');
  if (max) {
    const full = hgt >= maxHeight() - 1;
    max.replaceChildren(icon(full ? 'restore' : 'maximize', 15)); // not the chevrons: those are collapse / expand
    max.title = full ? 'Back to the size it had' : 'Fill up to the top bar';
  }
}
let beforeMax = null;
function toggleMax() {
  const now = dock.getBoundingClientRect().height;
  if (now >= maxHeight() - 1) setHeight(beforeMax || defaultH());
  else { beforeMax = now; setHeight(maxHeight()); }
}
function wireGrip(grip) {
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { grip.setPointerCapture(e.pointerId); } catch { /* the moves still arrive while the pointer stays on it */ }
    const startY = e.clientY;
    const startH = dock.getBoundingClientRect().height;
    document.documentElement.classList.add('dock-resizing');
    const move = (ev) => setHeight(startH + startY - ev.clientY, false);
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      document.documentElement.classList.remove('dock-resizing');
      setHeight(dock.getBoundingClientRect().height);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('dblclick', toggleMax);
  grip.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowUp' ? 40 : e.key === 'ArrowDown' ? -40 : 0;
    if (!step) return;
    e.preventDefault();
    setHeight(dock.getBoundingClientRect().height + step);
  });
}

function show() {
  ensureDock().hidden = false;
  paintTheme();
  setHeight(pref(heightKey(), defaultH()), false); // a smaller window than last time: clamped, not saved
  document.body.classList.add('term-open');
}
function hideIfEmpty() {
  if (tabs.size) return;
  dock.hidden = true;
  document.body.classList.remove('term-open', 'term-collapsed');
  place(); // gives the card its room back
}

function fitActive() {
  const t = active && tabs.get(active);
  if (!t || dock.hidden || dock.classList.contains('collapsed')) return;
  try { t.fit.fit(); } catch { /* not laid out yet */ }
}

function activate(id) {
  active = id;
  for (const [k, t] of tabs) {
    t.pane.hidden = k !== id;
    t.button.classList.toggle('active', k === id);
    t.button.setAttribute('aria-selected', String(k === id));
  }
  fitActive();
  tabs.get(id)?.term.focus();
}

/** An xterm screen in its own pane, sized to the dock. Resolves to { term, fit, pane } before any process exists. */
async function makePane() {
  const { Terminal, FitAddon } = await loadLibs();
  show();
  // xterm goes in an inner box with no padding: the fit addon sizes the columns to its parent's width,
  // and with border-box that width would include the pane's padding (text ran past the right edge).
  const screen = h('div', { class: 'td-screen' });
  const pane = h('div', { class: 'td-pane' }, screen);
  bodyEl().append(pane);
  const term = new Terminal({
    cursorBlink: true, fontFamily: css('--mono') || 'ui-monospace, Menlo, monospace', fontSize: 12.5, lineHeight: 1.15,
    theme: theme(), scrollback: 5000, allowProposedApi: false, macOptionIsMeta: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(screen);
  try { fit.fit(); } catch { /* fall back to the defaults */ }
  return { term, fit, pane };
}

function attach(info, { term, fit, pane }) {
  const t = { id: info.id, label: info.label || 'Claude', term, fit, pane, alive: info.alive !== false, writes: Promise.resolve() };
  const label = h('span', { class: 'td-label' }, t.label);
  t.button = h('button', { class: 'td-tab', role: 'tab', title: `${t.label}\n${info.cwd || ''}`, onclick: () => activate(t.id) },
    icon('terminal', 12), label,
    h('span', { class: 'td-x', role: 'button', title: 'Close (ends the process)', onclick: (e) => { e.stopPropagation(); closeTab(t.id); } }, icon('x', 12)));
  tabsEl().append(t.button);
  tabs.set(t.id, t);

  // Keystrokes: sent in order (one request after another), never reordered by the network.
  term.onData((data) => {
    if (!t.alive) return;
    t.writes = t.writes.then(() => api.termInput(t.id, data)).catch((e) => { if (e.status === 409) ended(t); });
  });
  term.onResize(({ cols, rows }) => { if (t.alive) api.termResize(t.id, cols, rows).catch(() => {}); });

  // Output: the stream opens with everything printed so far, so a reloaded page gets the screen back.
  const source = new EventSource(`/api/term/stream?id=${encodeURIComponent(t.id)}`);
  t.source = source;
  source.addEventListener('snapshot', (e) => {
    const p = JSON.parse(e.data);
    if (p.data) term.write(bytes(p.data));
    if (p.alive === false) ended(t);
    else { try { fit.fit(); } catch { /* ignore */ } }
  });
  source.addEventListener('data', (e) => term.write(bytes(JSON.parse(e.data).data)));
  source.addEventListener('exit', (e) => { ended(t, JSON.parse(e.data).exit_code); });
  source.onerror = () => { if (t.alive && source.readyState === EventSource.CLOSED) { ended(t); toast('Lost the terminal stream — close the tab and resume the session', true); } };
  activate(t.id);
  return t;
}

function ended(t, code) {
  if (!t.alive) return;
  t.alive = false;
  t.source?.close();
  t.button.classList.add('ended');
  t.term.write(`\r\n\x1b[2m[claude ended${code === undefined ? '' : ` with code ${code}`} — close this tab, or resume the session from its card]\x1b[0m\r\n`);
}

async function closeTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  tabs.delete(id);
  t.source?.close();
  t.button.remove();
  t.pane.remove();
  t.term.dispose();
  if (active === id) {
    active = null;
    const next = [...tabs.keys()].pop();
    if (next) activate(next);
  }
  hideIfEmpty(); // the UI goes first: ending the process can take a second or two (SIGHUP, then SIGTERM)
  try { await api.termClose(id); } catch { /* already gone */ }
}

// ── what the rest of the app calls ──────────────────────────────────────────
/** A new terminal on an item (or a bare prompt, key null): opened here, recorded like a Terminal.app launch. */
export async function openClaudeHere({ key = null, instruction = '', model = '', effort = '', cwd = '' } = {}) {
  const pane = await makePane();
  try {
    const out = await claudeTermOpen(key, instruction, model, effort, cwd, pane.term.cols, pane.term.rows);
    attach(out.term, pane);
    return out;
  } catch (e) {
    pane.pane.remove(); pane.term.dispose(); hideIfEmpty();
    throw e; // toasted by the state
  }
}

/** A recorded session, reopened here (`claude --resume`). If its terminal is already running in a tab, that tab comes to the front. */
export async function resumeClaudeHere(key, sessionId) {
  if (tabs.has(sessionId) && tabs.get(sessionId).alive) { show(); activate(sessionId); return null; }
  if (tabs.has(sessionId)) await closeTab(sessionId); // an ended tab of the same session: start over
  const pane = await makePane();
  try {
    const out = await api.termResume(key, sessionId, pane.term.cols, pane.term.rows);
    attach(out.term, pane);
    return out;
  } catch (e) {
    pane.pane.remove(); pane.term.dispose(); hideIfEmpty();
    toast(e.message, true);
    throw e;
  }
}

/** On page load: the terminals this server still runs get their tabs back, screen included. */
export async function restoreTerms() {
  let terms;
  try { terms = (await api.termList()).terms; } catch { return; }
  for (const info of terms) {
    if (tabs.has(info.id)) continue;
    try { attach(info, await makePane()); } catch (e) { toast(e.message, true); return; }
  }
  if (!tabs.size) return;
  const live = [...tabs.values()].find((t) => t.alive);
  activate((live || [...tabs.values()].pop()).id);
}

export const termIsOpen = () => Boolean(dock && !dock.hidden);
/** Whether the session `id` is running in a tab of the dock (an ended tab is not): Claude Desktop cannot take it then. */
export const termIsLive = (id) => Boolean(tabs.get(id)?.alive);
