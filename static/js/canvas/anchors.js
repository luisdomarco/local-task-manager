// Where an arrow meets a shape: the middle of one of its four sides, never anywhere along it (as Miro's and draw.io's
// connectors). Excalidraw binds an arrow wherever it is dropped; once the pointer is up, each bound end goes to the
// middle of the side nearest to where it was. An elbow arrow keeps that point as its `fixedPoint`, so Excalidraw routes
// it from there whenever a shape moves; a straight or curved one is put back there after each move. Pure: elements in,
// the changes out (tests/js/anchors.test.mjs).

const GAP = 4; // between the arrow's end and the side, as Excalidraw leaves it
const STUB = 24; // how far an elbow goes straight out of a side before it turns
const SIDES = {
  top: { at: [0.5, 0], out: [0, -1] },
  bottom: { at: [0.5, 1], out: [0, 1] },
  left: { at: [0, 0.5], out: [-1, 0] },
  right: { at: [1, 0.5], out: [1, 0] },
};

/** The point at a side's middle of `el` ({ x, y, width, height }), `gap` out from it. */
export function anchor(el, side, gap = GAP) {
  const { at, out } = SIDES[side];
  return [el.x + el.width * at[0] + out[0] * gap, el.y + el.height * at[1] + out[1] * gap];
}

/** The side of `el` whose middle is nearest to point `p`. */
export function nearestSide(el, p) {
  let best = null;
  for (const side of Object.keys(SIDES)) {
    const [ax, ay] = anchor(el, side, 0);
    const d = (ax - p[0]) ** 2 + (ay - p[1]) ** 2;
    if (!best || d < best.d) best = { side, d };
  }
  return best.side;
}

/** A right-angled path from `s` leaving by `sSide` to `e` arriving by `eSide` (either may be null: an end not bound). */
export function elbowRoute(s, sSide, e, eSide) {
  const go = (p, side) => (side ? [p[0] + SIDES[side].out[0] * STUB, p[1] + SIDES[side].out[1] * STUB] : p);
  const s1 = go(s, sSide);
  const e1 = go(e, eSide);
  const across = (side) => side === 'left' || side === 'right';
  // Leave sideways: along the row, then the column; leave up or down: the column first.
  const corner = across(sSide) || (!sSide && !across(eSide)) ? [e1[0], s1[1]] : [s1[0], e1[1]];
  const pts = [s, s1, corner, e1, e];
  // Without repeated points or points in the middle of a straight run.
  const out = [];
  for (const p of pts) {
    if (out.length && Math.abs(out[out.length - 1][0] - p[0]) < 0.5 && Math.abs(out[out.length - 1][1] - p[1]) < 0.5) continue;
    if (out.length >= 2) {
      const [a, b] = [out[out.length - 2], out[out.length - 1]];
      if ((Math.abs(a[0] - b[0]) < 0.5 && Math.abs(b[0] - p[0]) < 0.5) || (Math.abs(a[1] - b[1]) < 0.5 && Math.abs(b[1] - p[1]) < 0.5)) out.pop();
    }
    out.push(p);
  }
  return out;
}

/** What an arrow can be anchored to: a shape, a free text, a card's frame (never a card's parts, nor a line). */
export const connectable = (e) => !!e && !e.isDeleted && !e.angle && !e.customData?.tmOf && !e.containerId
  && ['rectangle', 'diamond', 'ellipse', 'image', 'text'].includes(e.type);

/** The shape under scene point `p` (the topmost; `pad` around its box counts, so its dots stay reachable), or null. */
export function targetAt(elements, p, pad = 0, except = null) {
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const e = elements[i];
    if (!connectable(e) || e.id === except) continue;
    if (p[0] >= e.x - pad && p[0] <= e.x + e.width + pad && p[1] >= e.y - pad && p[1] <= e.y + e.height + pad) return e;
  }
  return null;
}

/** The four points an arrow may leave or meet `el` at: { top: [x, y], right, bottom, left }, on its sides. */
export const anchorPoints = (el) => Object.fromEntries(Object.keys(SIDES).map((s) => [s, anchor(el, s, 0)]));

/** The binding of an arrow's end to `el` by `side` (an elbow keeps the side as its fixedPoint). */
export const bindingTo = (el, side) => ({ elementId: el.id, focus: 0, gap: GAP, fixedPoint: SIDES[side].at });

const same = (a, b) => Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5;

/**
 * The arrows whose bound ends are not at a side's middle, and what puts them there: [{ id, patch }] (x, y, points,
 * width, height, and an elbow's bindings with their fixedPoint). A rotated shape is left as Excalidraw binds it.
 */
export function snapArrows(elements) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const out = [];
  for (const a of elements) {
    if (a.type !== 'arrow' || a.isDeleted || !a.points?.length || (!a.startBinding && !a.endBinding)) continue;
    const abs = a.points.map(([px, py]) => [a.x + px, a.y + py]);
    const end = (binding, p) => {
      const el = binding && byId.get(binding.elementId);
      if (!el || el.isDeleted || el.angle) return null;
      // An elbow says where it is bound (fixedPoint, in the shape's width and height); another arrow, by its end.
      const at = a.elbowed && binding.fixedPoint ? [el.x + el.width * binding.fixedPoint[0], el.y + el.height * binding.fixedPoint[1]] : p;
      const side = nearestSide(el, at);
      return { side, p: anchor(el, side), fixedPoint: SIDES[side].at, binding };
    };
    const s = end(a.startBinding, abs[0]);
    const e = end(a.endBinding, abs[abs.length - 1]);
    if (!s && !e) continue;
    const from = s ? s.p : abs[0];
    const to = e ? e.p : abs[abs.length - 1];
    // At a side's middle already: an elbow by its fixedPoint (Excalidraw routes it, its own gap), another by its end.
    const placed = (x, p) => !x || (a.elbowed
      ? !!x.binding.fixedPoint && Math.abs(x.binding.fixedPoint[0] - x.fixedPoint[0]) < 0.06 && Math.abs(x.binding.fixedPoint[1] - x.fixedPoint[1]) < 0.06
      : Math.hypot(x.p[0] - p[0], x.p[1] - p[1]) < 6);
    // And an elbow leaves its start's side outwards and comes into its end's side: one whose end was moved to another
    // side keeps the segments you dragged (fixedSegments), and may come into it through the shape.
    const heads = (x, from, to, sign) => !x || !a.elbowed
      || ((to[0] - from[0]) * SIDES[x.side].out[0] + (to[1] - from[1]) * SIDES[x.side].out[1]) * sign > 0;
    const n = abs.length;
    const straight = n < 2 || (heads(s, abs[0], abs[1], 1) && heads(e, abs[n - 2], abs[n - 1], -1));
    if (placed(s, abs[0]) && placed(e, abs[n - 1]) && straight) continue;
    const pts = a.elbowed ? elbowRoute(from, s?.side || null, to, e?.side || null) : [from, ...abs.slice(1, -1), to];
    const [x0, y0] = pts[0];
    const rel = pts.map(([px, py]) => [px - x0, py - y0]);
    const xs = rel.map((p) => p[0]);
    const ys = rel.map((p) => p[1]);
    const patch = { x: x0, y: y0, points: rel, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    if (a.elbowed) {
      if (s) patch.startBinding = { ...s.binding, fixedPoint: s.fixedPoint };
      if (e) patch.endBinding = { ...e.binding, fixedPoint: e.fixedPoint };
      patch.fixedSegments = null;
    }
    out.push({ id: a.id, patch });
  }
  return out;
}
