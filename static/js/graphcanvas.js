// The graph drawn on a canvas: the Graph view's (views/graph.js) and the small one in an item's Relations (panel.js).
// What it lays out is graphlayout.js's, how each edge looks graphstyle.js's; this file draws them and takes the pointer:
// drag the background to pan, the wheel (or a pinch) to zoom, drag a node to move it, hover one to light up what it is
// tied to (in the accent, the rest dimmed), click it to open it, double-click it to centre the graph on it. + / − / 0
// zoom from the keyboard. A finger has no hover: it taps a node to light it up, again to open it, and reaches further.
// How it looks (colours, arrows, names, sizes) is `look`; how it settles, `forces`.
import { createSimulation, fit, forceOptions, nearest, unclutter, zoomAt } from './graphlayout.js';
import { degrees } from './graphmodel.js';
import { edgeStyle, labelAlpha, nodeColor } from './graphstyle.js';
import { THEME_ATTRS } from './themeprefs.js';
import { isPhone } from './phone.js';
import { h, icon } from './ui.js';

const TONES = { strong: '--foreground', soft: '--graph-line', faint: '--graph-line-faint', alert: '--destructive' };
const HOVER_WIDTH = 0.7; // an edge of the hovered node is drawn at this share of its width (graphstyle.js)
/** The panel's local graph: its type colours and arrows, every name. The Graph view passes its own (LOOK_DEFAULTS). */
const PANEL_LOOK = { colorBy: 'type', groups: [], arrows: true, fade: 0, nodeSize: 1, linkWidth: 1 };
const CLICK_SLOP = 4; // px a press may move and still be a click
const TOUCH_SLOP = 10; // a finger's: it moves more
const TOUCH_REACH = 18; // px a finger may land off a node and still take it (a mouse: 4)

/** A node's radius in layout units: a little bigger the more it is tied to. */
const radiusOf = (deg) => 4 + Math.min(8, Math.sqrt(deg) * 1.6);

/**
 * graphCanvas(opts) → { el, setGraph(graph, { focus, refit }), highlight(ids | null), fit(), destroy() }
 *   onOpen(node)    — a click on a node;
 *   onFocus(node)   — a double click on one (the view centres on it);
 *   describe(node)  — { title, meta, lines: [text] }: what its tooltip says;
 *   compact         — the panel's: labels always on, the wheel zooms only with ⌘/Ctrl (a pinch), the page scrolls past;
 *   label           — the canvas's accessible name;
 *   look            — { colorBy: 'none' | 'type', groups: [{ color, match(node) }], arrows, fade (0–1: the zoom the names
 *                     come in at, graphstyle.js labelAlpha), nodeSize, linkWidth (multiples of 1) };
 *   forces          — { center, repel, link, distance }: multiples of the layout's defaults (graphlayout.js forceOptions).
 * → also setLook(look), setForces(forces) and animate() (lay it out again from nothing, moving into place).
 */
export function graphCanvas({ onOpen = () => {}, onFocus = () => {}, describe = (n) => ({ title: n.title, meta: n.ref, lines: [] }), compact = false, label = 'Graph', look = PANEL_LOOK, forces = {} } = {}) {
  let lk = { ...PANEL_LOOK, ...look };
  let fo = { ...forces };
  const canvas = h('canvas', { class: 'graph-canvas', tabindex: '0', role: 'img', 'aria-label': label });
  const tip = h('div', { class: 'graph-tip', role: 'tooltip', hidden: true });
  const btn = (ico, title, run) => h('button', { type: 'button', class: 'btn icon', title, 'aria-label': title, onclick: run }, icon(ico, 14));
  // Centre here: on a phone, shown while a finger's tap has lit a node (a finger has no hover to show it the way);
  // built only there, so a computer's controls stay as they were
  const centreBtn = isPhone() ? btn('locate', 'Centre here', () => centreOn(hover)) : null;
  const showCentre = (on) => { if (centreBtn) centreBtn.hidden = !on; };
  showCentre(false);
  const controls = h('div', { class: 'graph-controls' },
    btn('plus', 'Zoom in (+)', () => zoomBy(1.3)), btn('minus', 'Zoom out (−)', () => zoomBy(1 / 1.3)), btn('maximize', 'Fit to the view (0)', () => refit()), centreBtn);
  const el = h('div', { class: `graph-box ${compact ? 'compact' : ''}` }, canvas, controls, tip);
  const ctx = canvas.getContext('2d');

  let graph = { nodes: [], edges: [] };
  let nodes = [];
  let links = []; // [{ s, t, edge, style }] by node index
  let sim = null;
  let radius = [];
  let adj = []; // index → Set of the indexes it is tied to
  let focusI = -1;
  let hover = -1;
  let lit = null; // Set of indexes a search lit up (the rest dimmed), or null
  let view = { k: 1, tx: 0, ty: 0 };
  let moved = false; // panned or zoomed by hand: the view no longer follows the layout
  let size = { w: 0, h: 0, dpr: 1 };
  let raf = 0;
  let sig = '';
  let prevView = false; // drawn once: from then on a new graph keeps the view unless asked to fit it

  // ── data ──
  function setGraph(next, { focus = null, refit: again = true } = {}) {
    const nextSig = `${next.nodes.map((n) => `${n.id}:${n.done ? 1 : 0}`).join('|')}#${next.edges.map((e) => `${e.source}>${e.target}:${e.kind}:${e.relation || e.field || ''}`).join('|')}`;
    const same = nextSig === sig;
    graph = next;
    nodes = next.nodes;
    if (!same) {
      sig = nextSig;
      const prev = sim ? sim.positions() : null;
      sim = createSimulation(nodes, next.edges, { prev, weight: (e) => edgeStyle(e).pull ?? 1, ...forceOptions(fo) });
      const at = sim.index;
      links = next.edges.filter((e) => at.has(e.source) && at.has(e.target))
        .map((e) => ({ s: at.get(e.source), t: at.get(e.target), edge: e, style: edgeStyle(e) }));
      const deg = degrees(next);
      radius = nodes.map((n) => radiusOf(deg.get(n.id) || 0));
      adj = nodes.map(() => new Set());
      for (const l of links) { adj[l.s].add(l.t); adj[l.t].add(l.s); }
      hover = -1; showCentre(false);
      // A first picture at once: a small graph is laid out before it is drawn; a big one starts and moves into place.
      const budget = performance.now() + (nodes.length < 400 ? 60 : 25);
      while (!sim.settled() && performance.now() < budget) sim.tick();
    }
    focusI = focus != null && sim.index.has(focus) ? sim.index.get(focus) : -1;
    if (again || !prevView) { moved = false; fitView(); }
    prevView = true;
    kick();
  }

  function fitView() {
    if (!sim || !size.w) return;
    view = fit(sim.x, sim.y, size.w, size.h, { pad: compact ? 18 : 40, maxK: compact ? 1.4 : 2 });
  }
  const refit = () => { moved = false; fitView(); draw(); };
  function zoomBy(f, sx = size.w / 2, sy = size.h / 2) { view = zoomAt(view, f, sx, sy); moved = true; draw(); }
  /** The view moved so node `i` sits in the middle, at the same zoom; its card follows it there. */
  function centreOn(i) {
    if (i < 0 || !sim) return;
    view = { ...view, tx: size.w / 2 - sim.x[i] * view.k, ty: size.h / 2 - sim.y[i] * view.k };
    moved = true; draw();
    showTip(i, size.w / 2, size.h / 2);
  }

  // ── the loop: tick while the layout moves, draw each frame ──
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame() {
    raf = 0;
    if (sim && !sim.settled()) {
      for (let k = nodes.length < 600 ? 2 : 1; k > 0; k--) sim.tick();
      if (!moved) fitView();
      raf = requestAnimationFrame(frame);
    }
    draw();
  }

  // ── drawing ──
  function colours() {
    const cs = getComputedStyle(el);
    const v = (name) => cs.getPropertyValue(name).trim();
    const types = {};
    const base = v('--graph-node') || v('--muted-foreground');
    return {
      tone: (t) => v(TONES[t] || TONES.soft) || v('--muted-foreground'),
      type: (t) => (types[t] ??= v(`--t-${t}`) || v('--muted-foreground')),
      node: (n) => nodeColor(n, { colorBy: lk.colorBy, groups: lk.groups, typeColor: (t) => (types[t] ??= v(`--t-${t}`) || null), base }),
      accent: v('--graph-accent') || v('--foreground'),
      label: v('--graph-label') || v('--muted-foreground'),
      fg: v('--foreground'),
      muted: v('--muted-foreground'),
      bg: cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : v('--background'), // the labels' halo: the box's own tint
      font: cs.fontFamily,
    };
  }
  /** Which nodes are lit: the hovered one and what it is tied to, else what a search found; null: all of them. */
  function litSet() {
    if (hover >= 0) return new Set([hover, ...adj[hover]]);
    return lit;
  }
  function draw() {
    if (!size.w) return;
    const { k, tx, ty } = view;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    if (!sim || !nodes.length) return;
    const c = colours();
    const on = litSet();
    const X = (i) => sim.x[i] * k + tx;
    const Y = (i) => sim.y[i] * k + ty;
    ctx.lineCap = 'round';
    for (const l of links) {
      const st = { ...l.style, arrow: lk.arrows ? l.style.arrow : false };
      const dim = on && !(on.has(l.s) && on.has(l.t) && (hover < 0 || l.s === hover || l.t === hover));
      const mine = hover >= 0 && !dim; // an edge of the hovered node: in the accent, as Obsidian lights them
      ctx.globalAlpha = dim ? 0.06 : mine ? 1 : 0.85;
      ctx.strokeStyle = mine && st.tone !== 'alert' ? c.accent : c.tone(st.tone);
      // Lit by a hover they are opaque, so a little thinner: the same weight to the eye, not heavier.
      ctx.lineWidth = (st.width || 1) * lk.linkWidth * (mine ? HOVER_WIDTH : 1);
      ctx.setLineDash(st.dash || []);
      // Drawn from `a` to `b`: the head (if any) at `b`, the edge's target, or its source for arrow: 'back'.
      const [a, b] = st.arrow === 'back' ? [l.t, l.s] : [l.s, l.t];
      const x1 = X(a); const y1 = Y(a); let x2 = X(b); let y2 = Y(b);
      const dx = x2 - x1; const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const rb = drawnRadius(b, k) + (b === focusI || b === hover ? 5 : 0); // outside the ring the focus and hover wear
      if (st.arrow) { const back = rb + 2; x2 -= (dx / len) * back; y2 -= (dy / len) * back; }
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (st.arrow && len > rb + 8) {
        const ang = Math.atan2(dy, dx); const s = 5 + (st.width || 1) * 1.5;
        ctx.setLineDash([]);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath(); ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - s * Math.cos(ang - 0.45), y2 - s * Math.sin(ang - 0.45));
        ctx.lineTo(x2 - s * Math.cos(ang + 0.45), y2 - s * Math.sin(ang + 0.45));
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.setLineDash([]);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const r = drawnRadius(i, k);
      ctx.globalAlpha = on && !on.has(i) ? 0.18 : n.done ? 0.5 : 1;
      ctx.fillStyle = i === hover ? c.accent : c.node(n);
      ctx.beginPath(); ctx.arc(X(i), Y(i), r, 0, Math.PI * 2); ctx.fill();
      if (i === focusI) { // the centre wears a ring of the accent
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.strokeStyle = c.accent;
        ctx.beginPath(); ctx.arc(X(i), Y(i), r + 3, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // Names: under each node, on a halo of the page's colour so a line under it does not cross the text.
    ctx.font = `${compact ? 11 : 12}px ${c.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    // The names come in with the zoom (Display → Text fade threshold), as Obsidian's; the panel's small graph, and what a
    // hover or a search lights, keep theirs whole.
    const fadeIn = compact ? 1 : labelAlpha(k, lk.fade);
    const all = fadeIn > 0.02;
    // The candidates, the most wanted first (the hovered node, the focus, what is lit, then the most tied), and of
    // them only the names that cover no name already drawn: a dense cluster shows its hubs, a hover shows the rest.
    const wanted = [];
    for (let i = 0; i < nodes.length; i++) {
      if (all ? !on || on.has(i) : (on && on.has(i)) || i === focusI) wanted.push(i);
    }
    const rank = (i) => (i === hover ? 0 : i === focusI ? 1 : on && on.has(i) ? 2 : 3);
    wanted.sort((a, b) => rank(a) - rank(b) || radius[b] - radius[a] || a - b);
    const labels = wanted.map((i) => {
      const text = clip(nodes[i].title || nodes[i].ref || '', compact ? 22 : 30);
      const r = drawnRadius(i, k);
      const w = ctx.measureText(text).width;
      return { i, text, x: X(i) - w / 2, y: Y(i) + r + 3, w, h: compact ? 13 : 14 };
    });
    const kept = unclutter(labels);
    labels.forEach((l, n) => {
      if (!kept.has(n)) return;
      const { i, text } = l;
      const lit = (on && on.has(i)) || i === focusI;
      ctx.globalAlpha = on && !on.has(i) ? 0.25 * fadeIn : lit ? 1 : fadeIn;
      ctx.lineWidth = 3; ctx.strokeStyle = c.bg;
      ctx.strokeText(text, X(i), l.y);
      ctx.fillStyle = i === hover || i === focusI ? c.fg : c.label;
      ctx.fillText(text, X(i), l.y);
    });
    ctx.globalAlpha = 1;
  }
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  /** A node's radius on screen at zoom k: it grows with the zoom up to its own size, never under 2px. */
  const drawnRadius = (i, k) => Math.max(2, radius[i] * lk.nodeSize * Math.min(1, Math.sqrt(k)));

  // ── size ──
  const ro = new ResizeObserver(() => {
    const b = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (!b.width || !b.height) return;
    size = { w: b.width, h: b.height, dpr };
    canvas.width = Math.round(b.width * dpr);
    canvas.height = Math.round(b.height * dpr);
    if (!moved) fitView();
    draw();
  });
  ro.observe(el);
  // The theme changed (Settings → Themes, the sidebar's switch, or the system's, which theme.js turns into data-theme):
  // its colours again.
  const themeObs = new MutationObserver(() => draw());
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: THEME_ATTRS });

  // ── the pointer ──
  const pointers = new Map(); // id → { x, y }, for a pinch
  let press = null; // { i (node, or -1: the background), sx, sy, tx, ty, moved }
  let pinch = null; // { d (the fingers' distance at the start), view (the view then), cx, cy (their middle) }
  const local = (e) => { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  const world = (sx, sy) => [(sx - view.tx) / view.k, (sy - view.ty) / view.k];
  const hitAt = (sx, sy, touch = false) => {
    if (!sim) return -1;
    const [wx, wy] = world(sx, sy);
    const reach = touch ? TOUCH_REACH : 4;
    return nearest(sim, wx, wy, (i) => (radius[i] * lk.nodeSize * Math.min(1, Math.sqrt(view.k)) + reach) / view.k);
  };
  const isTouch = (e) => e.pointerType === 'touch' || e.pointerType === 'pen';

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    canvas.setPointerCapture(e.pointerId);
    const [sx, sy] = local(e);
    pointers.set(e.pointerId, { x: sx, y: sy });
    if (pointers.size === 2) { // two fingers: a pinch, whatever the first one was doing
      const [a, b] = [...pointers.values()];
      if (press?.i >= 0) sim.release(press.i);
      press = null;
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, view: { ...view }, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    const touch = isTouch(e);
    const i = hitAt(sx, sy, touch);
    press = { i, sx, sy, tx: view.tx, ty: view.ty, moved: false, touch };
    if (i >= 0) { const [wx, wy] = world(sx, sy); sim.fix(i, wx, wy); }
    hideTip();
  });
  canvas.addEventListener('pointermove', (e) => {
    const [sx, sy] = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: sx, y: sy });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      view = zoomAt(pinch.view, d / pinch.d, pinch.cx, pinch.cy);
      moved = true; draw();
      return;
    }
    if (press) {
      if (Math.hypot(sx - press.sx, sy - press.sy) > (press.touch ? TOUCH_SLOP : CLICK_SLOP)) press.moved = true;
      if (!press.moved) return;
      if (press.i >= 0) { // a node dragged: it follows, the rest makes room
        const [wx, wy] = world(sx, sy);
        sim.fix(press.i, wx, wy);
        sim.alphaTarget = 0.3; sim.reheat(0.3); kick();
      } else { // the background: pan
        view = { ...view, tx: press.tx + sx - press.sx, ty: press.ty + sy - press.sy };
        moved = true; draw();
      }
      return;
    }
    if (isTouch(e)) return; // a finger lights a node by tapping it (end)
    const i = hitAt(sx, sy);
    if (i !== hover) { hover = i; canvas.style.cursor = i >= 0 ? 'pointer' : ''; draw(); }
    if (i >= 0) showTip(i, sx, sy); else hideTip();
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (!press) return;
    const { i, moved: dragged, touch, sx, sy } = press;
    press = null;
    if (i >= 0) { sim.release(i); sim.alphaTarget = 0; }
    if (dragged || e.type !== 'pointerup') return;
    // A finger has no hover: its first tap on a node lights it and what it is tied to (and shows its card), a second
    // tap on it opens it; a tap on the background puts the lights out.
    if (touch && i !== hover) { hover = i; showCentre(i >= 0); draw(); if (i >= 0) showTip(i, sx, sy); else hideTip(); return; }
    if (i >= 0) onOpen(nodes[i]);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', (e) => { if (isTouch(e)) return; if (!press && hover >= 0) { hover = -1; canvas.style.cursor = ''; draw(); } hideTip(); });
  canvas.addEventListener('dblclick', (e) => {
    const i = hitAt(...local(e));
    if (i >= 0) onFocus(nodes[i]);
  });
  canvas.addEventListener('wheel', (e) => {
    if (compact && !e.ctrlKey && !e.metaKey) return; // in the panel, the wheel scrolls it; a pinch zooms
    e.preventDefault();
    const [sx, sy] = local(e);
    view = zoomAt(view, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), sx, sy);
    moved = true; draw();
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.3); }
    else if (e.key === '-') { e.preventDefault(); zoomBy(1 / 1.3); }
    else if (e.key === '0') { e.preventDefault(); refit(); }
  });

  function showTip(i, sx, sy) {
    const d = describe(nodes[i], graph);
    tip.replaceChildren(h('strong', {}, d.title), d.meta ? h('span', { class: 'muted' }, d.meta) : null,
      ...(d.lines || []).map((l) => h('span', { class: 'graph-tip-line' }, l)));
    tip.hidden = false;
    // Beside the pointer, kept inside the box.
    const w = tip.offsetWidth; const hgt = tip.offsetHeight;
    tip.style.left = `${Math.min(Math.max(4, sx + 14), size.w - w - 4)}px`;
    tip.style.top = `${sy + 14 + hgt > size.h ? Math.max(4, sy - hgt - 10) : sy + 14}px`;
  }
  function hideTip() { tip.hidden = true; }

  return {
    el,
    setGraph,
    /** Dim every node but these (a search's matches); null lights them all again. */
    highlight(ids) {
      lit = ids && sim ? new Set([...ids].map((id) => sim.index.get(id)).filter((i) => i !== undefined)) : null;
      draw();
    },
    fit: refit,
    /** Redraw with another look (Display, Groups). */
    setLook(next) { lk = { ...lk, ...next }; draw(); },
    /** Other forces: the layout moves to them from where it is. */
    setForces(next) {
      fo = { ...fo, ...next };
      if (!sim) return;
      sim.set(forceOptions(fo)); sim.reheat(0.5); moved = false; kick();
    },
    /** Lay it out again from nothing, and watch it move into place (Display → Animate). */
    animate() {
      if (!nodes.length) return;
      sim = createSimulation(nodes, graph.edges, { weight: (e) => edgeStyle(e).pull ?? 1, ...forceOptions(fo) });
      moved = false; fitView(); kick();
    },
    destroy() {
      cancelAnimationFrame(raf); raf = 0;
      ro.disconnect(); themeObs.disconnect();
    },
  };
}
