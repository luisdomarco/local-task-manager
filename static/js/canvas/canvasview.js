// A page's Canvas layout (Goals' first; any page can have one): its canvases, picked in a selector, and beside the
// whiteboard the page's items, to drag in. What the items are, and what a card says, is the provider's
// (whiteboard.js); the canvases are files in <Docs>/Canvases/<host> (GET /api/canvases).
//
//   ┌ [Roadmap ▾] ⋯ ──────┬───────────────────────────────┐
//   │ Goals   2 of 5 on it│                               │
//   │ ▸ Launch checkout ⌖ │        the whiteboard         │
//   │ ▸ Hire a designer   │                               │
//   └─────────────────────┴───────────────────────────────┘
import { api } from '../api.js';
import { filesHref } from '../filetree.js';
import { pref, setPref } from '../prefs.js';
import { toast } from '../state.js';
import { dropdown, h, icon, select, typeIcon } from '../ui.js';
import { closePopover, popover } from '../viewbar.js';
import { emptyDrawing, fileName, serialize } from './canvasfile.js';
import { ITEM_MIME, mountWhiteboard } from './whiteboard.js';

const NEW = '\u0000new'; // the selector's "New canvas…"

/** A name, asked in a popover under `anchor` → the name, or null. */
function askName(anchor, { title, value = '', button }) {
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
 * `items()` (the side list: what can be put on a canvas, in the page's order) and `line(item)` (a row's second line).
 * → { update() (the page's items changed), destroy() }.
 */
export function mountCanvasView(el, { host, provider }) {
  const prefKey = `canvas.${host}`;
  let list = null; // { folder, canvases: [{ name, path, rev }] }
  let board = null; // { path, wb }
  let placed = new Set();
  let dead = false;

  const head = h('div', { class: 'canvas-head' });
  const side = h('div', { class: 'canvas-items', role: 'list', 'aria-label': provider.label });
  const sideHead = h('div', { class: 'canvas-items-head' });
  const stage = h('div', { class: 'canvas-stage' });
  // The column folds to a rail (its button stays), for the whole width to draw in; remembered per page.
  const foldKey = `${prefKey}.folded`;
  const fold = h('button', { type: 'button', class: 'btn icon small canvas-fold' }, icon('sidebar', 16));
  const view = h('div', { class: 'canvas-view' }, h('aside', { class: 'canvas-side' }, h('div', { class: 'canvas-top' }, fold, head), sideHead, side), stage);
  const paintFold = () => {
    const off = !!pref(foldKey, false);
    view.classList.toggle('side-off', off);
    fold.title = off ? `Show the ${provider.label.toLowerCase()} and the canvases` : `Hide the ${provider.label.toLowerCase()}`;
    fold.setAttribute('aria-label', fold.title);
    fold.setAttribute('aria-expanded', String(!off));
  };
  fold.addEventListener('click', () => { setPref(foldKey, pref(foldKey, false) ? null : true); paintFold(); });
  paintFold();
  el.replaceChildren(view);

  const current = () => list?.canvases.find((c) => c.path === pref(prefKey, null)) || list?.canvases[0] || null;

  async function refresh(pick = null) {
    list = await api.canvases(host);
    if (dead) return;
    if (pick) setPref(prefKey, pick);
    paintHead();
    await open(current());
    paintSide();
  }

  async function open(c) {
    if (board && board.path === c?.path) return;
    if (board) { const old = board; board = null; await old.wb.destroy(); }
    if (dead) return;
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
    const pick = select([
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
        '-',
        { label: 'Move to the trash', icon: 'trash', onSelect: () => remove(c) },
      ], { width: 220 });
    });
    head.replaceChildren(pick, more);
  }

  function paintEmpty() {
    stage.replaceChildren(h('div', { class: 'canvas-empty' },
      icon('canvas', 28),
      h('p', {}, `No canvas for ${provider.label} yet. A canvas is a whiteboard: put ${provider.label.toLowerCase()} on it as cards, and draw around them — arrows, notes, shapes, frames.`),
      h('p', { class: 'muted' }, `It is saved in the vault (${list?.folder || 'Docs/Canvases'}), and opens in Obsidian's Excalidraw too.`),
      h('button', { type: 'button', class: 'btn primary', onclick: (e) => create(e.currentTarget) }, icon('plus', 14), 'Create canvas')));
  }

  function paintSide() {
    if (dead) return;
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
      }, typeIcon(provider.kind, 14),
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
    }) : [h('p', { class: 'muted canvas-items-empty' }, `No open ${provider.label.toLowerCase()}.`)]));
  }

  refresh().catch((err) => { stage.replaceChildren(h('div', { class: 'canvas-empty wb-error' }, err.message)); });

  return {
    update() { if (!list) return; board?.wb.sync(); paintSide(); },
    async destroy() { dead = true; if (board) { const old = board; board = null; await old.wb.destroy(); } },
  };
}
