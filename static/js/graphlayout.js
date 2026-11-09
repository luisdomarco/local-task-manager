// A force layout for the graph view (views/graph.js, graphcanvas.js), pure: no DOM, no clock, no Math.random. The
// same graph gives the same picture, and a graph that changes (a filter, an edit from Obsidian) keeps where its
// nodes were (`prev`): only the new ones find a place.
//
// The forces, as d3-force's defaults (velocity Verlet with a cooling `alpha`):
// - links pull their two ends to `distance` apart, the weaker the more links an end has;
// - every node pushes every other away (`charge`), the far ones by their quadtree cell's centroid (Barnes–Hut, `theta`):
//   O(n log n) a tick, so two thousand nodes stay smooth;
// - a soft pull to the origin (`gravity`) keeps the islands (a doc no one links, a project of its own) in view.

const PHI = Math.PI * (3 - Math.sqrt(5)); // the golden angle: a spiral that never lines points up

/** A seeded PRNG (mulberry32): the only chance in the layout, to part two nodes that sit on one point. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where the i-th new node starts: on a phyllotaxis spiral around `cx, cy`. */
const spiral = (i, cx = 0, cy = 0, step = 10) => {
  const r = step * Math.sqrt(0.5 + i);
  return [cx + r * Math.cos(i * PHI), cy + r * Math.sin(i * PHI)];
};

export const DEFAULTS = {
  distance: 60, // what a link pulls its ends to (room for a name between two nodes)
  charge: -240, // how hard each node pushes the others (negative: apart)
  theta: 0.9, // Barnes–Hut: a cell this small for its distance counts as one body
  gravity: 0.07, // the pull to the origin
  linkStrength: 1, // how hard every link pulls, times its own strength
  velocityDecay: 0.4, // friction
  alphaMin: 0.001, // below it the layout has settled
  alphaDecay: 1 - Math.pow(0.001, 1 / 300), // ~300 ticks from 1 to alphaMin
  seed: 1,
};

/**
 * createSimulation(nodes, edges, opts) → a simulation of `nodes` ([{ id }]) linked by `edges` ([{ source, target }],
 * by node id; an edge to a node not there is left out). opts: DEFAULTS, plus
 *   prev:   Map id → { x, y } — where nodes were (a node new to it starts by one of its neighbours that was);
 *   weight: (edge) → a number ≥ 0, how hard that edge pulls (1 by default; 0 draws it but leaves the layout alone).
 * → { ids, x, y (Float64Arrays, by node index), index (Map id → i), links, alpha, tick(), run(max), settled(),
 *     reheat(alpha), fix(i, x, y), release(i), positions() (Map id → { x, y }) }
 */
export function createSimulation(nodes, edges, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const n = nodes.length;
  const ids = nodes.map((nd) => nd.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const fx = new Float64Array(n).fill(NaN); // a node held where it is dragged
  const fy = new Float64Array(n).fill(NaN);
  const random = prng(o.seed);
  const jiggle = () => (random() - 0.5) * 1e-6;

  const links = [];
  for (const e of edges) {
    const s = index.get(e.source);
    const t = index.get(e.target);
    if (s === undefined || t === undefined || s === t) continue;
    const w = o.weight ? o.weight(e) : 1;
    if (w > 0) links.push({ s, t, w });
  }
  const degree = new Float64Array(n);
  for (const l of links) { degree[l.s] += 1; degree[l.t] += 1; }
  for (const l of links) {
    l.strength = l.w / Math.min(degree[l.s], degree[l.t]); // d3's: a hub's links give way, a leaf's hold
    l.bias = degree[l.s] / (degree[l.s] + degree[l.t]);
  }

  // Where each starts: where it was; else by a neighbour that was; else on the spiral.
  const prev = o.prev || new Map();
  const placed = new Uint8Array(n);
  ids.forEach((id, i) => {
    const p = prev.get(id);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { x[i] = p.x; y[i] = p.y; placed[i] = 1; }
  });
  const anyPlaced = placed.some(Boolean);
  let fresh = 0;
  for (let i = 0; i < n; i++) {
    if (placed[i]) continue;
    const near = links.find((l) => (l.s === i && placed[l.t]) || (l.t === i && placed[l.s]));
    if (near) {
      const j = near.s === i ? near.t : near.s;
      const [px, py] = spiral(fresh++ % 8 + 1, x[j], y[j], o.distance / 3);
      x[i] = px; y[i] = py;
    } else {
      // With others already placed, the newcomers start outside them, not on top of the picture.
      const [px, py] = spiral(fresh++ + (anyPlaced ? n : 0));
      x[i] = px; y[i] = py;
    }
  }

  const sim = {
    ids, index, x, y, links, degree,
    // As warm as what is new: a filter that brings back a few nodes nudges the picture, it does not shake it all.
    alpha: anyPlaced ? Math.min(1, 0.3 + fresh / Math.max(n, 1)) : 1,
    alphaTarget: 0,
  };

  // ── Barnes–Hut: a quadtree of the nodes, each cell with its count and centroid ──
  const MAX_DEPTH = 24; // past it, points (all but on one spot) share a leaf
  const newCell = (x0, y0, size, depth) => ({ x0, y0, size, depth, count: 0, cx: 0, cy: 0, kids: null, pts: null });
  function insert(cell, i) {
    cell.cx += x[i]; cell.cy += y[i]; cell.count += 1;
    if (!cell.kids) {
      if (!cell.pts) { cell.pts = [i]; return; }
      if (cell.depth >= MAX_DEPTH) { cell.pts.push(i); return; }
      const was = cell.pts;
      cell.pts = null;
      const half = cell.size / 2;
      cell.kids = [0, 1, 2, 3].map((q) => newCell(cell.x0 + (q & 1) * half, cell.y0 + (q >> 1) * half, half, cell.depth + 1));
      for (const j of was) insert(cell.kids[quad(cell, j)], j);
    }
    insert(cell.kids[quad(cell, i)], i);
  }
  const quad = (cell, i) => {
    const half = cell.size / 2;
    return (x[i] >= cell.x0 + half ? 1 : 0) + (y[i] >= cell.y0 + half ? 2 : 0);
  };
  function tree() {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      if (x[i] < x0) x0 = x[i]; if (x[i] > x1) x1 = x[i];
      if (y[i] < y0) y0 = y[i]; if (y[i] > y1) y1 = y[i];
    }
    const size = Math.max(x1 - x0, y1 - y0, 1) * 1.0001;
    const root = newCell(x0, y0, size, 0);
    for (let i = 0; i < n; i++) insert(root, i); // its sums added in every cell it goes through
    (function centroids(c) {
      if (!c.count) return;
      c.cx /= c.count; c.cy /= c.count;
      if (c.kids) c.kids.forEach(centroids);
    }(root));
    return root;
  }
  const theta2 = o.theta * o.theta;
  function charge(i, cell, alpha) {
    if (!cell.count) return;
    let dx = cell.cx - x[i];
    let dy = cell.cy - y[i];
    let l2 = dx * dx + dy * dy;
    if (cell.kids && (cell.size * cell.size) / theta2 < l2) { // far enough: the whole cell as one body
      const w = (o.charge * cell.count * alpha) / l2;
      vx[i] += dx * w; vy[i] += dy * w;
      return;
    }
    if (cell.kids) { for (const k of cell.kids) charge(i, k, alpha); return; }
    for (const j of cell.pts) {
      if (j === i) continue;
      dx = x[j] - x[i]; dy = y[j] - y[i];
      if (!dx) dx = jiggle();
      if (!dy) dy = jiggle();
      l2 = Math.max(dx * dx + dy * dy, 1);
      const w = (o.charge * alpha) / l2;
      vx[i] += dx * w; vy[i] += dy * w;
    }
  }

  sim.tick = () => {
    const alpha = sim.alpha;
    for (const l of links) { // the links' springs
      let dx = x[l.t] + vx[l.t] - x[l.s] - vx[l.s] || jiggle();
      let dy = y[l.t] + vy[l.t] - y[l.s] - vy[l.s] || jiggle();
      const len = Math.sqrt(dx * dx + dy * dy);
      const k = ((len - o.distance) / len) * alpha * l.strength * o.linkStrength;
      dx *= k; dy *= k;
      vx[l.t] -= dx * l.bias; vy[l.t] -= dy * l.bias;
      vx[l.s] += dx * (1 - l.bias); vy[l.s] += dy * (1 - l.bias);
    }
    if (n > 1) {
      const root = tree();
      for (let i = 0; i < n; i++) charge(i, root, alpha);
    }
    for (let i = 0; i < n; i++) {
      vx[i] -= x[i] * o.gravity * alpha;
      vy[i] -= y[i] * o.gravity * alpha;
      if (Number.isNaN(fx[i])) { vx[i] *= 1 - o.velocityDecay; x[i] += vx[i]; } else { x[i] = fx[i]; vx[i] = 0; }
      if (Number.isNaN(fy[i])) { vy[i] *= 1 - o.velocityDecay; y[i] += vy[i]; } else { y[i] = fy[i]; vy[i] = 0; }
    }
    sim.alpha += (sim.alphaTarget - sim.alpha) * o.alphaDecay;
    return sim.alpha;
  };
  sim.settled = () => sim.alpha < o.alphaMin && sim.alphaTarget < o.alphaMin;
  /** Up to `max` ticks, until it settles. → the ticks run. */
  sim.run = (max = 300) => {
    let k = 0;
    while (k < max && !sim.settled()) { sim.tick(); k += 1; }
    return k;
  };
  /** Wake it (a node dragged, nodes added): `alpha` at least `to`. */
  sim.reheat = (to = 0.3) => { sim.alpha = Math.max(sim.alpha, to); };
  /** Hold node i at (px, py) (dragging it), or let it go. */
  sim.fix = (i, px, py) => { fx[i] = px; fy[i] = py; x[i] = px; y[i] = py; };
  sim.release = (i) => { fx[i] = NaN; fy[i] = NaN; };
  sim.positions = () => new Map(ids.map((id, i) => [id, { x: x[i], y: y[i] }]));
  /** Change its forces as it runs (distance, charge, gravity, linkStrength): the Graph's Forces sliders. */
  sim.set = (changes) => { Object.assign(o, changes); };
  return sim;
}

/** The forces the Graph's sliders ask for — each a multiple of the default, 1 for the default — as createSimulation's
 *  options: Center (gravity), Repel (charge), Link (linkStrength) and Distance. */
export const FORCE_DEFAULTS = Object.freeze({ center: 1, repel: 1, link: 1, distance: 1 });
export function forceOptions(f = {}) {
  const v = (k) => (Number.isFinite(f[k]) && f[k] >= 0 ? f[k] : FORCE_DEFAULTS[k]);
  return {
    gravity: DEFAULTS.gravity * v('center'),
    charge: DEFAULTS.charge * v('repel'),
    linkStrength: v('link'),
    distance: DEFAULTS.distance * Math.max(0.1, v('distance')),
  };
}

/**
 * The view that shows every point of `xs, ys` in a `width × height` box with `pad` around: → { k, tx, ty }, a screen
 * point being (x · k + tx, y · k + ty). The scale stays within [minK, maxK]: one node is not blown up to the box.
 */
export function fit(xs, ys, width, height, { pad = 32, minK = 0.05, maxK = 2 } = {}) {
  if (!xs.length) return { k: 1, tx: width / 2, ty: height / 2 };
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] < x0) x0 = xs[i]; if (xs[i] > x1) x1 = xs[i];
    if (ys[i] < y0) y0 = ys[i]; if (ys[i] > y1) y1 = ys[i];
  }
  const w = Math.max(x1 - x0, 1);
  const h = Math.max(y1 - y0, 1);
  const k = Math.min(maxK, Math.max(minK, Math.min((width - 2 * pad) / w, (height - 2 * pad) / h)));
  return { k, tx: width / 2 - ((x0 + x1) / 2) * k, ty: height / 2 - ((y0 + y1) / 2) * k };
}

/** The zoom `view` scaled by `factor` around the screen point (sx, sy), kept within [minK, maxK]. */
export function zoomAt(view, factor, sx, sy, { minK = 0.05, maxK = 6 } = {}) {
  const k = Math.min(maxK, Math.max(minK, view.k * factor));
  const f = k / view.k;
  return { k, tx: sx - (sx - view.tx) * f, ty: sy - (sy - view.ty) * f };
}

/** The node nearest the layout point (px, py) within `radius(i)` of it (its drawn size, plus some slack), or -1. */
export function nearest(sim, px, py, radius) {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < sim.ids.length; i++) {
    const dx = sim.x[i] - px;
    const dy = sim.y[i] - py;
    const d = dx * dx + dy * dy;
    const r = radius(i);
    if (d <= r * r && d < bestD) { best = i; bestD = d; }
  }
  return best;
}

/**
 * Which labels to draw so that none covers another: `boxes` ([{ x, y, w, h }], screen rects, the most wanted first —
 * the hovered node's, the focus's, then the most tied ones) → a Set of the indexes kept, each over no box kept before
 * it. A grid of `cell`-px buckets keeps it near linear for hundreds of labels.
 */
export function unclutter(boxes, { cell = 64, gap = 2 } = {}) {
  const kept = new Set();
  const grid = new Map();
  const cells = (b) => {
    const out = [];
    for (let cx = Math.floor(b.x / cell); cx <= Math.floor((b.x + b.w) / cell); cx++) {
      for (let cy = Math.floor(b.y / cell); cy <= Math.floor((b.y + b.h) / cell); cy++) out.push(`${cx},${cy}`);
    }
    return out;
  };
  const hits = (a, b) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
  boxes.forEach((b, i) => {
    const keys = cells(b);
    if (keys.some((key) => (grid.get(key) || []).some((j) => hits(b, boxes[j])))) return;
    kept.add(i);
    for (const key of keys) { if (!grid.has(key)) grid.set(key, []); grid.get(key).push(i); }
  });
  return kept;
}
