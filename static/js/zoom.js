// An image to look into (the Explorer's file view and an attachment's dialog): it opens fitted to its stage; a click
// shows it at 100 % (again: fitted), ⌘ + wheel or a pinch zooms around the pointer, dragging moves it, a double click
// fits it again, and − · % · + · Fit in its bar do the same. Only the image's width changes: the stage scrolls.
import { ZOOM_MAX, ZOOM_MIN, fitScale, zoomScroll, zoomStep } from './filetree.js';
import { h, icon } from './ui.js';

export function zoomableImage(url, name) {
  const img = h('img', { class: 'zoom-img', alt: name, draggable: 'false' });
  img.src = url; // the app's own address, set as a property (h() takes outside links only)
  const stage = h('div', { class: 'zoom-stage fit', tabindex: '0', 'aria-label': `${name}: click to zoom` }, img);
  const pct = h('button', { class: 'btn small zoom-pct', title: 'Actual size (100 %)' }, '—');
  let scale = 1;
  let fitted = true;

  const fit = () => fitScale(img.naturalWidth, img.naturalHeight, stage.clientWidth, stage.clientHeight);
  /** Show it at `next` (null: fitted), keeping the point (px, py) of the stage where it is. */
  const set = (next, px = stage.clientWidth / 2, py = stage.clientHeight / 2) => {
    if (!img.naturalWidth) return;
    const from = scale;
    fitted = next === null;
    scale = fitted ? fit() : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    stage.classList.toggle('fit', fitted);
    img.style.width = `${Math.round(img.naturalWidth * scale)}px`;
    pct.textContent = `${Math.round(scale * 100)} %`;
    if (fitted) return;
    const to = zoomScroll(stage.scrollLeft, stage.scrollTop, px, py, from, scale);
    stage.scrollLeft = to.x;
    stage.scrollTop = to.y;
  };
  img.addEventListener('load', () => set(null));
  new ResizeObserver(() => { if (fitted) set(null); }).observe(stage);

  // A press: a drag moves the image; a press that did not move is a click (100 % ↔ fitted).
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, sx: stage.scrollLeft, sy: stage.scrollTop, moved: false };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    stage.scrollLeft = drag.sx - dx;
    stage.scrollTop = drag.sy - dy;
  });
  stage.addEventListener('pointerup', (e) => {
    const was = drag;
    drag = null;
    if (!was || was.moved) return;
    const r = stage.getBoundingClientRect();
    set(fitted ? 1 : null, e.clientX - r.left, e.clientY - r.top);
  });
  stage.addEventListener('dblclick', (e) => { e.preventDefault(); set(null); });
  // ⌘ + wheel, and a trackpad's pinch (which the browser sends as a wheel with ctrlKey): zoom around the pointer.
  stage.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    set(zoomStep(scale, -e.deltaY, 1 + Math.min(Math.abs(e.deltaY), 50) / 250), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  stage.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') { e.preventDefault(); set(zoomStep(scale, 1)); }
    else if (e.key === '-') { e.preventDefault(); set(zoomStep(scale, -1)); }
    else if (e.key === '0') { e.preventDefault(); set(null); }
  });

  const bar = h('div', { class: 'zoom-bar', role: 'toolbar', 'aria-label': 'Zoom' },
    h('button', { class: 'btn icon', title: 'Zoom out (−)', 'aria-label': 'Zoom out', onclick: () => set(zoomStep(scale, -1)) }, icon('minus', 14)),
    pct,
    h('button', { class: 'btn icon', title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => set(zoomStep(scale, 1)) }, icon('plus', 14)),
    h('button', { class: 'btn small', title: 'Fit (0, or a double click)', onclick: () => set(null) }, 'Fit'));
  pct.addEventListener('click', () => set(1));
  return h('div', { class: 'zoom' }, bar, stage);
}
