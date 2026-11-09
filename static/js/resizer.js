// A grip that resizes a panel: drag it, or ←/→ (↑/↓ on a vertical one) while it has focus; double-click does what the
// panel says (back to its default, or the terminal dock's fill-up). One copy for every panel that resizes — the
// sidebar (sidebar.js), Docs' trees (views/docs.js), the terminal dock (term.js) — so they all behave alike.
// The arithmetic is apart from the page (dragDelta, keyDelta, clampSize) and tested in tests/js/resizer.test.mjs.
import { pref, setPref } from './prefs.js';

/** How much a drag from `start` to `pos` (clientX or clientY) changes the size; `invert`: the panel grows the other way
 *  (a dock that grows upward, a panel on the right that grows leftward). */
export const dragDelta = (start, pos, invert = false) => (pos - start) * (invert ? -1 : 1);

/** How much key `key` changes the size of a grip on `axis` ('x' resizes a width: ←/→; 'y' a height: ↑/↓), `step` a
 *  press; 0 for any other key. → and ↓ grow it, unless `invert`. */
export function keyDelta(key, axis, step, invert = false) {
  const keys = axis === 'y' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
  const dir = key === keys[1] ? 1 : key === keys[0] ? -1 : 0;
  return dir * step * (invert ? -1 : 1);
}

/** `px` within [min, max], rounded. */
export const clampSize = (px, min, max) => Math.round(Math.max(min, Math.min(max, px)));

/** Wires `grip` to resize a panel. `size()` → its size now (px); `set(px, done)` gives it a new one (`done` false while
 *  dragging: not saved yet); `reset()` on double-click. `cls`: a class on <html> while dragging (no transitions, the
 *  resize cursor everywhere). */
export function wireResizer(grip, { size, set, reset, axis = 'x', invert = false, step = 16, cls = null }) {
  const html = document.documentElement;
  const at = (e) => (axis === 'y' ? e.clientY : e.clientX);
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { grip.setPointerCapture(e.pointerId); } catch { /* the moves still arrive while the pointer stays on it */ }
    const start = at(e);
    const from = size();
    if (cls) html.classList.add(cls);
    const move = (ev) => set(from + dragDelta(start, at(ev), invert), false);
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      if (cls) html.classList.remove(cls);
      set(size(), true);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  if (reset) grip.addEventListener('dblclick', reset);
  grip.addEventListener('keydown', (e) => {
    const d = keyDelta(e.key, axis, step, invert);
    if (!d) return;
    e.preventDefault();
    set(size() + d, true);
  });
}

/** The common case: a width kept in CSS variable `cssVar` on <html>, between `min` and `max`, remembered as pref `key`
 *  (prefs.js), `def` until one is picked. `measure()` → the panel's width now. → { apply, size, set, reset }: `apply()`
 *  puts the remembered width back (at start-up, or when the panel is drawn). */
export function cssWidth({ cssVar, key, def, min, max, measure }) {
  const root = document.documentElement;
  const put = (px) => root.style.setProperty(cssVar, `${clampSize(px, min, max)}px`);
  return {
    apply: () => put(pref(key, def)),
    size: measure,
    set: (px, done) => { put(px); if (done) setPref(key, clampSize(px, min, max)); },
    reset: () => { put(def); setPref(key, null); },
  };
}
