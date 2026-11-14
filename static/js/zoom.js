// An image or a diagram to look into (the Explorer's file view, an attachment's dialog, a picture or a diagram of
// rendered Markdown expanded: expand.js): it opens fitted to its stage, in its middle. Two tools in its bar: Zoom (the
// wheel zooms around the pointer, a click zooms in there, ⌥-click out) and Hand (the wheel scrolls); with either,
// dragging moves it, ⌘ + wheel or a pinch (two fingers on a touch screen too) zooms, a double click or 0 fits it again,
// and − · % · + · Fit do what they say. Only the picture's size changes: the stage scrolls.
import { ZOOM_MAX, ZOOM_MIN, fitScale, zoomScroll, zoomStep } from './filetree.js';
import { h, icon } from './ui.js';

/** A picture at `url` to look into. */
export function zoomableImage(url, name) {
  const img = h('img', { class: 'zoom-img', alt: name, draggable: 'false' });
  img.src = url; // the app's own address, set as a property (h() takes outside links only)
  const view = zoomable(img, name, () => (img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : null));
  img.addEventListener('load', () => view.refit());
  return view.el;
}

/** An <svg> (a drawn diagram; it is moved, so pass a copy) to look into, its natural size its viewBox's. */
export function zoomableSvg(svg, name) {
  const vb = svg.viewBox?.baseVal;
  const box = vb?.width ? { w: vb.width, h: vb.height } : { w: Number(svg.getAttribute('width')) || 800, h: Number(svg.getAttribute('height')) || 600 };
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.maxWidth = 'none'; // Mermaid caps it at its own width
  svg.classList.add('zoom-img');
  const view = zoomable(svg, name, () => box, { grow: true });
  requestAnimationFrame(() => view.refit());
  return view.el;
}

// The tool the stage's pointer is (one for every view, this visit): 'zoom' — the wheel zooms, a click zooms in where
// it is (⌥ or ⇧: out) — or 'hand' — the wheel scrolls. Both drag to move; ⌘ + wheel or a pinch always zooms.
let tool = 'zoom';

/** `img` (an <img> or an <svg>) on a stage to zoom and drag; `size()` its natural { w, h }, null while unknown.
 *  `grow`: fitted, a drawing (vector, sharp at any size) also grows to fill the stage; a picture stops at 100 %. */
function zoomable(img, name, size, { grow = false } = {}) {
  const stage = h('div', { class: 'zoom-stage fit', tabindex: '0', 'aria-label': `${name}: zoom with the wheel, drag to move` }, img);
  const pct = h('button', { class: 'btn small zoom-pct', title: 'Actual size (100 %)' }, '—');
  let scale = 1;
  let fitted = true;

  const fit = (n) => (grow && n.w > 0 && n.h > 0 && stage.clientWidth > 0
    ? Math.min(ZOOM_MAX, stage.clientWidth / n.w, stage.clientHeight / n.h)
    : fitScale(n.w, n.h, stage.clientWidth, stage.clientHeight));
  /** Show it at `next` (null: fitted), keeping the point (px, py) of the stage where it is. Smaller than the stage,
   *  it sits in its middle (margin: auto), so the point is measured from where it is drawn. */
  // Where it is drawn in the stage's scrolled content (an <svg> has no offsetLeft: measured from the boxes)
  const offset = () => {
    const a = img.getBoundingClientRect();
    const b = stage.getBoundingClientRect();
    return [a.left - b.left - stage.clientLeft + stage.scrollLeft, a.top - b.top - stage.clientTop + stage.scrollTop];
  };
  const set = (next, px = stage.clientWidth / 2, py = stage.clientHeight / 2) => {
    const n = size();
    if (!n) return;
    const from = scale;
    const [ox, oy] = offset();
    fitted = next === null;
    scale = fitted ? fit(n) : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    stage.classList.toggle('fit', fitted);
    img.style.width = `${Math.round(n.w * scale)}px`;
    img.style.height = `${Math.round(n.h * scale)}px`;
    pct.textContent = `${Math.round(scale * 100)} %`;
    if (fitted) return;
    const to = zoomScroll(stage.scrollLeft, stage.scrollTop, px - ox, py - oy, from, scale);
    const [nx, ny] = offset(); // smaller than the stage, it moved to its new middle
    stage.scrollLeft = to.x + nx - ox;
    stage.scrollTop = to.y + ny - oy;
  };
  new ResizeObserver(() => { if (fitted) set(null); }).observe(stage);
  const at = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  // A press: a drag moves the picture; a press that did not move is a click (the zoom tool zooms there). Two fingers pinch.
  let drag = null;
  const touches = new Map(); // pointerId → { x, y }, while pressed
  let pinch = null;
  const spread = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.setPointerCapture(e.pointerId);
    if (touches.size === 2) { drag = null; pinch = { d: spread(), scale }; return; }
    drag = { x: e.clientX, y: e.clientY, sx: stage.scrollLeft, sy: stage.scrollTop, moved: false };
  });
  stage.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) {
      const [a, b] = [...touches.values()];
      const r = stage.getBoundingClientRect();
      set(pinch.scale * (spread() / (pinch.d || 1)), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; stage.classList.add('dragging'); }
    stage.scrollLeft = drag.sx - dx;
    stage.scrollTop = drag.sy - dy;
  });
  const lift = (e) => {
    touches.delete(e.pointerId);
    stage.classList.remove('dragging');
    if (pinch) { if (!touches.size) pinch = null; drag = null; return; }
    const was = drag;
    drag = null;
    if (!was || was.moved || e.type === 'pointercancel' || tool !== 'zoom') return;
    set(zoomStep(scale, e.altKey || e.shiftKey ? -1 : 1, 1.5), ...at(e));
  };
  stage.addEventListener('pointerup', lift);
  stage.addEventListener('pointercancel', lift);
  stage.addEventListener('dblclick', (e) => { e.preventDefault(); set(null); });
  // The wheel: zooms around the pointer with the zoom tool, and with ⌘ or a trackpad's pinch (a wheel with ctrlKey)
  // whatever the tool; with the hand it scrolls, as a page does.
  stage.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey || tool === 'zoom')) return;
    e.preventDefault();
    set(zoomStep(scale, -e.deltaY, 1 + Math.min(Math.abs(e.deltaY), 50) / 250), ...at(e));
  }, { passive: false });

  const tools = h('div', { class: 'seg zoom-tools', role: 'group', 'aria-label': 'Tool' });
  const pick = (t) => {
    tool = t;
    stage.classList.toggle('tool-hand', t === 'hand');
    stage.classList.toggle('tool-zoom', t === 'zoom');
    for (const b of tools.children) { const on = b.dataset.tool === t; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  };
  tools.append(
    h('button', { class: 'btn icon small toggle', 'data-tool': 'hand', title: 'Hand (H): drag to move, the wheel scrolls', 'aria-label': 'Hand', onclick: () => pick('hand') }, icon('hand', 15)),
    h('button', { class: 'btn icon small toggle', 'data-tool': 'zoom', title: 'Zoom (Z): the wheel zooms, a click zooms in, ⌥-click out; drag to move', 'aria-label': 'Zoom', onclick: () => pick('zoom') }, icon('zoomIn', 15)));
  pick(tool);
  stage.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); set(zoomStep(scale, 1)); }
    else if (e.key === '-') { e.preventDefault(); set(zoomStep(scale, -1)); }
    else if (e.key === '0') { e.preventDefault(); set(null); }
    else if (e.key === 'h' || e.key === 'H') { e.preventDefault(); pick('hand'); }
    else if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); pick('zoom'); }
  });

  const bar = h('div', { class: 'zoom-bar', role: 'toolbar', 'aria-label': 'Zoom' },
    tools, h('span', { class: 'spacer' }),
    h('button', { class: 'btn icon', title: 'Zoom out (−)', 'aria-label': 'Zoom out', onclick: () => set(zoomStep(scale, -1)) }, icon('minus', 14)),
    pct,
    h('button', { class: 'btn icon', title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => set(zoomStep(scale, 1)) }, icon('plus', 14)),
    h('button', { class: 'btn small', title: 'Fit (0, or a double click)', onclick: () => set(null) }, 'Fit'));
  pct.addEventListener('click', () => set(1));
  return { el: h('div', { class: 'zoom' }, bar, stage), refit: () => set(null) };
}
