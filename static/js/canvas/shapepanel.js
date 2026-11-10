// The canvas's shapes panel, as draw.io's: its families folding (General open), a search across them, and each one's
// figures as a grid of small pictures (shapes/thumb.js). A picture dragged onto the canvas drops its figure there; a
// click adds it in the middle of the view. A picture under the mouse shows its figure larger, with its name, beside the
// panel (draw.io's preview). What a figure is, is the catalog's (shapes/index.js).
//
//   [ Search shapes        ]
//   ▾ General
//   ▢ ▭ T H ◯ ▢ ◯ ▥ ◇ ▱
//   ▸ Arrows
//   ▸ BPMN 2.0 Activities
import { pref, setPref } from '../prefs.js';
import { h, icon } from '../ui.js';
import { CATEGORIES, search } from './shapes/index.js';
import { thumbSvg } from './shapes/thumb.js';

export const SHAPE_MIME = 'application/x-tm-shape'; // a picture, dragged: its figure's id
const OPEN_PREF = 'canvas.shapes.open'; // the families unfolded (General until you fold it)

const pictures = new Map(); // `${size}:${id}` → its SVG, drawn once
const picture = (s, size = 36) => {
  const key = `${size}:${s.id}`;
  if (!pictures.has(key)) pictures.set(key, size === 36 ? thumbSvg(s) : thumbSvg(s, { size, pad: 10 }));
  return pictures.get(key);
};
const PEEK = 128; // the preview's picture, px

/** The panel in `el`. `onAdd(id)`: a picture clicked (or Enter on it). `enabled()`: a canvas is open to add to. */
export function mountShapePanel(el, { onAdd, enabled = () => true }) {
  let query = '';
  const opened = () => new Set(pref(OPEN_PREF, null) || CATEGORIES.filter((c) => c.open).map((c) => c.key));
  const input = h('input', { type: 'search', class: 'small shapes-search', placeholder: 'Search shapes', 'aria-label': 'Search shapes' });
  const list = h('div', { class: 'shapes-list' });
  input.addEventListener('input', () => { query = input.value; paint(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; query = ''; paint(); } });
  // The preview: fixed, so it shows outside the panel's scrolling list; beside the panel, level with the picture.
  const peek = h('div', { class: 'shape-peek', role: 'tooltip', hidden: true });
  el.replaceChildren(h('div', { class: 'shapes-panel' }, input, list, peek));
  const hide = () => { peek.hidden = true; };
  function show(s, btn) {
    peek.innerHTML = picture(s, PEEK); // our own SVG, as the tile's
    peek.append(h('div', { class: 'shape-peek-name' }, s.name));
    peek.hidden = false;
    const tile = btn.getBoundingClientRect();
    const side = list.getBoundingClientRect();
    const { width, height } = peek.getBoundingClientRect();
    const clamp = (v, max) => Math.max(8, Math.min(v, max - 8));
    // Right of the panel; on a narrow window (the panel above the canvas, full width) right of the picture, kept inside.
    const left = side.right + 8 + width <= window.innerWidth - 8 ? side.right + 8 : clamp(tile.right + 8, window.innerWidth - width);
    peek.style.left = `${left}px`;
    peek.style.top = `${clamp(tile.top + tile.height / 2 - height / 2, window.innerHeight - height)}px`;
  }
  list.addEventListener('scroll', hide, { passive: true });

  const toggle = (key) => {
    const now = opened();
    if (now.has(key)) now.delete(key); else now.add(key);
    setPref(OPEN_PREF, [...now]);
    paint();
  };

  function tile(s) {
    const on = enabled();
    const btn = h('button', {
      type: 'button', class: 'shape-tile', 'aria-label': `Add ${s.name}`, draggable: on ? 'true' : 'false', disabled: !on,
      onclick: () => { hide(); onAdd(s.id); },
    });
    // A mouse over it shows the preview (a finger has no hover: a tap adds the figure).
    btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') show(s, btn); });
    btn.addEventListener('pointerleave', hide);
    btn.innerHTML = picture(s); // our own SVG (thumb.js escapes its texts)
    btn.addEventListener('dragstart', (e) => {
      hide();
      e.dataTransfer.setData(SHAPE_MIME, s.id);
      e.dataTransfer.effectAllowed = 'copy';
      const img = btn.querySelector('svg');
      if (img) e.dataTransfer.setDragImage(img, 18, 18);
    });
    return btn;
  }

  function paint() {
    hide();
    const found = search(query);
    const open = opened();
    const searching = !!query.trim();
    list.replaceChildren(...(found.length ? found.map((c) => {
      const unfolded = searching || open.has(c.key);
      return h('section', { class: 'shapes-group' },
        h('button', { type: 'button', class: 'shapes-group-head', 'aria-expanded': String(unfolded), disabled: searching, onclick: () => toggle(c.key) },
          icon(unfolded ? 'down' : 'right', 12), h('span', {}, c.title), searching ? h('span', { class: 'muted' }, String(c.shapes.length)) : null),
        unfolded ? h('div', { class: 'shapes-grid' }, ...c.shapes.map(tile)) : null);
    }) : [h('p', { class: 'muted shapes-none' }, `No shape called “${query.trim()}”.`)]));
  }
  paint();

  return {
    /** A canvas opened or closed: its pictures can be added, or not (drawn again only when that changed). */
    update() {
      const on = enabled();
      for (const b of list.querySelectorAll('.shape-tile')) { b.disabled = !on; b.draggable = on; }
    },
  };
}
