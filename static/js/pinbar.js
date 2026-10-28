// Top bar, always shown. Left, the pinned items, Notion-style: the order is the `pins` list in
// <root>/.task-manager/pins.md. A chip opens its item; drag a chip to reorder; drop a card from any
// view on the bar to pin it; × (or Delete on a focused chip) unpins. Items that no longer exist are
// skipped, not shown as broken chips. Right, fixed: the Claude terminal (a prompt with no item).
import { openClaudeDialog } from './claude.js';
import { pageHref } from './datatable.js';
import { openPalette } from './palette.js';
import { opener } from './links.js';
import { discardMinimized, minimizedList, openItem, restoreItem } from './panel.js';
import { toggleSidebar } from './sidebar.js';
import { pin, state, unpin } from './state.js';
import { h, icon, typeIcon } from './ui.js';

const PIN_MIME = 'application/x-tm-pin';
const bar = () => document.getElementById('pinbar');
const chipsEl = () => bar()?.querySelector('.pin-chips');
const isPinDrag = (e) => [...e.dataTransfer.types].includes(PIN_MIME);
// Cards (week, board, lists) carry their item key as text/plain.
const isCardDrag = (e) => [...e.dataTransfer.types].includes('text/plain') && !isPinDrag(e);
let wired = false;

/** Where a drop lands among the chips, from the pointer's X (dragged chip excluded). */
function slot(e) {
  const chips = [...chipsEl().querySelectorAll('.pin-chip')].filter((c) => !c.classList.contains('dragging'));
  const i = chips.findIndex((c) => { const r = c.getBoundingClientRect(); return e.clientX < r.left + r.width / 2; });
  return { chips, index: i < 0 ? chips.length : i };
}

function chip(item, idx, total) {
  const move = (to) => pin(item.id, Math.max(0, Math.min(to, total - 1)));
  const open = h('button', {
    class: 'pin-open', title: `${item.id} · ${item.title}`,
    ...opener(item, openItem),
    onkeydown: (e) => {
      // Keyboard alternative to dragging: Shift+←/→ reorders, Delete unpins.
      if (e.shiftKey && e.key === 'ArrowLeft') { e.preventDefault(); move(idx - 1); }
      else if (e.shiftKey && e.key === 'ArrowRight') { e.preventDefault(); move(idx + 1); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); unpin(item.id); }
    },
  }, typeIcon(item.type, 13), h('span', { class: 'pin-title' }, item.title));
  const active = !!pageHref(item) && location.hash === pageHref(item);
  const el = h('div', { class: `pin-chip t-${item.type} ${active ? 'active' : ''}`, draggable: 'true', 'data-id': item.id },
    open,
    h('button', { class: 'pin-x', title: `Unpin ${item.title}`, onclick: (e) => { e.stopPropagation(); unpin(item.id); } }, icon('x', 12)));
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData(PIN_MIME, item.id);
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => el.classList.add('dragging'));
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  return el;
}

/** Built once: the chips' scroller on the left, the search and the Claude terminal on the right. Renders only touch the scroller. */
function wire(el) {
  const chips = h('div', { class: 'pin-chips' });
  const mins = h('div', { class: 'min-chips', 'aria-label': 'Minimized cards' }); // right of the pins, left of the terminal
  // Shown only while the sidebar is hidden (CSS), and always on a phone, where it opens the drawer: the way back.
  const expand = h('button', { class: 'btn icon', id: 'side-expand', title: 'Show the sidebar (⌘\\)', 'aria-label': 'Show the sidebar',
    'aria-controls': 'sidebar', 'aria-expanded': 'false', onclick: () => toggleSidebar(false) }, icon('sidebar', 16));
  addEventListener('tm:minimized', () => renderPinbar());
  el.replaceChildren(expand, chips, mins,
    h('button', {
      class: 'btn icon', id: 'pinbar-search', title: 'Search — items by id, title or text, views, files (⌘K)',
      'aria-label': 'Search', onclick: () => openPalette(),
    }, icon('search', 16)),
    h('button', {
      class: 'btn icon', id: 'pinbar-claude', title: 'Claude terminal — a prompt with no item, in the default folder',
      'aria-label': 'Claude terminal', onclick: () => openClaudeDialog(null),
    }, icon('terminal', 16)));
  const marker = h('span', { class: 'pin-marker', 'aria-hidden': 'true' });
  el.addEventListener('dragover', (e) => {
    if (!isPinDrag(e) && !isCardDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drop-over');
    const { chips: list, index } = slot(e);
    const ref = list[index] || null;
    if (ref ? marker.nextSibling !== ref : marker !== chips.lastChild) {
      if (ref) chips.insertBefore(marker, ref); else chips.append(marker); // among the chips, never after the button
    }
  });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) { marker.remove(); el.classList.remove('drop-over'); } });
  el.addEventListener('drop', (e) => {
    if (!isPinDrag(e) && !isCardDrag(e)) return;
    e.preventDefault();
    const index = slot(e).index;
    marker.remove();
    el.classList.remove('drop-over');
    const id = isPinDrag(e) ? e.dataTransfer.getData(PIN_MIME)
      : state.all.find((i) => i.key === e.dataTransfer.getData('text/plain'))?.id;
    if (id) pin(id, index);
  });
  document.addEventListener('dragend', () => { marker.remove(); el.classList.remove('drop-over'); });
}

export function renderPinbar() {
  const el = bar();
  if (!el) return;
  if (!wired) {
    wire(el);
    wired = true;
    // Its height, for what sits under it: an expanded item card (app.css #item-backdrop.expanded).
    new ResizeObserver(() => document.documentElement.style.setProperty('--pinbar-h', `${el.offsetHeight}px`)).observe(el);
  }
  const items = state.pins.map((id) => state.byId.get(id)).filter(Boolean);
  chipsEl().replaceChildren(
    h('span', { class: 'pin-label', title: 'Pinned — drag to reorder, drop a card here to pin it' }, icon('pin', 13)),
    ...(items.length ? items.map((it, i) => chip(it, i, items.length))
      : [h('span', { class: 'pin-empty muted small' }, 'Drop a card here to pin it')]));
  // Minimized cards: a click brings one back as it was; × forgets it. Items that no longer exist are skipped.
  const mins = minimizedList().map((m) => [m, state.all.find((i) => i.key === m.key) || state.byId.get(m.key)]).filter(([, it]) => it);
  bar().querySelector('.min-chips').replaceChildren(...mins.map(([m, it]) => h('div', { class: `min-chip t-${it.type}` },
    h('button', { class: 'pin-open', title: `Restore ${it.id || ''} · ${it.title}`.trim(), ...opener(it, () => restoreItem(m.key)) },
      icon('minimize', 13), typeIcon(it.type, 13), h('span', { class: 'pin-title' }, it.title)),
    h('button', { class: 'pin-x', title: `Forget ${it.title}`, onclick: () => discardMinimized(m.key) }, icon('x', 12)))));
}
