// Where an arrow meets a shape: the middle of one of its four sides, never anywhere along it (as Miro's and draw.io's
// connectors). Excalidraw binds an arrow wherever it is dropped; once the pointer is up, each bound end goes to the
// middle of the side nearest to where it was. An elbow arrow keeps that point as its `fixedPoint`, so Excalidraw routes
// it from there whenever a shape moves; a straight or curved one is put back there after each move. An arrow whose type
// was just changed is drawn as that type says: an elbow at right angles, a curve with a bend (Excalidraw leaves the
// first diagonal and the second straight), and a curve turned back to Sharp straight again. Pure: elements in, the
// changes out (tests/js/anchors.test.mjs).

const GAP = 4; // between the arrow's end and the side, as Excalidraw leaves it
const STUB = 24; // how far an elbow goes straight out of a side before it turns
const BEND = 120; // the most a curve's handle goes out of a side
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

/** What an arrow can be anchored to: a shape, a free text, a card's frame, a figure's box (never a card's parts, nor a
 *  figure's ink or marks — its box is over them —, nor a line). */
export const connectable = (e) => !!e && !e.isDeleted && !e.angle && !e.customData?.tmOf && !e.containerId
  && !['ink', 'mark'].includes(e.customData?.tmRole) && ['rectangle', 'diamond', 'ellipse', 'image', 'text'].includes(e.type);

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
const sameAll = (a, b) => a.length === b.length && a.every((p, i) => same(p, b[i]));
const from0 = (pts, o) => pts.map(([x, y]) => [x - o[0], y - o[1]]);

/**
 * A curved arrow's points from `s` leaving by `sSide` to `e` arriving by `eSide` (either may be null: an end not bound):
 * three points of the cubic curve that leaves and meets each bound side square (its handles half the way out, at most
 * BEND), so the curve Excalidraw draws through them follows it without overshooting; bound to nothing, a bow through
 * a point a sixth of its length off the middle.
 */
export function curveRoute(s, sSide, e, eSide) {
  const d = Math.hypot(e[0] - s[0], e[1] - s[1]);
  if (d < 1) return [s, e];
  const r = (v) => Math.round(v * 10) / 10;
  if (!sSide && !eSide) return [s, [r((s[0] + e[0]) / 2 + (e[1] - s[1]) / 6), r((s[1] + e[1]) / 2 - (e[0] - s[0]) / 6)], e];
  const k = Math.min(BEND, d / 2);
  const go = (p, side) => (side ? [p[0] + SIDES[side].out[0] * k, p[1] + SIDES[side].out[1] * k] : p);
  const c1 = go(s, sSide);
  const c2 = go(e, eSide);
  const at = (t) => {
    const u = 1 - t;
    const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return [0, 1].map((i) => r(w[0] * s[i] + w[1] * c1[i] + w[2] * c2[i] + w[3] * e[i]));
  };
  return [s, at(0.2), at(0.5), at(0.8), e];
}

/**
 * The arrows not drawn as they should be, and what puts them right: [{ id, patch }] (x, y, points, width, height; an
 * elbow's bindings with their fixedPoint; a curve's `customData.tmBend`). A bound end goes to the middle of its side
 * (a rotated shape is left as Excalidraw binds it); an elbow with a diagonal leg is routed; a curve with only its two
 * ends gets a bend, kept as `tmBend` so it follows its ends while it is the app's, and is undone by Sharp. A bend you
 * have dragged is yours: it is left as it is.
 */
export function snapArrows(elements) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const out = [];
  for (const a of elements) {
    if (a.type !== 'arrow' || a.isDeleted || !a.points?.length) continue;
    const abs = a.points.map(([px, py]) => [a.x + px, a.y + py]);
    const n = abs.length;
    const end = (binding, p) => {
      const el = binding && byId.get(binding.elementId);
      if (!el || el.isDeleted || el.angle) return null;
      // An elbow says where it is bound (fixedPoint, in the shape's width and height); another arrow, by its end.
      const at = a.elbowed && binding.fixedPoint ? [el.x + el.width * binding.fixedPoint[0], el.y + el.height * binding.fixedPoint[1]] : p;
      const side = nearestSide(el, at);
      return { side, p: anchor(el, side), fixedPoint: SIDES[side].at, binding };
    };
    const s = end(a.startBinding, abs[0]);
    const e = end(a.endBinding, abs[n - 1]);
    // At a side's middle already: an elbow by its fixedPoint (Excalidraw routes it, its own gap), another by its end.
    const placed = (x, p) => !x || (a.elbowed
      ? !!x.binding.fixedPoint && Math.abs(x.binding.fixedPoint[0] - x.fixedPoint[0]) < 0.06 && Math.abs(x.binding.fixedPoint[1] - x.fixedPoint[1]) < 0.06
      : Math.hypot(x.p[0] - p[0], x.p[1] - p[1]) < 6);
    let patch;
    if (a.elbowed) {
      // An elbow leaves its start's side outwards and comes into its end's side: one whose end was moved to another
      // side keeps the segments you dragged (fixedSegments), and may come into it through the shape.
      const heads = (x, p, q, sign) => !x || ((q[0] - p[0]) * SIDES[x.side].out[0] + (q[1] - p[1]) * SIDES[x.side].out[1]) * sign > 0;
      const straight = n < 2 || (heads(s, abs[0], abs[1], 1) && heads(e, abs[n - 2], abs[n - 1], -1));
      // And it has no leg on a slant: an arrow just turned into an elbow is its two ends, from one to the other.
      const square = abs.every((p, i) => i === 0 || Math.abs(p[0] - abs[i - 1][0]) < 0.5 || Math.abs(p[1] - abs[i - 1][1]) < 0.5);
      if (placed(s, abs[0]) && placed(e, abs[n - 1]) && straight && square) continue;
      patch = shape(elbowRoute(s ? s.p : abs[0], s?.side || null, e ? e.p : abs[n - 1], e?.side || null));
      if (s) patch.startBinding = { ...s.binding, fixedPoint: s.fixedPoint };
      if (e) patch.endBinding = { ...e.binding, fixedPoint: e.fixedPoint };
      patch.fixedSegments = null;
    } else {
      const from = placed(s, abs[0]) ? abs[0] : s.p;
      const to = placed(e, abs[n - 1]) ? abs[n - 1] : e.p;
      const inner = abs.slice(1, -1);
      // The bend is still the app's while its points are where they were put, or moved with the whole arrow.
      const mark = a.customData?.tmBend;
      const ours = !!mark && (sameAll(inner, mark.pts) || sameAll(from0(inner, abs[0]), from0(mark.pts, mark.at)));
      let pts = [from, ...inner, to];
      let bend = null;
      if (a.roundness && (n === 2 || ours)) {
        pts = curveRoute(from, s?.side || null, to, e?.side || null);
        bend = { at: pts[0], pts: pts.slice(1, -1) };
      } else if (ours) pts = [from, to]; // Sharp again: the straight line it was
      const kept = mark ? !!bend && same(bend.at, mark.at) && sameAll(bend.pts, mark.pts) : !bend;
      if (sameAll(pts, abs) && kept) continue;
      patch = shape(pts);
      if (!kept) {
        const { tmBend, ...rest } = a.customData || {};
        patch.customData = bend ? { ...rest, tmBend: bend } : rest;
      }
    }
    out.push({ id: a.id, patch });
  }
  return out;
}

/** An arrow's x, y, points (from its first) and size, for absolute points `pts`. */
function shape(pts) {
  const [x0, y0] = pts[0];
  const rel = from0(pts, pts[0]).map((p) => p.map((v) => Math.round(v * 100) / 100)); // no 64.89999999999998
  const xs = rel.map((p) => p[0]);
  const ys = rel.map((p) => p[1]);
  return { x: x0, y: y0, points: rel, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
