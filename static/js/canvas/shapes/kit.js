// What a figure of the shapes panel is made of (shapes/index.js): Excalidraw skeletons, drawn as draw.io draws them —
// white, a 1 px black line, square corners. Excalidraw has only rectangles, diamonds, ellipses, lines, arrows and texts,
// so a figure that is none of those is a group of two kinds of part (docs/design.md, Canvases):
//
//   the ink  what you see: closed lines filled white (a hexagon, a cylinder's body), ellipses, a marker's strokes
//   the box  a rectangle the figure's size, on top, all but invisible (a fill of alpha 1/255, no line): what an arrow
//            binds to, what holds its label (a double-click writes in it), what is taken hold of from its middle
//
// A figure whose outline is a rectangle, a diamond or an ellipse is its own box (`self`): that outline holds the label.
// Every part says what it is in `customData`: { tmShape: <figure id>, tmRole: 'box' | 'outline' | 'ink' | 'mark' }.
// Pure: no DOM, no Excalidraw (tests/js/canvasshapes.test.mjs).

export const INK = '#000000';
export const PAPER = '#ffffff';
export const BOX_FILL = '#ffffff01'; // filled (so it is hit, and an arrow binds to its middle), never seen
export const NONE = 'transparent';

const base = { roughness: 0, strokeWidth: 1, strokeColor: INK, backgroundColor: PAPER, fillStyle: 'solid', strokeStyle: 'solid', roundness: null, opacity: 100 };
const r1 = (n) => Math.round(n * 10) / 10;

// ── parts, in the figure's own coordinates (its top-left corner is 0, 0) ──
export const rect = (x, y, width, height, o = {}) => ({ ...base, type: 'rectangle', x, y, width, height, ...o });
export const ellipse = (x, y, width, height, o = {}) => ({ ...base, type: 'ellipse', x, y, width, height, ...o });
export const diamond = (x, y, width, height, o = {}) => ({ ...base, type: 'diamond', x, y, width, height, ...o });
/** A line through `pts` ([[x, y]…]); `close`: back to its first point, filled (`backgroundColor`). */
export function path(pts, { close = false, ...o } = {}) {
  const all = close ? [...pts, pts[0]] : pts;
  const [x0, y0] = all[0];
  return { ...base, backgroundColor: close ? PAPER : NONE, type: 'line', x: r1(x0), y: r1(y0), points: all.map(([x, y]) => [r1(x - x0), r1(y - y0)]), ...o };
}
export const poly = (pts, o = {}) => path(pts, { close: true, ...o });
/** A text, its top-left at x, y. */
export const text = (x, y, s, o = {}) => ({ type: 'text', x, y, text: s, fontSize: 14, fontFamily: 6, strokeColor: INK, roughness: 0, ...o });
/** An arrow or a line from 0, 0 to `dx`, `dy` (the panel's lines and flows). */
export const link = (dx, dy, o = {}) => ({ ...base, type: 'arrow', x: 0, y: 0, points: [[0, 0], [dx, dy]], backgroundColor: NONE,
  startArrowhead: null, endArrowhead: null, ...o });

// ── geometry ──
/** Points along an ellipse's arc, from `a0` to `a1` degrees (0 east, 90 south: the page's y goes down). */
export function arc(cx, cy, rx, ry, a0, a1, n = 10) {
  const out = [];
  for (let i = 0; i <= n; i += 1) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}
/** `pts` turned `deg` degrees about cx, cy. */
export const turn = (pts, cx, cy, deg) => {
  const a = (deg * Math.PI) / 180;
  return pts.map(([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]);
};
/** `pts` moved by dx, dy. */
export const shift = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);
/** A regular polygon of `n` corners in the box x, y, w, h, its first corner at `a0` degrees. */
export const ngon = (n, x, y, w, h, a0 = -90) => arc(x + w / 2, y + h / 2, w / 2, h / 2, a0, a0 + 360 - 360 / n, n - 1);
/** A star of `n` points: corners at the box's edge, inner ones at `inner` of it. */
export function star(n, x, y, w, h, inner = 0.45) {
  const out = [];
  for (let i = 0; i < n * 2; i += 1) {
    const a = ((-90 + (180 / n) * i) * Math.PI) / 180;
    const k = i % 2 ? inner : 1;
    out.push([x + w / 2 + (w / 2) * k * Math.cos(a), y + h / 2 + (h / 2) * k * Math.sin(a)]);
  }
  return out;
}
/** A wave from x0 to x1 about y (`amp` high, one period over the run), `n` points. */
export const wave = (x0, x1, y, amp, n = 16) => Array.from({ length: n + 1 }, (_, i) => {
  const x = x0 + ((x1 - x0) * i) / n;
  return [x, y + amp * Math.sin((2 * Math.PI * i) / n)];
});
/** A cloud: an ellipse's edge in `n` bumps, each pushed `bump` out. */
export function scallop(cx, cy, rx, ry, n, bump) {
  const out = [];
  for (let k = 0; k < n; k += 1) {
    const [a, b] = [k, k + 1].map((i) => (2 * Math.PI * i) / n);
    const p0 = [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
    const p1 = [cx + rx * Math.cos(b), cy + ry * Math.sin(b)];
    const m = (a + b) / 2;
    const c = [cx + (rx + bump * 2) * Math.cos(m), cy + (ry + bump * 2) * Math.sin(m)];
    for (let i = 0; i < 6; i += 1) { // a quadratic Bézier from p0 to p1, pulled to c
      const t = i / 6;
      out.push([(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t ** 2 * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t ** 2 * p1[1]]);
    }
  }
  return out;
}

// ── a figure ──
/**
 * A figure of the panel. `parts` are its ink (the first one its outline when `self`), in its own coordinates.
 *   self   its first part (a rectangle, diamond or ellipse) is its box
 *   label  the text it is born with ('' none: a double-click on it writes one); `align`: its label's corner
 *   below  a free text under it (an actor's name, an event's)
 *   line   a lone line or arrow (no box, no group)
 * → { id, name, w, h, skeleton(x = 0, y = 0) → Excalidraw skeletons at x, y, its parts in one group }
 */
export function figure(id, name, w, h, parts, { self = false, label = '', align = null, below = null, line = false, keywords = '' } = {}) {
  const skeleton = (x = 0, y = 0) => {
    const at = (p) => ({ ...p, x: r1(p.x + x), y: r1(p.y + y) });
    if (line) return parts.map((p) => ({ ...at(p), customData: { tmShape: id } }));
    const lbl = label ? { label: { text: label, fontSize: 14, fontFamily: 6, strokeColor: INK, ...(align || {}) } } : {};
    const ink = parts.map((p, i) => {
      const mark = p.customData?.tmRole === 'mark';
      const role = self && i === 0 ? 'outline' : mark ? 'mark' : 'ink';
      return { ...at(p), customData: { tmShape: id, tmRole: role }, ...(self && i === 0 ? lbl : {}) };
    });
    const box = self ? [] : [{ ...rect(x, y, w, h), strokeColor: NONE, backgroundColor: BOX_FILL, customData: { tmShape: id, tmRole: 'box' }, ...lbl }];
    const under = below ? [{ ...text(x + w / 2 - (below.length * 7.6) / 2, y + h + 6, below), customData: { tmShape: id, tmRole: 'ink' } }] : [];
    const all = [...ink, ...box, ...under];
    return all.length > 1 ? all.map((p) => ({ ...p, groupIds: [`tm-shape-${id}`] })) : all;
  };
  return { id, name, w, h, keywords, skeleton };
}

/** A part that a figure's colour does not reach when its box is coloured alone (a marker drawn black, filled). */
export const mark = (p) => ({ ...p, customData: { tmRole: 'mark' } });

/**
 * The boxes a colour reached, and what puts them right: a figure's box stays unseen. A colour picked for the whole
 * figure reached its ink too (Excalidraw colours every part of a group); one picked for its box alone goes on to its
 * ink (not to its marks: a black symbol stays black). → [{ id, patch }] (the ink's first, then the box's).
 */
export function boxRepairs(elements) {
  const out = [];
  for (const b of elements) {
    if (b.isDeleted || b.customData?.tmRole !== 'box') continue;
    const fill = b.backgroundColor !== BOX_FILL;
    const line = b.strokeColor !== NONE;
    if (!fill && !line) continue;
    const g = b.groupIds?.[0];
    for (const e of g ? elements : []) {
      if (e === b || e.isDeleted || !e.groupIds?.includes(g) || e.customData?.tmRole !== 'ink') continue;
      const patch = {};
      if (fill && e.type !== 'text' && e.backgroundColor !== NONE && e.backgroundColor !== b.backgroundColor) patch.backgroundColor = b.backgroundColor;
      if (line && e.strokeColor !== b.strokeColor) patch.strokeColor = b.strokeColor;
      if (Object.keys(patch).length) out.push({ id: e.id, patch });
    }
    out.push({ id: b.id, patch: { backgroundColor: BOX_FILL, strokeColor: NONE } });
  }
  return out;
}
