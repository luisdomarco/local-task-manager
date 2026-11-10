// The canvas's shapes panel, as draw.io's: its families folding (General open), a search across them, and each one's
// figures as a grid of small pictures (shapes/thumb.js). A picture dragged onto the canvas drops its figure there; a
// click adds it in the middle of the view. What a figure is, is the catalog's (shapes/index.js).
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

const pictures = new Map(); // id → its SVG, drawn once
const picture = (s) => {
  if (!pictures.has(s.id)) pictures.set(s.id, thumbSvg(s));
  return pictures.get(s.id);
};

/** The panel in `el`. `onAdd(id)`: a picture clicked (or Enter on it). `enabled()`: a canvas is open to add to. */
export function mountShapePanel(el, { onAdd, enabled = () => true }) {
  let query = '';
  const opened = () => new Set(pref(OPEN_PREF, null) || CATEGORIES.filter((c) => c.open).map((c) => c.key));
  const input = h('input', { type: 'search', class: 'small shapes-search', placeholder: 'Search shapes', 'aria-label': 'Search shapes' });
  const list = h('div', { class: 'shapes-list' });
  input.addEventListener('input', () => { query = input.value; paint(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; query = ''; paint(); } });
  el.replaceChildren(h('div', { class: 'shapes-panel' }, input, list));

  const toggle = (key) => {
    const now = opened();
    if (now.has(key)) now.delete(key); else now.add(key);
    setPref(OPEN_PREF, [...now]);
    paint();
  };

  function tile(s) {
    const on = enabled();
    const btn = h('button', {
      type: 'button', class: 'shape-tile', title: s.name, 'aria-label': `Add ${s.name}`, draggable: on ? 'true' : 'false', disabled: !on,
      onclick: () => onAdd(s.id),
    });
    btn.innerHTML = picture(s); // our own SVG (thumb.js escapes its texts)
    btn.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData(SHAPE_MIME, s.id);
      e.dataTransfer.effectAllowed = 'copy';
      const img = btn.querySelector('svg');
      if (img) e.dataTransfer.setDragImage(img, 18, 18);
    });
    return btn;
  }

  function paint() {
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
