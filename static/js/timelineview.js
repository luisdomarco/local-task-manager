// The Timeline layout (docs/design.md §3 Timeline): Goals, Projects and Initiatives as bars over days, weeks or months.
// timeline.js says what runs when; this draws it and saves what a drag changes.
//
//   [Types ▾] [Days | Weeks | Months] [− +] [Today]                      its own bar, over the timeline
//   ┌ Name ──────────────┬ Nov 2026 ───────────── Dec 2026 ─────────┐   the header stays on top, the names on the left
//   │ ▾ ◎ GOL-3 Launch   │      ▕██████████████████▏      │          │   one row per item, under its parent, foldable
//   │   ▸ ▣ PRJ-7 Web    │          ▕█████████▏           │  ◆       │   a due date alone: a diamond
//   └────────────────────┴────────────────────────│today───────────────┘
//
// A bar's ends drag (its start and due; the middle moves both), written through the item's normal save — only the
// fields its type has, and Ticketing writes only the keys that change. A click opens the item. ⌘/Ctrl + wheel zooms
// round the day under the pointer, as the canvas does. Kept with the page's view: `view.timeline` { types, scale, zoom,
// folded }.
import { today } from './dates.js';
import { hasField, isDone, TYPE_DEFS } from './rules.js';
import { updateItem } from './state.js';
import { refOf } from './shownid.js';
import { checkSelect, cssKey, h, icon, seg, typeIcon } from './ui.js';
import { ZOOM, dayAt, dayNum, dragSpan, fillRange, fromNum, pxPerDay, rangeOf, rowsOf, spanOf, ticksOf, xOf } from './timeline.js';
import { isPhone } from './phone.js';

const SCALES = [['days', 'Days'], ['weeks', 'Weeks'], ['months', 'Months']];
// Where each timeline was scrolled, so a repaint (an item saved, a filter) leaves it where it was. Per page box.
const scrolled = new WeakMap();

/** The page's timeline settings with their defaults: the types shown (of `types`), the scale, the zoom, the folded rows. */
export function timelineSettings(view, types, defaults) {
  const tl = view.timeline || {};
  const picked = (tl.types || []).filter((t) => types.includes(t));
  return {
    types: picked.length ? picked : defaults.filter((t) => types.includes(t)),
    scale: SCALES.some(([k]) => k === tl.scale) ? tl.scale : 'weeks',
    zoom: Number.isFinite(tl.zoom) ? Math.max(ZOOM[0], Math.min(ZOOM[1], tl.zoom)) : 0,
    folded: Array.isArray(tl.folded) ? tl.folded : [],
  };
}

/**
 * Draws the timeline in `box`. `items`: what the page shows (already filtered, in its order); `types`: the types it may
 * show (`defaults` those ticked until the user picks); `view` / `change(patch)` the page's view and how it saves.
 */
export function paintTimeline(box, { items, types, defaults = types, view, change, onOpen }) {
  const tl = timelineSettings(view, types, defaults);
  const set = (patch) => change({ timeline: { ...tl, ...patch } });
  const now = today();
  const ppd = pxPerDay(tl.scale, tl.zoom);
  const shown = items.filter((i) => tl.types.includes(i.type));
  const rows = rowsOf(shown, { folded: new Set(tl.folded) });
  const spans = new Map(rows.map((r) => [r.item.key, spanOf(r.item, { now, closed: isDone(r.item) })]));
  // As wide as the box at least: zoomed out, the items' days alone would end mid-panel and leave it blank on the right.
  const range = fillRange(rangeOf([...spans.values()], now, tl.scale), Math.max(0, box.clientWidth - namesWidth()) / ppd);
  const { bands, ticks } = ticksOf(range, tl.scale);
  const width = (dayNum(range.to) - dayNum(range.from) + 1) * ppd;
  const prev = scrolled.get(box);

  // ── its bar ──
  const plural = (t) => TYPE_DEFS[t]?.plural || t;
  const tools = h('div', { class: 'tl-tools' },
    types.length > 1 ? checkSelect(types.map((t) => [t, plural(t)]), tl.types, (picked) => set({ types: picked }),
      { any: defaults.map(plural).join(', '), text: (p) => p.map(plural).join(', '), class: 'small', 'aria-label': 'Types shown' }) : null,
    seg(SCALES, tl.scale, (s) => { scrolled.delete(box); set({ scale: s }); }, { aria: 'Scale' }),
    h('div', { class: 'tl-move' }, // zoom and Today wrap together on a narrow screen
      h('div', { class: 'tl-zoom', role: 'group', 'aria-label': 'Zoom' },
        h('button', { type: 'button', class: 'btn icon small', title: 'Zoom out', 'aria-label': 'Zoom out', disabled: tl.zoom <= ZOOM[0], onclick: () => zoomBy(-1) }, icon('minus', 14)),
        h('button', { type: 'button', class: 'btn icon small', title: 'Zoom in (⌘ + wheel)', 'aria-label': 'Zoom in', disabled: tl.zoom >= ZOOM[1], onclick: () => zoomBy(1) }, icon('plus', 14))),
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => { scrolled.delete(box); seekToday(); } }, 'Today')));

  // ── the grid: a header row, then a row per item; the names column and the header stay put ──
  const head = [
    h('div', { class: 'tl-corner' }, 'Name'),
    h('div', { class: 'tl-scale', style: `width:${width}px` },
      h('div', { class: 'tl-bands' }, bands.map((b) => h('span', { style: `left:${xOf(b.day, range.from, ppd)}px;width:${b.days * ppd}px` }, h('span', {}, b.label)))),
      h('div', { class: 'tl-ticks' }, ticks.map((t) => h('span', {
        class: `${t.weekend ? 'weekend' : ''} ${t.day <= now && now < dayAfter(t) ? 'now' : ''}`.trim(),
        style: `left:${xOf(t.day, range.from, ppd)}px;width:${t.days * ppd}px`,
      }, t.days * ppd >= 18 ? t.label : '')))),
  ];
  // Each cell in its own row and column: the today line spans column 2, so nothing may be placed by flow.
  const cells = rows.flatMap((r, n) => [label(r), lane(r)].map((c, col) => { c.style.gridArea = `${n + 2} / ${col + 1}`; return c; }));
  const nowLine = h('div', { class: 'tl-now', style: `grid-row: 2 / span ${Math.max(rows.length, 1)}`, 'aria-hidden': 'true' },
    h('span', { style: `left:${xOf(now, range.from, ppd) + ppd / 2}px` }));
  const grid = h('div', {
    class: `tl-grid scale-${tl.scale}`, role: 'grid', 'aria-label': 'Timeline',
    style: `grid-template-columns: var(--tl-label) ${width}px; --tl-tick:${tickWidth()}px`,
  }, ...head, ...cells, rows.length ? nowLine : null);
  const scroller = h('div', { class: 'tl-scroll' }, grid,
    rows.length ? null : h('p', { class: 'tl-empty' }, `Nothing to show: no ${tl.types.map(plural).join(' or ').toLowerCase()} here.`));
  box.replaceChildren(h('div', { class: 'tl-wrap' }, tools, scroller)); // a column of its own in the page's flex body

  scroller.addEventListener('scroll', () => scrolled.set(box, { left: scroller.scrollLeft, top: scroller.scrollTop, from: range.from, ppd }));
  // ⌘/Ctrl + wheel (and a trackpad's pinch, which arrives as one) zooms round the day under the pointer.
  scroller.addEventListener('wheel', (e) => {
    if (!e.metaKey && !e.ctrlKey) return;
    e.preventDefault();
    const x = e.clientX - scroller.getBoundingClientRect().left - labelWidth();
    zoomBy(e.deltaY < 0 ? 1 : -1, x);
  }, { passive: false });
  if (prev) {
    // The same day under the same place, though a zoom changed the width of a day or the range now starts elsewhere:
    // after a zoom the day under its anchor (the pointer, or the middle), else the first day in view.
    const at = prev.anchor ?? 0;
    const day = dayAt(prev.left + at, prev.from, prev.ppd);
    scroller.scrollLeft = xOf(day, range.from, ppd) - at + (prev.anchor === undefined ? prev.left % prev.ppd : 0);
    scroller.scrollTop = prev.top;
    scrolled.set(box, { left: scroller.scrollLeft, top: scroller.scrollTop, from: range.from, ppd });
  } else seekToday();

  function seekToday() {
    requestAnimationFrame(() => {
      const visible = scroller.clientWidth - labelWidth();
      scroller.scrollLeft = Math.max(0, xOf(now, range.from, ppd) - visible / 3);
      scrolled.set(box, { left: scroller.scrollLeft, top: scroller.scrollTop, from: range.from, ppd });
    });
  }
  function zoomBy(step, anchor = (scroller.clientWidth - labelWidth()) / 2) {
    const zoom = Math.max(ZOOM[0], Math.min(ZOOM[1], tl.zoom + step));
    if (zoom === tl.zoom) return;
    scrolled.set(box, { left: scroller.scrollLeft, top: scroller.scrollTop, from: range.from, ppd, anchor });
    set({ zoom });
  }
  function labelWidth() { return grid.querySelector('.tl-corner')?.offsetWidth || 0; }
  // The names column before the grid is drawn: app.css --tl-label (150px on a phone, 280px otherwise), and the borders.
  function namesWidth() { return (matchMedia('(max-width: 640px)').matches ? 150 : 280) + 2; }
  function tickWidth() { return tl.scale === 'days' ? ppd : tl.scale === 'weeks' ? ppd * 7 : 0; }

  // ── a row's name: its fold, type, ID and title ──
  function label(r) {
    const it = r.item;
    const fold = r.kids ? h('button', {
      type: 'button', class: 'btn icon small tl-fold', 'aria-expanded': String(!r.folded),
      'aria-label': `${r.folded ? 'Unfold' : 'Fold'} ${it.title}`,
      onclick: () => set({ folded: r.folded ? tl.folded.filter((k) => k !== it.id) : [...tl.folded, it.id] }),
    }, icon(r.folded ? 'right' : 'down', 14)) : h('span', { class: 'tl-fold' });
    return h('div', { class: `tl-label ${isDone(it) ? 'done' : ''}`, role: 'rowheader', style: `--depth:${r.depth}` },
      fold, typeIcon(it.type, 14),
      h('button', { type: 'button', class: 'tl-name', title: it.title, onclick: () => onOpen(it) },
        refOf(it) ? h('span', { class: 'tl-ref' }, refOf(it)) : null, h('span', { class: 'tl-title' }, it.title)));
  }

  // ── a row's lane: its bar (or diamond), dragged by its ends or its middle ──
  function lane(r) {
    const it = r.item;
    const span = spans.get(it.key);
    const el = h('div', { class: 'tl-lane', role: 'gridcell' });
    if (!span) return el;
    const canStart = hasField(it.type, 'start');
    const canDue = hasField(it.type, 'due');
    const status = it.fields.status ? `s-${cssKey(it.fields.status)}` : '';
    const left = xOf(span.start, range.from, ppd);
    const tip = span.milestone ? `${it.title} · due ${span.end}` : `${it.title} · ${span.start} → ${span.end}${span.to === 'today' ? ' (no due date)' : ''}`;
    if (span.milestone) {
      const d = h('button', { type: 'button', class: `tl-diamond ${status}`, title: tip, 'aria-label': tip, style: `left:${left + ppd / 2}px` });
      el.append(d);
      if (canDue && !isPhone()) drags(d, 'move', span, (s) => ({ due: s.end }));
      else d.addEventListener('click', () => onOpen(it));
      return el;
    }
    const bar = h('div', {
      class: `tl-span ${status} ${isDone(it) ? 'done' : ''} ${span.to === 'today' ? 'open-end' : ''}`.trim(),
      title: tip, style: `left:${left}px;width:${Math.max(ppd, (dayNum(span.end) - dayNum(span.start) + 1) * ppd)}px`,
    }, h('span', { class: 'tl-span-name' }, it.title));
    const editable = canStart && canDue && !isPhone(); // a phone scrolls the timeline with a finger: its bars only open
    if (editable) {
      const grip = (edge) => h('span', { class: `tl-grip ${edge}`, 'aria-hidden': 'true' });
      const a = grip('start');
      const b = grip('end');
      bar.append(a, b);
      drags(a, 'start', span, (s) => ({ start: s.start }));
      drags(b, 'end', span, (s) => ({ due: s.end }));
      drags(bar, 'move', span, (s) => ({ start: s.start, due: s.end }));
    } else bar.addEventListener('click', () => onOpen(it));
    el.append(bar);
    return el;

    /** `handle` dragged sideways moves `edge` by whole days; let go, the item saves what `patch(span)` says. A press
     *  that does not move is a click: it opens the item. */
    function drags(handle, edge, from, patch) {
      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        const x0 = e.clientX;
        const target = handle.closest('.tl-span, .tl-diamond');
        const base = { left: target.offsetLeft, width: target.offsetWidth };
        let delta = 0;
        handle.setPointerCapture(e.pointerId);
        target.classList.add('dragging');
        const move = (ev) => {
          delta = Math.round((ev.clientX - x0) / ppd);
          const s = dragSpan(from, edge, delta);
          const l = xOf(s.start, range.from, ppd);
          target.style.left = `${target.classList.contains('tl-diamond') ? l + ppd / 2 : l}px`;
          if (!target.classList.contains('tl-diamond')) target.style.width = `${(dayNum(s.end) - dayNum(s.start) + 1) * ppd}px`;
          target.title = `${s.start} → ${s.end}`;
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', cancel);
          target.classList.remove('dragging');
          if (!delta) { onOpen(it); return; }
          const s = dragSpan(from, edge, delta);
          const values = {};
          for (const [k, v] of Object.entries(patch(s))) if (v !== (it.fields[k] || null)) values[k] = v; // only what changed
          if (Object.keys(values).length) updateItem(it.key, values).catch(() => {});
        };
        const cancel = () => { up(); Object.assign(target.style, { left: `${base.left}px`, width: `${base.width}px` }); };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', cancel);
      });
    }
  }
}

const dayAfter = (t) => fromNum(dayNum(t.day) + t.days);
