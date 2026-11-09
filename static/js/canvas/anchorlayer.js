// The dots an arrow leaves or meets a shape by: one at the middle of each side (anchors.js), drawn over the whiteboard
// as draw.io and Miro do. Hover a shape (or select it) and its four dots show; drag from one and an arrow follows the
// pointer, its end on the dot of the shape under it (green); let go and the arrow is there, bound at both ends. While
// you draw with Excalidraw's own arrow tool, the shape under the pointer shows its dots too, the one it will meet green
// (the end is put there when the pointer is up: whiteboard.js snap()). An arrow selected keeps its own handles: the dots
// only show where its end may go, and a click on a dot an arrow already meets selects that arrow, to move its end to
// another shape or side. Excalidraw has no such dots: this layer is ours,
// over its canvas, and knows the scene only through its API.
import { anchor, anchorPoints, connectable, elbowRoute, nearestSide, targetAt } from './anchors.js';

const SIDES = ['top', 'right', 'bottom', 'left'];
const PAD = 14; // px around a shape where its dots stay (the pointer goes from the shape to a dot)
const MIN_DRAG = 8; // px: less is a click on a dot, not an arrow
const SVG = 'http://www.w3.org/2000/svg';

/**
 * Mount the dots in `el` (beside Excalidraw's root, over it). `getApi()` and `getLib()` are the whiteboard's;
 * `onArrow({ from, fromSide, to, toSide, points, elbow })` makes the arrow a drag from a dot asks for (`points` in
 * scene coordinates); `onPick({ shape, side })` a click on a dot (no drag). → { update() (the scene or the view changed), destroy() }.
 */
export function mountAnchors(el, { getApi, getLib, onArrow, onPick = () => {} }) {
  const layer = Object.assign(document.createElement('div'), { className: 'wb-anchors', hidden: true });
  const svg = document.createElementNS(SVG, 'svg');
  svg.classList.add('wb-anchor-path');
  const path = document.createElementNS(SVG, 'path');
  svg.append(path);
  const dots = Object.fromEntries(SIDES.map((side) => {
    const d = Object.assign(document.createElement('span'), { className: 'wb-anchor', title: 'Drag to draw an arrow from here' });
    d.dataset.side = side;
    return [side, d];
  }));
  layer.append(svg, ...Object.values(dots));
  el.append(layer);

  let pointer = null; // [clientX, clientY], while it is over the whiteboard
  let pressed = false; // the main button down (an arrow's end dragged by Excalidraw's handle)
  let drag = null; // { from, side, start } — an arrow drawn from a dot
  let raf = 0;
  let shown = null; // the id of the shape whose dots show

  const ready = () => { const x = getApi(); return x && getLib() ? x : null; };
  const toScene = (st, [cx, cy]) => { const p = getLib().viewportCoordsToSceneCoords({ clientX: cx, clientY: cy }, st); return [p.x, p.y]; };
  const toClient = (st, [x, y]) => [(x + st.scrollX) * st.zoom.value + st.offsetLeft, (y + st.scrollY) * st.zoom.value + st.offsetTop];
  const hide = () => { layer.hidden = true; shown = null; };

  /** The arrow a drag from a dot would make now: to the side of the shape under the pointer, or to the pointer. */
  function route(st) {
    const p = toScene(st, pointer);
    const to = targetAt(getApi().getSceneElements(), p, PAD / st.zoom.value, drag.from.id);
    const toSide = to ? nearestSide(to, p) : null;
    const s = anchor(drag.from, drag.side);
    const e = to ? anchor(to, toSide) : p;
    const elbow = st.currentItemArrowType === 'elbow';
    return { to, toSide, elbow, points: elbow ? elbowRoute(s, drag.side, e, toSide) : [s, e] };
  }

  function paint() {
    raf = 0;
    const xapi = ready();
    if (!xapi) { hide(); return; }
    const st = xapi.getAppState();
    const tool = st.activeTool?.type;
    const drawing = st.newElement?.type === 'arrow' || st.multiElement?.type === 'arrow';
    const els = xapi.getSceneElements();
    // An arrow selected: its ends are Excalidraw's handles, the dots only say where an end may go.
    const arrowOn = !drag && els.some((e) => e.type === 'arrow' && st.selectedElementIds?.[e.id]);
    if (st.viewModeEnabled || st.editingTextElement || st.selectedElementsAreBeingDragged || st.isResizing || st.isRotating
      || (st.newElement && !drawing) || (!drag && tool !== 'selection' && tool !== 'arrow')) { hide(); return; }
    const pad = PAD / st.zoom.value;
    const p = pointer && toScene(st, pointer);
    let target = null;
    let hot = null;
    if (arrowOn) {
      target = p && targetAt(els, p, pad);
      if (target && pressed) hot = nearestSide(target, p);
    } else if (drag || drawing) {
      // Where the arrow will end: the shape under the pointer (not the one it leaves), its nearest dot lit.
      const from = drag ? drag.from.id : (st.newElement || st.multiElement)?.startBinding?.elementId;
      target = p && targetAt(els, p, pad, from);
      if (target) hot = nearestSide(target, p);
      if (drag) {
        const r = el.getBoundingClientRect();
        const { points } = route(st);
        path.setAttribute('d', points.map((q, i) => { const [cx, cy] = toClient(st, q); return `${i ? 'L' : 'M'}${cx - r.left} ${cy - r.top}`; }).join(' '));
      }
    } else {
      target = p && targetAt(els, p, pad);
      if (!target) {
        const sel = els.filter((e) => st.selectedElementIds?.[e.id] && connectable(e));
        if (sel.length === 1) [target] = sel; // a card selected is its frame and its parts: the frame
      }
    }
    if (!target && !drag) { hide(); return; }
    layer.hidden = false;
    if (!target) { for (const d of Object.values(dots)) d.hidden = true; shown = null; return; } // a drag over nothing: the line only
    const r = el.getBoundingClientRect();
    const at = anchorPoints(target);
    layer.classList.toggle('passive', drawing || arrowOn); // Excalidraw's own arrow: the dots only show where it goes
    for (const side of SIDES) {
      const [cx, cy] = toClient(st, at[side]);
      const d = dots[side];
      d.style.left = `${cx - r.left}px`;
      d.style.top = `${cy - r.top}px`;
      d.classList.toggle('hot', side === hot);
      // Not over Excalidraw's panels (a shape under the properties, say): only over the drawing.
      d.hidden = false;
      const hit = document.elementFromPoint(cx, cy);
      d.hidden = !(hit && (hit.tagName === 'CANVAS' || hit === d || layer.contains(hit)));
    }
    if (!drag) shown = target.id;
  }
  const update = () => { if (!raf) raf = requestAnimationFrame(paint); };

  const onMove = (e) => { pointer = [e.clientX, e.clientY]; pressed = !!(e.buttons & 1); update(); };
  const onLeave = () => { if (!drag) { pointer = null; update(); } };
  el.addEventListener('pointermove', onMove, true);
  el.addEventListener('pointerleave', onLeave);

  // ── an arrow drawn from a dot ──
  for (const [side, d] of Object.entries(dots)) {
    d.addEventListener('pointerdown', (e) => {
      const xapi = ready();
      const from = xapi && xapi.getSceneElements().find((x) => x.id === shown);
      if (e.button !== 0 || !from) return;
      e.preventDefault();
      e.stopPropagation(); // not a click on the canvas under it
      el.setPointerCapture(e.pointerId); // the stage's: a dot moves and hides as the arrow goes
      drag = { from, side, start: [e.clientX, e.clientY] };
      pointer = [e.clientX, e.clientY];
      layer.classList.add('dragging');
      update();
    });
  }
  const end = (made) => {
    if (!drag) return;
    const xapi = ready();
    const far = pointer && Math.hypot(pointer[0] - drag.start[0], pointer[1] - drag.start[1]) >= MIN_DRAG;
    const arrow = made && far && xapi ? { from: drag.from, fromSide: drag.side, ...route(xapi.getAppState()) } : null;
    const pick = made && !far ? { shape: drag.from, side: drag.side } : null;
    drag = null;
    layer.classList.remove('dragging');
    path.setAttribute('d', '');
    if (arrow) onArrow(arrow);
    if (pick) onPick(pick);
    update();
  };
  const onUp = () => { pressed = false; end(true); };
  const onCancel = () => end(false);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  el.addEventListener('lostpointercapture', onCancel);

  return {
    update,
    destroy() {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', onMove, true);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('lostpointercapture', onCancel);
      layer.remove();
    },
  };
}
