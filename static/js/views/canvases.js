// Canvas: every canvas of the vault, whoever's (#/canvas, #/canvas/<path>), opened from its link in the sidebar, after
// Docs. As Docs: a panel on the left with the canvases in sections, the one picked on its right.
//
//   ┌ Canvas ─────────────┬─────────────────────────────────┐
//   │ ▾ Free           +  │ [Shapes|Items] ⋯ │               │
//   │   Ideas             │                  │  whiteboard   │
//   │ ▾ Goals          +  │                                  │
//   │ ▾ STY-482 · Checkout│                                  │
//   └─────────────────────┴─────────────────────────────────┘
//
// A section is a host, a folder of <Docs>/Canvases (GET /api/canvases/all): Free (`General`, the canvases of no page),
// Goals (the Goals view's), then each item's (its Canvas tab's: its ref, a project's key). The canvas on the right is
// the host's Canvas layout (canvas/canvasview.js) without its selector — this list is one —, its side column the
// host's items: an item's tree, the goals, or every open item. "+" on a section starts a canvas there; ⋯ → "Move to an
// item…" takes one to an item's Canvas tab.
import { api } from '../api.js';
import { askName, mountCanvasView } from '../canvas/canvasview.js';
import { emptyDrawing, fileName, serialize } from '../canvas/canvasfile.js';
import { canvasHost, canvasItems, openItems } from '../canvas/itemcanvas.js';
import { itemPicker } from '../itempicker.js';
import { itemCanvasProvider } from '../panel.js';
import { pref, setPref } from '../prefs.js';
import { cssWidth, wireResizer } from '../resizer.js';
import { TYPE_DEFS, isDone } from '../rules.js';
import { refOf } from '../shownid.js';
import { onChange, state, toast } from '../state.js';
import { h, icon, typeIcon } from '../ui.js';
import { goalsProvider } from './goals.js';
import { pathOfParam } from '../filetree.js';

export const FREE = 'General'; // the host of the canvases of no page
export const canvasHref = (path) => `#/canvas${path ? `/${path.split('/').map(encodeURIComponent).join('/')}` : ''}`;

let all = null;   // GET /api/canvases/all
let panel = null; // the list's element, while the view is shown
let shown = '';   // the path the view shows ('' none)
const folded = () => new Set(pref('canvas.page.folded', []));
const width = cssWidth({ cssVar: '--docs-w', key: 'canvas.page.w', def: 270, min: 200, max: 520,
  measure: () => document.querySelector('.canvases-page .docs-panel')?.getBoundingClientRect().width || 270 });

/** What a host is to this page: its section's title and icon, and the item it is of (if any). */
function hostOf(host) {
  if (host === FREE) return { host, title: 'Free', ico: icon('canvas', 14), rank: 0 };
  if (host === 'Goals') return { host, title: 'Goals', ico: typeIcon('goal', 14), rank: 1 };
  const item = state.all.find((i) => TYPE_DEFS[i.type]?.canvas && canvasHost(i) === host);
  if (item) return { host, item, title: `${refOf(item) || host} · ${item.title}`, ico: typeIcon(item.type, 14), rank: 2 };
  return { host, title: host, ico: icon('folder', 14), rank: 3 }; // a folder of no item the vault knows
}

/** The side column of a host's canvas: the goals, an item's tree, or every open item. */
function providerOf(h_, listed) {
  if (h_.host === 'Goals') return { ...goalsProvider, listed };
  const { item } = h_;
  const items = item ? () => canvasItems(state.all.find((k) => k.key === item.key) || item, state.items, state.byId, isDone)
    : () => openItems(state.items, isDone);
  return itemCanvasProvider({ items, whose: item ? refOf(item) || item.title : h_.title, listed });
}

/** The sections: Free first (there even while empty: its "+" starts the first canvas), Goals, the items', the rest. */
function sections() {
  const by = new Map([[FREE, []]]);
  for (const c of all?.canvases || []) { if (!by.has(c.host)) by.set(c.host, []); by.get(c.host).push(c); }
  return [...by.entries()].map(([host, canvases]) => ({ ...hostOf(host), canvases }))
    .sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
}

function toggle(host) {
  const set = folded();
  if (set.has(host)) set.delete(host); else set.add(host);
  setPref('canvas.page.folded', set.size ? [...set] : null);
  paint();
}

/** A new canvas in `host`'s folder, then shown. */
async function create(anchor, host) {
  const name = await askName(anchor, { title: host === FREE ? 'New canvas' : `New canvas in ${hostOf(host).title}`, button: 'Create' });
  if (!name) return;
  const path = `${all?.folder || 'Docs/Canvases'}/${host}/${fileName(name)}`;
  try {
    await api.createFile(path, serialize(emptyDrawing(), { host }), true);
    location.hash = canvasHref(path);
  } catch (err) { toast(err.status === 409 ? `There is already a canvas called ${name} there.` : err.message, true); }
}

/** ⋯ → "Move to an item…": the canvas goes to the Canvas tab of the item picked (its folder made with it). */
function moveToItem(c, anchor) {
  itemPicker(anchor, null, async (it) => {
    const host = it && canvasHost(it);
    if (!host || host === c.host) return;
    const folder = `${all?.folder || 'Docs/Canvases'}/${host}`;
    try {
      await api.makeFolder(folder, true).catch((err) => { if (err.status !== 409) throw err; });
      const r = await api.movePath(c.path, folder);
      toast(`${c.name} is now ${refOf(it) || it.title}'s.`);
      location.hash = canvasHref(r.path);
    } catch (err) { toast(err.status === 409 ? `${refOf(it) || it.title} already has a canvas called ${c.name}.` : err.message, true); }
  }, {
    keeps: (it) => !!TYPE_DEFS[it.type]?.canvas && !!canvasHost(it), none: null,
    first: () => state.items.filter((it) => TYPE_DEFS[it.type]?.canvas && canvasHost(it) && !isDone(it)).slice(0, 12),
    label: 'The item this canvas goes to',
  });
}

function paint() {
  if (!panel) return;
  const off = folded();
  panel.replaceChildren(...sections().flatMap((s) => {
    const isFolded = off.has(s.host);
    const head = h('div', { class: 'docs-head', 'data-host': s.host },
      h('button', { class: 'docs-title', 'aria-expanded': String(!isFolded), title: `${all?.folder || 'Docs/Canvases'}/${s.host}`, onclick: () => toggle(s.host) },
        icon(isFolded ? 'right' : 'down', 12), s.ico, h('span', {}, s.title)),
      h('button', { class: 'btn icon docs-add', title: `New canvas in ${s.title}`, 'aria-label': `New canvas in ${s.title}`,
        onclick: (e) => create(e.currentTarget, s.host) }, icon('plus', 14)));
    const rows = isFolded ? [] : s.canvases.length ? s.canvases.map((c) => h('a', {
      class: `canvas-row ${c.path === shown ? 'active' : ''}`, href: canvasHref(c.path), title: c.path,
      'aria-current': c.path === shown ? 'page' : null,
    }, icon('canvas', 14), h('span', {}, c.name))) : [h('p', { class: 'muted small canvas-none' }, 'No canvas yet')];
    return [head, ...rows];
  }));
}

function load() {
  return api.canvasAll().then((r) => { all = r; paint(); }).catch(() => {});
}
onChange(() => { if (panel) paint(); }); // an item renamed: its section's title

export function mount(root, param) {
  shown = pathOfParam(param);
  panel = h('nav', { class: 'docs-tree canvases-list', 'aria-label': 'Canvases' });
  const main = h('div', { class: 'canvases-main' });
  const grip = h('div', { class: 'docs-resizer', role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-label': 'Resize the Canvas panel', title: 'Drag to resize · double-click to reset' });
  width.apply();
  wireResizer(grip, { ...width, cls: 'docs-resizing' });
  root.replaceChildren(h('div', { class: 'docs-page canvases-page' },
    h('aside', { class: 'docs-panel', 'aria-label': 'Canvas' }, h('h2', { class: 'docs-panel-title' }, icon('canvas', 16), 'Canvas'), panel),
    grip, main));
  let view = null;
  let gone = false;
  const empty = (text) => main.replaceChildren(h('div', { class: 'empty docs-empty' }, icon('canvas', 22), h('p', {}, text),
    h('p', { class: 'muted small' }, 'A canvas is a whiteboard: shapes, arrows, notes, and items as cards. Each is a file in Docs/Canvases, and opens in Obsidian\'s Excalidraw too.'),
    h('button', { type: 'button', class: 'btn primary', onclick: (e) => create(e.currentTarget, FREE) }, icon('plus', 14), 'New canvas')));
  load().then(() => {
    if (gone) return;
    const c = shown && all?.canvases.find((x) => x.path === shown);
    if (!c) { empty(shown ? 'That canvas is not there any more: pick one on the left.' : 'Pick a canvas on the left, or start one.'); return; }
    const host = hostOf(c.host);
    view = mountCanvasView(main, {
      host: c.host, path: c.path, fixed: true,
      provider: providerOf(host, () => load()), // created, renamed or deleted from its ⋯: the list again
      // Its ⋯ opened another (a new one, a rename) or none (the last deleted): the address follows.
      onOpen: (now) => { if ((now?.path || '') !== shown) location.replace(canvasHref(now?.path || '')); },
      actions: (now, anchor) => [{ label: 'Move to an item…', icon: 'target', onSelect: () => moveToItem({ ...now, host: c.host }, anchor) }],
    });
  });
  return {
    update() { view?.update(); },
    async unmount() { gone = true; panel = null; if (view) await view.destroy(); },
  };
}
