// The dock: Claude's sessions inside the app. A panel across the bottom of the main column: the sessions listed
// down its left side (with what each is doing), the one picked on the right, shown one of two ways:
//  - as a chat (chat.js): claude -p in stream-json, messages, tool calls and permission cards;
//  - as a terminal: an xterm.js screen attached to a pty the server runs, output on Server-Sent Events, keys by POST.
// The same Claude session either way (one session id): Chat / Terminal in the head hands it from one to the other,
// the server ending the one before starting the other. Closing a session ends its process; the conversation stays
// in Claude Code and can be resumed again. xterm.js and its fit addon are vendored under static/vendor/xterm/ and
// loaded the first time a terminal opens.
import { api } from './api.js';
import { chatView, statusLabel, statusTone } from './chat.js';
import { sessionStatus } from './chat-model.js';
import { pref, setPref } from './prefs.js';
import { itemName, itemPicker } from './itempicker.js';
import { claudeAssociate, claudeChatOpen, claudeTermOpen, onChange, state, toast } from './state.js';
import { setAlertTitle } from './tabtitle.js';
import { closeMenu, dropdown, h, icon, typeIcon } from './ui.js';
import { vaultId } from './vault.js';

const VENDOR = 'vendor/xterm';
// id → a session: { id, label, key, vault, cwd, kind: 'chat' | 'term', pane, row, alive, … }
//   a terminal also has { term, fit, source, writes }; a chat has { view } (chat.js)
const tabs = new Map();
const viewPref = () => (pref('dock.view', 'chat') === 'terminal' ? 'terminal' : 'chat');
let active = null;
let dock = null;
let collapseBtn = null;
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

// A terminal's pane has tokens of its own, not the page's (app.css .td-term): it takes Claude Code's theme (the
// server reads it, config.claude_theme), because Claude draws its screen for that theme whatever the app's light or
// dark is. The rest of the dock, the chat included, is the app's.
const css = (name, el) => getComputedStyle(el || document.documentElement).getPropertyValue(name).trim();
const theme = (pane) => ({
  background: css('--background', pane), foreground: css('--foreground', pane), cursor: css('--foreground', pane),
  selectionBackground: css('--accent', pane), selectionForeground: css('--foreground', pane),
});
const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// ── the dock itself ─────────────────────────────────────────────────────────
function ensureDock() {
  if (dock) return dock;
  const list = h('div', { class: 'td-list', role: 'listbox', 'aria-label': 'Claude sessions' });
  const side = h('div', { class: 'td-side' },
    h('div', { class: 'td-side-head' }, h('span', {}, 'Sessions'),
      h('button', { class: 'btn icon', title: NEW_TITLE, onclick: () => newSession() }, icon('plus', 14))),
    list);
  const main = h('div', { class: 'td-main' });
  const body = h('div', { class: 'td-body' }, side, main);
  const collapse = collapseBtn = h('button', { class: 'btn icon', title: 'Collapse', onclick: () => {
    const folded = dock.classList.toggle('collapsed');
    if (!folded) setAlertTitle('');
    collapse.title = folded ? 'Expand' : 'Collapse';
    collapse.replaceChildren(icon(folded ? 'up' : 'down', 16));
    document.body.classList.toggle('term-collapsed', folded);
    place();
    if (!folded) fitActive();
  } }, icon('down', 16));
  const grip = h('div', { class: 'td-grip', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Resize the dock', tabindex: '0',
    title: 'Drag to resize · double-click to fill up to the top bar' });
  const max = h('button', { class: 'btn icon td-max', title: 'Fill up to the top bar', onclick: () => toggleMax() }, icon('maximize', 15));
  const seg = h('div', { class: 'td-seg', role: 'tablist', 'aria-label': 'Show as' },
    h('button', { role: 'tab', 'data-view': 'chat', title: 'Chat', onclick: () => switchView(active, 'chat') },
      icon('message', 13), h('span', { class: 'td-seg-text' }, 'Chat')),
    h('button', { role: 'tab', 'data-view': 'terminal', title: 'Terminal', onclick: () => switchView(active, 'terminal') },
      icon('terminal', 13), h('span', { class: 'td-seg-text' }, 'Terminal')));
  dock = h('aside', { id: 'termdock', 'aria-label': 'Claude sessions', hidden: true }, grip,
    h('div', { class: 'td-head' }, h('span', { class: 'td-title' }, icon('bot', 14)),
      h('button', { type: 'button', class: 'btn small td-switch', 'aria-haspopup': 'menu', title: 'Sessions',
        onclick: (e) => sessionsMenu(e.currentTarget) }, h('span', { class: 'td-dot' }), h('span', { class: 'td-count' }), icon('down', 12)),
      h('div', { class: 'td-name' }, h('span', { class: 'td-name-label' })),
      h('button', { type: 'button', class: 'btn small td-item', 'aria-haspopup': 'dialog', onclick: (e) => pickItem(e.currentTarget) }),
      h('span', { class: 'spacer' }), seg, max, collapse,
      h('button', { class: 'btn icon', title: 'Close every session', onclick: () => [...tabs.keys()].forEach(closeTab) }, icon('x', 16))),
    body);
  // The app's shortcuts (q, /, g…) and its Escape must not fire while typing into a terminal or a chat.
  dock.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dock);
  wireGrip(grip);
  new ResizeObserver(() => fitActive()).observe(main);
  addEventListener('resize', () => { if (!dock.hidden) setHeight(dock.getBoundingClientRect().height, false); });
  new ResizeObserver(() => place()).observe(dock); // dragged, folded, unfolded: what is under it makes room again
  onChange(() => { for (const t of tabs.values()) paintRow(t); if (!active) paintHead(); }); // an item renamed, the vault loaded: the names follow
  return dock;
}
const listEl = () => dock.querySelector('.td-list');
const mainEl = () => dock.querySelector('.td-main');

/** A terminal light or dark as Claude Code is set up; a theme changed since (/theme) is picked up on the next reload. */
function paintTheme() {
  const light = state.config?.claude_theme === 'light';
  if (dock.classList.contains('td-light') === light && dock.dataset.painted) return;
  dock.classList.toggle('td-light', light);
  dock.dataset.painted = '1';
  for (const t of tabs.values()) if (t.term) t.term.options.theme = theme(t.pane);
}

// ── where it sits: one layer across the bottom of the content, above the pages and the item card alike ──
// Wherever a session was opened from, it is here. What is under it makes room: the page's bottom padding and the
// item card's (app.css, both from --dock-room, the height the dock takes now — folded, just its head).
function place() {
  if (!dock) return;
  const room = dock.hidden ? 0 : Math.round(dock.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--dock-room', `${room}px`);
}

// ── height: drag the top edge (or ↑/↓ on it); double-click or the button fills up to the top bar ──
const HEIGHT_PREF = 'dock.h';
const MIN_H = 180;
const maxHeight = () => {
  const bar = document.getElementById('pinbar');
  return Math.max(MIN_H, innerHeight - (bar ? bar.getBoundingClientRect().bottom : 0));
};
const clampH = (px) => Math.round(Math.max(MIN_H, Math.min(maxHeight(), px)));
const defaultH = () => Math.round(innerHeight * 0.42);
function setHeight(px, save = true) {
  const hgt = clampH(px);
  document.documentElement.style.setProperty('--dock-h', `${hgt}px`);
  if (save) setPref(HEIGHT_PREF, hgt);
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
  setHeight(pref(HEIGHT_PREF, defaultH()), false); // a smaller window than last time: clamped, not saved
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
  if (!t?.fit || dock.hidden || dock.classList.contains('collapsed')) return;
  try { t.fit.fit(); } catch { /* not laid out yet */ }
}

// ── the sessions list ───────────────────────────────────────────────────────
function status(t) {
  return t.kind === 'chat' && t.view ? t.view.status() : sessionStatus({ kind: 'term', alive: t.alive, exit_code: t.exitCode });
}

/** A session's row in the list: its status dot, its name, what it is doing; and the head, when it is the one shown. */
function paintRow(t) {
  if (!t.row) return;
  const st = status(t);
  t.row.querySelector('.td-dot').className = `td-dot tone-${statusTone(st)}`;
  const said = t.kind === 'term' && st !== 'terminal' ? `terminal · ${statusLabel(st)}` : statusLabel(st);
  const it = itemOf(t);
  t.row.querySelector('.td-sub').textContent = it ? `${said} · ${it.id || it.type}` : said;
  t.row.classList.toggle('ended', !t.alive);
  t.row.classList.toggle('needs-you', st === 'needs_you');
  if (t.id === active) paintHead();
  else paintSwitch();
}

// ── a narrow dock (a phone): the list is a menu, opened from the head (app.css hides the side and shows this) ──
/** Its button: how many sessions, and a dot — amber when any of them needs you, else the one shown's. */
function paintSwitch() {
  const all = [...tabs.values()];
  const shown = active && tabs.get(active);
  const st = all.some((t) => status(t) === 'needs_you') ? 'needs_you' : shown ? status(shown) : 'ended';
  dock.querySelector('.td-switch .td-dot').className = `td-dot tone-${statusTone(st)}`;
  dock.querySelector('.td-count').textContent = String(all.length);
  dock.querySelector('.td-switch').title = `${all.length} session${all.length === 1 ? '' : 's'}${st === 'needs_you' ? ' — one needs you' : ''}`;
}

/** The sessions as the list has them (newest on top), each with its dot and what it is doing; then a new one. */
function sessionsMenu(anchor) {
  const rows = [...listEl().querySelectorAll('.td-row')].map((row) => [...tabs.values()].find((t) => t.row === row)).filter(Boolean);
  const entry = (t) => h('button', { type: 'button', role: 'menuitem', class: `menu-item td-menurow ${t.id === active ? 'current' : ''}`,
    onclick: () => { closeMenu(); activate(t.id); } },
  h('span', { class: t.row.querySelector('.td-dot').className }),
  h('span', { class: 'td-rowtext' }, h('span', { class: 'td-label' }, t.label), h('span', { class: 'td-sub' }, t.row.querySelector('.td-sub').textContent)));
  dropdown(anchor, [{ heading: 'Sessions' }, h('div', { class: 'td-menu' }, rows.map(entry)), '-',
    { label: 'New session', icon: 'plus', onSelect: () => newSession() }], { width: 280 });
}

function paintHead() {
  const t = active && tabs.get(active);
  // About an item: the item is its title (the chip, which changes it). About none: its own name, then the chip.
  const name = dock.querySelector('.td-name');
  name.hidden = !t || Boolean(itemOf(t));
  name.querySelector('.td-name-label').textContent = t ? t.label : '';
  name.title = t ? `${t.label}\nRuns in ${t.cwd || '?'}` : '';
  paintItemChip(t);
  paintSwitch();
  for (const b of dock.querySelectorAll('.td-seg button')) {
    const on = Boolean(t) && (b.dataset.view === 'terminal') === (t.kind === 'term');
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
    b.disabled = !t || t.switching;
  }
}

function addRow(t, before = null) {
  t.row = h('div', { class: 'td-row', role: 'option', tabindex: '0', title: `${t.label}\n${t.cwd || ''}`,
    onclick: () => activate(t.id), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(t.id); } } },
  h('span', { class: 'td-dot' }),
  h('span', { class: 'td-rowtext' }, h('span', { class: 'td-label' }, t.label), h('span', { class: 'td-sub' })),
  h('button', { class: 'td-x', title: 'Close (ends the process)', onclick: (e) => { e.stopPropagation(); closeTab(t.id); } }, icon('x', 12)));
  if (before) before.replaceWith(t.row);
  else listEl().prepend(t.row); // newest on top
  paintRow(t);
}

function activate(id) {
  active = id;
  setAlertTitle('');
  for (const [k, t] of tabs) {
    t.pane.hidden = k !== id;
    t.row?.classList.toggle('active', k === id);
    t.row?.setAttribute('aria-selected', String(k === id));
  }
  paintHead();
  fitActive();
  const t = tabs.get(id);
  if (t?.term) t.term.focus();
  else t?.view?.focus();
}

// ── the item a session is about: its record is listed there (the item's AI tab), or in the general history ──
const itemOf = (t) => (t?.key ? state.items.find((it) => it.key === t.key) : null);
const otherVault = (t) => Boolean(t.vault && vaultId() && t.vault !== vaultId());

function paintItemChip(t) {
  const b = dock.querySelector('.td-item');
  b.hidden = !t;
  if (!t) return;
  const it = itemOf(t);
  const away = otherVault(t);
  b.disabled = away;
  b.classList.toggle('is-title', Boolean(it));
  b.title = `${away ? 'Opened in another vault: switch to it to change its item'
    : `${it ? itemName(it) : 'No item'} — change it to list this session in another history`}\nRuns in ${t.cwd || '?'}`;
  b.replaceChildren(...(it ? [typeIcon(it.type, 13)] : []), // not a null: replaceChildren writes it as text
    h('span', { class: 'td-item-text' }, it ? itemName(it) : t.key ? 'Another vault' : 'No item'), icon('down', 12));
}

function pickItem(btn) {
  const t = active && tabs.get(active);
  if (t && !otherVault(t)) itemPicker(btn, t.key, (it) => moveTo(t, it));
}

/** The session's record goes to `it`'s list (null: the general one) and the session takes its name. A chat also
 *  gets the item as a chip for the next message, to send its context along if wanted. */
async function moveTo(t, it) {
  const to = it ? it.key : null;
  if (to === (t.key || null)) return;
  let out;
  try { out = await claudeAssociate(t.id, t.key, to); } catch { return; } // toasted by the state
  t.key = to;
  rename(t, out.session?.label || (it ? itemName(it) : t.label));
  paintRow(t);
  if (it) t.view?.attachItem(it);
  toast(it ? `Moved to ${it.id || it.title}'s history` : 'Moved to the general history');
}

/** A history row's Move…: the dock's own move when it has that session open (its name and chip follow), else the
 *  record alone. */
export async function moveClaudeSession(sessionId, fromKey, it) {
  const t = tabs.get(sessionId);
  if (t) return moveTo(t, it);
  const to = it ? it.key : null;
  if (to === (fromKey || null)) return;
  try { await claudeAssociate(sessionId, fromKey, to); } catch { return; } // toasted by the state
  toast(it ? `Moved to ${it.id || it.title}'s history` : 'Moved to the general history');
}

// ── a terminal ──────────────────────────────────────────────────────────────
/** An xterm screen in its own pane, sized to the dock. Resolves to { term, fit, pane } before any process exists. */
async function makePane() {
  const { Terminal, FitAddon } = await loadLibs();
  show();
  // xterm goes in an inner box with no padding: the fit addon sizes the columns to its parent's width,
  // and with border-box that width would include the pane's padding (text ran past the right edge).
  const screen = h('div', { class: 'td-screen' });
  const pane = h('div', { class: 'td-pane td-term' }, screen);
  mainEl().append(pane);
  const term = new Terminal({
    cursorBlink: true, fontFamily: css('--mono') || 'ui-monospace, Menlo, monospace', fontSize: 12.5, lineHeight: 1.15,
    theme: theme(pane), scrollback: 5000, allowProposedApi: false, macOptionIsMeta: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(screen);
  try { fit.fit(); } catch { /* fall back to the defaults */ }
  return { term, fit, pane };
}

function attach(info, { term, fit, pane }, row = null) {
  const t = { id: info.id, kind: 'term', label: info.label || 'Claude', key: info.key || null, vault: info.vault || null, cwd: info.cwd || '',
    term, fit, pane, alive: info.alive !== false, exitCode: info.exit_code ?? null, writes: Promise.resolve() };
  tabs.set(t.id, t);
  addRow(t, row);

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
  source.onerror = () => { if (t.alive && source.readyState === EventSource.CLOSED) { ended(t); toast('Lost the terminal stream — close the session and resume it', true); } };
  activate(t.id);
  return t;
}

function ended(t, code) {
  if (!t.alive) return;
  t.alive = false;
  t.exitCode = code ?? null;
  t.source?.close();
  paintRow(t);
  if (t.switching) return; // handed to the chat: no message on a screen about to go
  t.term.write(`\r\n\x1b[2m[claude ended${code === undefined ? '' : ` with code ${code}`} — close it, or switch to Chat or Terminal to resume it]\x1b[0m\r\n`);
}

// ── telling you: a session that needs you, or finished its turn, while you look elsewhere ──
let asked = false; // the browser's permission to notify: asked once per page, with the first chat
function askToNotify() {
  if (asked || typeof Notification === 'undefined' || Notification.permission !== 'default') return;
  asked = true;
  Notification.requestPermission().catch(() => {});
}
addEventListener('visibilitychange', () => { if (!document.hidden && !dock?.classList.contains('collapsed')) setAlertTitle(''); });

/** A chat's status went from `prev` to `st`: worth telling when it waits for you now, or has just finished, and you
 *  cannot see it — another tab of the browser (a notification, if allowed), the dock folded or another session shown
 *  (a toast). Either way the tab's title says so until you come back. */
function tell(t, st, prev) {
  if (prev === undefined || st === prev) return; // the first status is the conversation loaded, not news
  const what = st === 'needs_you' ? 'needs you' : prev === 'working' && st === 'idle' ? 'finished' : '';
  const seen = !document.hidden && !dock.classList.contains('collapsed') && active === t.id;
  if (!what || seen) return;
  setAlertTitle(`${t.label} ${what}`);
  if (!document.hidden) { toast(`Claude · ${t.label} ${what}`); return; }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const n = new Notification(`Claude ${what}`, { body: t.label, tag: `tm-chat-${t.id}` });
  n.onclick = () => {
    window.focus();
    if (dock.classList.contains('collapsed')) collapseBtn.click();
    if (tabs.has(t.id)) activate(t.id);
    n.close();
  };
}

// ── a chat ──────────────────────────────────────────────────────────────────
function attachChat(info, row = null) {
  show();
  askToNotify();
  const t = { id: info.id, kind: 'chat', label: info.label || 'Claude', key: info.key || null, vault: info.vault || null, cwd: info.cwd || '',
    alive: info.alive !== false };
  t.view = chatView(info, {
    onChange: (v) => {
      t.alive = !v.chat.ended;
      if (v.chat.label && v.chat.label !== t.label) rename(t, v.chat.label); // a chat started empty, named by its first message
      paintRow(t);
      const st = v.status();
      tell(t, st, t.lastStatus);
      t.lastStatus = st;
    },
    onResume: () => resumeAs(t.id, 'chat'),
  });
  t.pane = t.view.el;
  mainEl().append(t.pane);
  tabs.set(t.id, t);
  addRow(t, row);
  activate(t.id);
  return t;
}

/** Drop a session's view, keeping its row in place for what replaces it. → that row. */
function dropView(t) {
  t.source?.close();
  t.view?.destroy();
  if (t.term) { t.pane.remove(); t.term.dispose(); }
  tabs.delete(t.id);
  return t.row;
}

/**
 * Show session `id` as a chat or as a terminal. The server ends the one that runs it now and resumes the session
 * in the other (`--resume`, same id); the chat starts with what was said before, read from the transcript.
 */
async function switchView(id, to, { remember = true } = {}) {
  const t = tabs.get(id);
  if (!t || t.switching) return;
  if (remember) setPref('dock.view', to);
  if ((to === 'terminal') === (t.kind === 'term') && t.alive) return;
  await resumeAs(id, to);
}

async function resumeAs(id, to) {
  const t = tabs.get(id);
  if (!t) return;
  t.switching = true;
  paintHead();
  try {
    if (to === 'terminal') {
      const pane = await makePane();
      let out;
      try { out = await api.termResume(t.key, id, pane.term.cols, pane.term.rows); } catch (e) { pane.pane.remove(); pane.term.dispose(); throw e; }
      attach(out.term, pane, dropView(t));
    } else {
      const out = await api.chatResume(t.key, id);
      attachChat({ ...out.chat, label: out.chat.label || t.label }, dropView(t));
    }
  } catch (e) {
    toast(e.message, true);
  } finally {
    t.switching = false;
    if (tabs.get(id)) paintRow(tabs.get(id));
  }
}

async function closeTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  dropView(t);
  t.row?.remove();
  if (active === id) {
    active = null;
    const next = listEl().querySelector('.td-row');
    const nextId = [...tabs.values()].find((x) => x.row === next)?.id;
    if (nextId) activate(nextId);
    else paintHead();
  }
  if (tabs.size) paintSwitch();
  hideIfEmpty(); // the UI goes first: ending the process can take a second or two
  try { await (t.kind === 'chat' ? api.chatClose(id) : api.termClose(id)); } catch { /* already gone */ }
}

// ── what the rest of the app calls ──────────────────────────────────────────
/** A new session on an item (or a bare prompt, key null), in the dock: a chat, or a terminal when that is the view
 * last picked. Recorded like a Terminal.app launch. `empty`: nothing is sent, it waits for the first message. */
export async function openClaudeHere({ key = null, instruction = '', model = '', effort = '', cwd = '', empty = false } = {}) {
  if (viewPref() === 'chat') {
    const out = await claudeChatOpen(key, instruction, model, effort, cwd, '', empty); // toasted by the state
    attachChat(out.chat);
    return out;
  }
  const pane = await makePane();
  try {
    const out = await claudeTermOpen(key, instruction, model, effort, cwd, pane.term.cols, pane.term.rows, empty);
    attach(out.term, pane);
    return out;
  } catch (e) {
    pane.pane.remove(); pane.term.dispose(); hideIfEmpty();
    throw e; // toasted by the state
  }
}

const NEW_TITLE = 'New session — empty, about the item open in the card (if any); the top bar\'s Claude button has the full dialog';

/** The list's "+": a session at once, with nothing sent, in the view last picked — about the item open in the card if
 *  there is one, with Settings' model and effort (the composer changes them). A chat gets that item as a chip for its
 *  first message, so its context goes along unless removed. The dialog (a folder, a saved prompt, Terminal.app or an
 *  editor) stays on the top bar's Claude button and the card's. */
async function newSession() {
  const key = (await import('./panel.js')).openItemKey();
  const item = key ? state.items.find((it) => it.key === key) : null;
  const { claude_model: model = '', claude_effort: effort = '', claude_cwd: dflt = '' } = state.config;
  let out;
  try { out = await openClaudeHere({ key: item?.key || null, model, effort, cwd: item ? '' : dflt, empty: true }); } catch { return; } // toasted by the state
  const t = out.chat && tabs.get(out.chat.id);
  if (t && item) t.view.attachItem(item);
  t?.view.focus();
}

/** A session's new name (another item, or the first message of one started empty), in its row and the head. */
function rename(t, label) {
  t.label = label;
  if (!t.row) return;
  t.row.querySelector('.td-label').textContent = label;
  t.row.title = `${label}\n${t.cwd || ''}`;
  if (t.id === active) paintHead();
}

/** A recorded session, reopened here (`claude --resume`), as the view last picked. If it is already running in the
 * dock, it comes to the front as it is. */
export async function resumeClaudeHere(key, sessionId) {
  const t = tabs.get(sessionId);
  if (t?.alive) { show(); activate(sessionId); return null; }
  if (t) { t.key = t.key || key; show(); await resumeAs(sessionId, viewPref()); return null; } // ended: started again in place
  try {
    if (viewPref() === 'chat') {
      const out = await api.chatResume(key, sessionId);
      attachChat(out.chat);
      return out;
    }
    const pane = await makePane();
    try {
      const out = await api.termResume(key, sessionId, pane.term.cols, pane.term.rows);
      attach(out.term, pane);
      return out;
    } catch (e) { pane.pane.remove(); pane.term.dispose(); hideIfEmpty(); throw e; }
  } catch (e) {
    toast(e.message, true);
    throw e;
  }
}

/** On page load: the chats and terminals this server still runs get their place back, conversation or screen included. */
export async function restoreTerms() {
  let chats = [];
  let terms = [];
  try {
    [chats, terms] = await Promise.all([api.chatList().then((r) => { state.claudeModels = r.offered || []; return r.chats; }),
      api.termList().then((r) => r.terms)]);
  } catch { return; }
  const all = [...chats.map((c) => ['chat', c]), ...terms.map((t) => ['term', t])].sort((a, b) => a[1].started - b[1].started);
  for (const [kind, info] of all) {
    if (tabs.has(info.id)) continue;
    try {
      if (kind === 'chat') attachChat(info);
      else attach(info, await makePane());
    } catch (e) { toast(e.message, true); return; }
  }
  if (!tabs.size) return;
  const live = [...tabs.values()].find((t) => t.alive && status(t) === 'needs_you') || [...tabs.values()].reverse().find((t) => t.alive);
  activate((live || [...tabs.values()].pop()).id);
}

export const termIsOpen = () => Boolean(dock && !dock.hidden);
/** Whether the session `id` is running in the dock, as a chat or a terminal (an ended one is not): Claude Desktop cannot take it then. */
export const termIsLive = (id) => Boolean(tabs.get(id)?.alive);
