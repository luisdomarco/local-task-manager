// A page's Canvas layout (Goals' first; any page can have one): its canvases, picked in a selector, and beside the
// whiteboard a column of two tabs: Shapes (draw.io's figures, shapepanel.js) and the page's items, to drag in as
// cards. What the items are, and what a card says, is the provider's (whiteboard.js); the canvases are files in
// <Docs>/Canvases/<host> (GET /api/canvases).
//
//   ┌ [Roadmap ▾] ⋯ ──────┬───────────────────────────────┐
//   │ [Shapes] [Goals]    │                               │
//   │ ▾ General           │        the whiteboard         │
//   │ ▢ ▭ ◯ ◇ ▱ ⬡         │                               │
//   └─────────────────────┴───────────────────────────────┘
import { api } from '../api.js';
import { filesHref } from '../filetree.js';
import { pref, setPref } from '../prefs.js';
import { toast } from '../state.js';
import { dropdown, emptyLine, h, icon, secondaryButton, seg, select, typeIcon } from '../ui.js';
import { closePopover, popover } from '../viewbar.js';
import { emptyDrawing, fileName, serialize } from './canvasfile.js';
import { mountShapePanel } from './shapepanel.js';
import { ITEM_MIME, mountWhiteboard } from './whiteboard.js';

const NEW = '\u0000new'; // the selector's "New canvas…"

/** A name, asked in a popover under `anchor` → the name, or null. */
export function askName(anchor, { title, value = '', button }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; closePopover(); resolve(v); } };
    const pop = popover(anchor, (el) => {
      const input = h('input', { type: 'text', class: 'small', value, placeholder: 'Roadmap, Q1 risks…', 'aria-label': title });
      const err = h('p', { class: 'muted canvas-name-err', hidden: true });
      const ok = () => {
        if (!fileName(input.value)) { err.hidden = false; err.textContent = 'A name without / : * ? " < > | # ^ [ ]'; input.focus(); return; }
        finish(input.value.trim().replace(/\s+/g, ' '));
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
      el.replaceChildren(h('div', { class: 'canvas-name' }, h('div', { class: 'menu-label' }, title), input, err,
        h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn primary small', onclick: ok }, button))));
      setTimeout(() => { input.focus(); input.select(); });
    }, { width: 280 });
    if (!pop) { resolve(null); return; }
    // Closed by a click outside or Escape: nothing.
    const watch = new MutationObserver(() => { if (!document.body.contains(pop.el)) { watch.disconnect(); finish(null); } });
    watch.observe(document.body, { childList: true });
  });
}

/**
 * The Canvas layout in `el`. `host` names the page's canvases folder ('Goals'); `provider` is the whiteboard's, plus
 * `items()` (the side list: what can be put on a canvas, in the page's order), `line(item)` (a row's second line) and,
 * if it wants them, `listed(n)` (how many canvases the host has, each time they are listed) and `whose` (what its empty
 * state names, its label otherwise: "No canvas for STY-482 yet").
 * The Canvas page (views/canvases.js) opens one canvas of the host by its `path`, hears which one shows (`onOpen(c)`:
 * the canvas, or null for none), adds its own entries to the ⋯ menu (`actions(c, anchor)` → dropdown items) and, its
 * own list being the selector, shows the canvas's name instead of one (`fixed`).
 * → { update() (the page's items changed), destroy() }.
 */
export function mountCanvasView(el, { host, provider, path = null, onOpen = () => {}, actions = () => [], fixed = false }) {
  const prefKey = `canvas.${host}`;
  if (path) setPref(prefKey, path); // the one asked for, while the host has it (current() falls back to the first)
  let list = null; // { folder, canvases: [{ name, path, rev }] }
  let board = null; // { path, wb }
  let placed = new Set();
  let dead = false;

  const head = h('div', { class: 'canvas-head' });
  const side = h('div', { class: 'canvas-items', role: 'list', 'aria-label': provider.label });
  const sideHead = h('div', { class: 'canvas-items-head' });
  const stage = h('div', { class: 'canvas-stage' });
  // The column's two tabs: the figures to draw with, or the page's items to put on it as cards (remembered per page).
  const tabKey = `${prefKey}.side`;
  const shapesEl = h('div', { class: 'canvas-shapes' });
  const itemsEl = h('div', { class: 'canvas-items-pane' }, sideHead, side);
  let segEl = h('span'); // Shapes | Items, drawn by paintTab
  const paintTab = () => {
    const now = pref(tabKey, 'shapes') === 'items' ? 'items' : 'shapes';
    const next = seg([['shapes', 'Shapes'], ['items', provider.label]], now, (k) => { setPref(tabKey, k === 'shapes' ? null : k); paintTab(); },
      { aria: 'Draw with', role: 'tablist', cls: 'canvas-seg' });
    segEl.replaceWith(next);
    segEl = next;
    shapesEl.hidden = now !== 'shapes';
    itemsEl.hidden = now !== 'items';
  };
  // The column folds to a rail (its button stays), for the whole width to draw in; remembered per page.
  const foldKey = `${prefKey}.folded`;
  const fold = h('button', { type: 'button', class: 'btn icon small canvas-fold' }, icon('sidebar', 16));
  const view = h('div', { class: 'canvas-view' }, h('aside', { class: 'canvas-side' }, h('div', { class: 'canvas-top' }, fold, head), segEl, shapesEl, itemsEl), stage);
  const paintFold = () => {
    const off = !!pref(foldKey, false);
    view.classList.toggle('side-off', off);
    fold.title = off ? 'Show the shapes, the canvases and the ' + provider.label.toLowerCase() : 'Hide the column';
    fold.setAttribute('aria-label', fold.title);
    fold.setAttribute('aria-expanded', String(!off));
  };
  fold.addEventListener('click', () => { setPref(foldKey, pref(foldKey, false) ? null : true); paintFold(); });
  paintFold();
  paintTab();
  el.replaceChildren(view);
  const shapes = mountShapePanel(shapesEl, { onAdd: (id) => board?.wb.addShape(id), enabled: () => !!board });

  const current = () => list?.canvases.find((c) => c.path === pref(prefKey, null)) || list?.canvases[0] || null;

  async function refresh(pick = null) {
    list = await api.canvases(host);
    if (dead) return;
    provider.listed?.(list.canvases.length); // an item's Canvas tab counts them
    if (pick) setPref(prefKey, pick);
    paintHead();
    await open(current());
    paintSide();
  }

  async function open(c) {
    if (board && board.path === c?.path) return;
    if (board) { const old = board; board = null; await old.wb.destroy(); }
    if (dead) return;
    onOpen(c);
    if (!c) { paintEmpty(); return; }
    setPref(prefKey, c.path);
    const wb = mountWhiteboard(stage, {
      path: c.path, host, name: c.name, provider,
      onCards: (ids) => { placed = ids; paintSide(); },
    });
    board = { path: c.path, wb };
  }

  async function create(anchor) {
    const name = await askName(anchor, { title: 'New canvas', value: list?.canvases.length ? '' : provider.label, button: 'Create' });
    if (!name) return;
    const path = `${list.folder}/${fileName(name)}`;
    try {
      await api.createFile(path, serialize(emptyDrawing(), { host }), true);
      await refresh(path);
    } catch (err) { toast(err.status === 409 ? `There is already a canvas called ${name}.` : err.message, true); }
  }

  async function rename(anchor, c) {
    const name = await askName(anchor, { title: 'Rename canvas', value: c.name, button: 'Rename' });
    if (!name || name === c.name) return;
    try {
      if (board?.path === c.path) { const old = board; board = null; await old.wb.destroy(); }
      const r = await api.renamePath(c.path, fileName(name));
      await refresh(r.path);
    } catch (err) { toast(err.message, true); await refresh(); }
  }

  async function remove(c) {
    try {
      if (board?.path === c.path) { const old = board; board = null; await old.wb.destroy(); }
      const r = await api.deletePath(c.path);
      setPref(prefKey, null);
      await refresh();
      toast(`${c.name} moved to the trash.`, false, { label: 'Undo', run: async () => { await api.restoreFile(r.trashed); await refresh(c.path); } });
    } catch (err) { toast(err.message, true); await refresh(); }
  }

  function paintHead() {
    const c = current();
    if (!list.canvases.length) { head.replaceChildren(); return; }
    const pick = fixed ? h('span', { class: 'canvas-pick canvas-name-fixed', title: c.path }, icon('canvas', 14), h('span', {}, c.name)) : select([
      ...list.canvases.map((x) => [x.path, x.name, 'canvas']),
      [NEW, 'New canvas…', 'plus'],
    ], c?.path, (v) => {
      if (v === NEW) { pick.value = c?.path; create(pick); return; }
      setPref(prefKey, v);
      open(current()).then(paintSide);
    }, { class: 'canvas-pick', 'aria-label': 'Canvas', search: false });
    const more = h('button', { type: 'button', class: 'btn icon small', title: 'Canvas actions', 'aria-haspopup': 'menu' }, icon('more', 16));
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown(more, [
        { heading: c.name },
        { label: 'New canvas…', icon: 'plus', onSelect: () => create(more) },
        { label: 'Rename', icon: 'pencil', onSelect: () => rename(more, c) },
        { label: 'Open in the Explorer', icon: 'foldertree', onSelect: () => { location.hash = filesHref(c.path); } },
        ...actions(c, more),
        '-',
        { label: 'Move to the trash', icon: 'trash', onSelect: () => remove(c) },
      ], { width: 220 });
    });
    head.replaceChildren(pick, more);
  }

  function paintEmpty() {
    // An empty place: one grey line and what fills it (design.md §Empty); what a canvas is, in README and the tooltip
    stage.replaceChildren(h('div', { class: 'canvas-empty' },
      emptyLine(`No canvas for ${provider.whose || provider.label} yet.`),
      secondaryButton('Create canvas', { ico: 'plus', title: `A whiteboard, saved in ${list?.folder || 'Docs/Canvases'}: it opens in Obsidian's Excalidraw too`,
        onclick: (e) => create(e.currentTarget) })));
  }

  function paintSide() {
    if (dead) return;
    shapes.update(); // its pictures can be added once a canvas is open
    const items = provider.items();
    const on = items.filter((i) => placed.has(i.id)).length;
    sideHead.replaceChildren(h('span', { class: 'canvas-items-title' }, provider.label),
      ...(board ? [h('span', { class: 'muted' }, `${on} of ${items.length} on it`)] : []));
    side.replaceChildren(...(items.length ? items.map((it) => {
      const isOn = placed.has(it.id);
      const card = provider.card(it);
      const row = h('div', {
        class: `canvas-item ${isOn ? 'placed' : ''}`, role: 'listitem', draggable: board && !isOn ? 'true' : 'false', tabindex: board ? '0' : null,
        title: !board ? '' : isOn ? `${card.title} — on the canvas: ⌖ finds it` : `${card.title} — drag it onto the canvas, or click to add it in the middle`,
      }, typeIcon(it.type || provider.kind, 14),
      h('span', { class: 'canvas-item-text' }, h('span', { class: 'canvas-item-title' }, card.title), h('span', { class: 'canvas-item-line muted' }, provider.line(it))),
      isOn ? h('button', { type: 'button', class: 'btn icon small', title: 'Find it on the canvas', 'aria-label': `Find ${card.title} on the canvas`,
        onclick: (e) => { e.stopPropagation(); board?.wb.locate(it.id); } }, icon('target', 14)) : null);
      if (board && !isOn) {
        row.addEventListener('dragstart', (e) => { e.dataTransfer.setData(ITEM_MIME, it.id); e.dataTransfer.effectAllowed = 'copy'; });
        const add = () => board?.wb.addCard(it);
        row.addEventListener('click', add);
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); add(); } });
      } else if (board) row.addEventListener('click', () => board?.wb.locate(it.id));
      return row;
    }) : [emptyLine(`No open ${provider.label.toLowerCase()}.`, { cls: 'canvas-items-empty' })]));
  }

  refresh().catch((err) => { stage.replaceChildren(h('div', { class: 'canvas-empty wb-error' }, err.message)); });

  return {
    update() { if (!list) return; board?.wb.sync(); paintSide(); },
    async destroy() { dead = true; if (board) { const old = board; board = null; await old.wb.destroy(); } },
  };
}
