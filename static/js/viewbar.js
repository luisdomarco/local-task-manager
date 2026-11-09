// The view bar of every list and board (docs/design.md §3 Lists): one component, the same on every screen.
//
//   [Search] [Filter] ……………… [Group: Status ▾] [Display] [List | Board]
//   Project is Acme Web ×   Labels is not infra ×   Clear  Save as view   ← the filters on, a row only while there are any
//
// Filter opens a popover of the page's fields (viewmodel.js filterFields: from the vault's structure), then a field's
// values — a box, a status's dot, the name and how many items hold it (a value no item holds is grey) — with is / is
// not. Group picks what the rows (or a board's columns) group by; Display, which closed items show, the order and the
// columns or card properties on show. The view is the page's own (viewmodel.js), saved by the page as it changes.
import { closeMenu, h, icon, priorityChip, searchBox as searchBoxOf, select, statusLabel, typeIcon, cssKey } from './ui.js';
import { cardShows, columnOn, fresh, filterParts, filterText, groupLabel, matches, valueCounts } from './viewmodel.js';

const CLOSED_MODES = [['none', 'None'], ['week', 'Last week'], ['all', 'All']];
const EMPTY_MODES = [['show', 'Show'], ['fold', 'Fold'], ['hide', 'Hide']];

// ── the popover: a menu that stays open while you pick (one at a time; Esc or a click outside closes it) ─────────
let open = null;
export function closePopover() {
  if (!open) return;
  document.removeEventListener('mousedown', open.outside, true);
  document.removeEventListener('keydown', open.esc, true);
  open.el.remove();
  open.anchor.setAttribute('aria-expanded', 'false');
  open = null;
}
/** A popover under `anchor`, drawn by render(el): a page's own (Work log's date range) as the bar's. */
export function popover(anchor, render, { width = 260, align = 'start' } = {}) {
  if (open?.anchor === anchor) { closePopover(); return null; }
  closePopover();
  closeMenu();
  const el = h('div', { class: 'menu vb-pop', role: 'dialog', style: `width:${width}px` });
  document.body.append(el);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    el.style.left = `${Math.max(8, Math.min(align === 'end' ? r.right - w : r.left, innerWidth - w - 8))}px`;
    el.style.top = `${Math.min(r.bottom + 6, Math.max(8, innerHeight - el.offsetHeight - 8))}px`;
  };
  // A pick in a menu the popover opened (a select's list) is not a click outside it.
  const outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target) && !e.target.closest?.('.menu')) closePopover(); };
  const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.menu:not(.vb-pop)')) { e.stopPropagation(); closePopover(); anchor.focus(); } };
  document.addEventListener('mousedown', outside, true);
  document.addEventListener('keydown', esc, true);
  anchor.setAttribute('aria-expanded', 'true');
  open = { el, anchor, outside, esc, render: () => { render(el); place(); } };
  open.render();
  el.querySelector('input, button')?.focus();
  return open;
}
const repaint = () => open?.render();

/** A value's face in the filter popover: a status's dot, a priority's bars, an item's type icon. */
function valueFace(field, v) {
  if (field.kind === 'status') return [h('span', { class: `status-dot s-${cssKey(v.value)}` }), h('span', { class: 'vb-name' }, statusLabel(v.label))];
  if (field.kind === 'priority') return [priorityChip(v.value)];
  if (field.kind === 'item' && v.type) return [typeIcon(v.type, 14), h('span', { class: 'vb-name' }, v.label)];
  if (field.kind === 'project' && v.value) return [typeIcon('project', 14), h('span', { class: 'vb-name' }, v.label)];
  if (field.kind === 'label' && v.value) return [icon('tag', 13), h('span', { class: 'vb-name' }, v.label)];
  if (v.tone) return [h('span', { class: `td-dot tone-${v.tone}`, 'aria-hidden': 'true' }), h('span', { class: 'vb-name' }, v.label)]; // a run's status (inboxview.js)
  return [h('span', { class: 'vb-name' }, v.label)];
}

/**
 * The bar. `opts`:
 *   view, save()               the page's view (viewmodel.js) and how it keeps it (prefs.js)
 *   fields(), ctx(), items()   the fields it filters by, what they need from the vault, and the items they count over
 *   groups                     the keys it can group by (viewmodel.js groupOptions); none: no Group button
 *   groupLabel(key)            a group key's name, when the page's keys are not viewmodel.js's (Work log's Day, Kind…)
 *   closable                   whether its items close (Display → Show closed)
 *   emptyGroups                false: no Group → Show empty groups (Work log, whose groups are what it holds)
 *   orders                     [[key, label]] for Order (the button left of Group); `order()` / onOrder(key) the one
 *                              on, `dir()` / onDir(1 | -1) which way; `boardOrders` go first on a board (Manual, which
 *                              has no way)
 *   props                      [[key, label]] the columns Display can hide (a list)
 *   cardProps                  [[key, label]] what a board's cards can show (Display → Show on cards: view.cards)
 *   saveAs(name)               keeps the view under a name (savedviews.js): "Save as view" by the chips and in Display
 *   placeholder, onText(text)  the search
 *   layout                     { current() → 'list' | 'board', pick(l), options?, isBoard? }: the List | Board switch
 *                              (`options` [[key, label, icon]] for others: Calendar | Board, List | Board | Free board;
 *                              `isBoard()` when a layout other than 'board' is a board too); none: no switch
 *   columnOrder                { on(), custom(), reset() }: a board whose columns move (views/list.js) — Group then says
 *                              how, or (once moved, for this grouping) offers Reset column order; none: neither
 *   search                     false: no search box (Today, whose day is short)
 *   closedModes, closedDefault [[key, label]] for Display → Show closed, when the page's are not None / Last week / All,
 *                              and the one Reset puts back
 *   note                       a node on the bar's right, before Display (Week's "3 of 7 done")
 *   lead                       nodes right after Filter (Work log's date range)
 *   displayRows()              nodes on top of Display, the page's own settings (the Week board's days)
 *   onReset()                  what Display → Reset to default also puts back (the page's own settings)
 *   boardGroups                false: no Group on a board (the Inbox's, whose columns are always its statuses)
 *   onChange()                 redraw the page
 * Returns { bar, chips, search, update() } — `update` redraws the chips and the button labels.
 */
export function viewBar(opts) {
  const { view, save, fields, ctx, items, groups = [], closable = false, orders = [], props = [], cardProps = [], layout = null, onChange } = opts;
  const labelOf = opts.groupLabel || groupLabel;
  const isBoard = () => (layout?.isBoard ? layout.isBoard() : layout?.current() === 'board');
  const LAYOUTS = layout?.options || [['list', 'List', 'list'], ['board', 'Board', 'kanban']];
  const change = (patch) => { Object.assign(view, patch); save(); onChange(); repaint(); };

  const search = h('input', {
    type: 'search', class: 'vb-search', placeholder: opts.placeholder || 'Filter by subject or ID…', 'data-filter': '',
    'aria-label': opts.placeholder || 'Filter by subject or ID',
  });
  search.addEventListener('input', () => opts.onText(search.value));
  const searchBox = opts.search === false ? null : searchBoxOf(search);

  // ── Filter ──
  const filterBtn = h('button', { type: 'button', class: 'btn ghost small vb-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: 'Filter' }, icon('filter', 14), h('span', { class: 'vb-btn-text' }, 'Filter'));
  let level = null; // the field whose values the popover shows; null: the list of fields
  let query = '';
  const filterOf = (key) => view.filters.find((f) => f.field === key);
  const setValues = (key, values, op) => {
    const rest = view.filters.filter((f) => f.field !== key);
    change({ filters: values.length ? [...rest, { field: key, op: op || filterOf(key)?.op || 'is', values }] : rest });
  };
  function renderFilter(el) {
    const fs = fields();
    if (!level) {
      const q = query.toLowerCase();
      const input = h('input', { type: 'search', class: 'vb-find', placeholder: 'Filter by…', value: query, 'aria-label': 'Filter by' });
      input.addEventListener('input', () => { query = input.value; renderFilter(el); el.querySelector('.vb-find')?.focus(); });
      el.replaceChildren(input, ...fs.filter((f) => !q || f.label.toLowerCase().includes(q)).map((f) => h('button', {
        type: 'button', class: 'menu-item', onclick: () => { level = f.key; repaint(); el.querySelector('input[type=checkbox], button')?.focus(); },
      }, h('span', {}, f.label), filterOf(f.key) ? h('span', { class: 'vb-count' }, String(filterOf(f.key).values.length)) : null, icon('right', 13))));
      return;
    }
    const f = fs.find((x) => x.key === level);
    if (!f) { level = null; renderFilter(el); return; }
    const on = filterOf(f.key);
    const op = on?.op || 'is';
    // A value's count is over what the other filters leave: what picking it would show.
    const others = view.filters.filter((x) => x.field !== f.key);
    const pool = items().filter((i) => matches(i, others, fs, ctx()));
    const counts = valueCounts(pool, f, ctx());
    const picked = new Set(on?.values || []);
    el.replaceChildren(
      h('div', { class: 'vb-pop-head' },
        h('button', { type: 'button', class: 'btn icon small', title: 'Back to the fields', 'aria-label': 'Back', onclick: () => { level = null; repaint(); } }, icon('left', 14)),
        h('strong', {}, f.label),
        h('span', { class: 'spacer' }),
        h('div', { class: 'seg vb-op', role: 'group', 'aria-label': 'Match' }, ...[['is', 'is'], ['isnot', 'is not']].map(([k, l]) => h('button', {
          type: 'button', class: `btn small ${op === k ? 'active' : ''}`, 'aria-pressed': String(op === k),
          onclick: () => (on ? setValues(f.key, on.values, k) : (pending = k, repaint())),
        }, l)))),
      h('div', { class: 'vb-values' }, ...f.values(ctx(), items()).map((v) => {
        const n = counts[v.value] || 0;
        const box = h('input', { type: 'checkbox', checked: picked.has(v.value) });
        box.addEventListener('change', () => {
          const next = box.checked ? [...picked, v.value] : [...picked].filter((x) => x !== v.value);
          setValues(f.key, next, on?.op || pending);
        });
        return h('label', { class: `vb-value ${n ? '' : 'zero'}` }, box, ...valueFace(f, v), h('span', { class: 'vb-count' }, String(n)));
      })));
  }
  let pending = 'is'; // is / is not picked before any value
  filterBtn.addEventListener('click', () => { level = null; query = ''; pending = 'is'; popover(filterBtn, renderFilter, { width: 280 }); });

  // ── Save as view: a name, and the view kept under it (the page's saveAs; listed in the sidebar's Views) ──
  function renderSaveAs(el) {
    const input = h('input', { type: 'text', class: 'vb-find', placeholder: 'Name of the view', 'aria-label': 'Name of the view', maxlength: '60' });
    const go = () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      closePopover();
      opts.saveAs(name);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    el.replaceChildren(
      h('div', { class: 'vb-pop-head' }, h('strong', {}, 'Save as view')),
      input,
      h('p', { class: 'vb-hint' }, 'Its filters, grouping and display, under this name in the sidebar.'),
      h('div', { class: 'vb-pop-foot' }, h('span', {}), h('button', { type: 'button', class: 'btn primary small', onclick: go }, 'Save')));
    requestAnimationFrame(() => input.focus());
  }
  const saveAsBtn = (cls) => h('button', {
    type: 'button', class: cls, 'aria-haspopup': 'dialog', 'aria-expanded': 'false',
    onclick: (e) => {
      // From Display: the name asked under the Display button, in place of its popover (one open at a time).
      const inDisplay = !!e.currentTarget.closest('.vb-pop');
      if (inDisplay) closePopover();
      popover(inDisplay ? displayBtn : e.currentTarget, renderSaveAs, { width: 280, align: 'end' });
    },
  }, 'Save as view');

  // ── the filters on, as chips ──
  const chips = h('div', { class: 'vb-chips', role: 'list', 'aria-label': 'Filters on' });
  function paintChips() {
    const fs = fields();
    const on = view.filters.filter((f) => fs.some((x) => x.key === f.field));
    chips.hidden = !on.length;
    chips.replaceChildren(...on.map((f) => {
      const parts = filterParts(f, fs, ctx(), items());
      return h('span', { class: 'vb-chip', role: 'listitem' },
        h('button', {
          type: 'button', class: 'vb-chip-text', title: 'Change this filter',
          onclick: (e) => { level = f.field; pending = f.op; popover(e.currentTarget, renderFilter, { width: 280 }); },
        }, `${parts.head} `, h('b', {}, parts.values)),
        h('button', { type: 'button', class: 'vb-chip-x', 'aria-label': `Remove ${filterText(f, fs, ctx(), items())}`, onclick: () => setValues(f.field, []) }, icon('x', 12)));
    }),
    ...(on.length ? [h('button', { type: 'button', class: 'vb-clear', onclick: () => change({ filters: [] }) }, 'Clear')] : []),
    ...(on.length && opts.saveAs ? [saveAsBtn('vb-clear vb-save')] : []));
    filterBtn.classList.toggle('on', on.length > 0);
  }

  // ── Order: what the rows are sorted by, and which way ──
  const orderBtn = orders.length ? h('button', { type: 'button', class: 'btn ghost small vb-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }) : null;
  const ordersNow = () => (isBoard() ? [...(opts.boardOrders || []), ...orders] : orders);
  const unordered = () => (opts.boardOrders || []).some(([k]) => k === opts.order()); // Manual: no way to go
  const orderLabel = () => ordersNow().find(([k]) => k === opts.order())?.[1] || ordersNow()[0]?.[1] || '';
  function renderOrder(el) {
    const dir = opts.dir?.() ?? 1;
    el.replaceChildren(
      h('div', { class: 'vb-pop-head' }, h('strong', {}, 'Order by'), h('span', { class: 'spacer' }),
        unordered() ? null : h('div', { class: 'seg vb-op', role: 'group', 'aria-label': 'Direction' }, ...[[1, 'Ascending', 'up'], [-1, 'Descending', 'down']].map(([d, l, ico]) => h('button', {
          type: 'button', class: `btn small icon ${dir === d ? 'active' : ''}`, 'aria-pressed': String(dir === d), title: l, 'aria-label': l,
          onclick: () => { opts.onDir?.(d); update(); repaint(); },
        }, icon(ico, 13))))),
      ...ordersNow().map(([k, l]) => h('button', {
        type: 'button', class: `menu-item ${opts.order() === k ? 'current' : ''}`, 'aria-pressed': String(opts.order() === k),
        onclick: () => { opts.onOrder(k); update(); repaint(); },
      }, h('span', {}, l), opts.order() === k ? icon('check', 14) : null)));
  }
  orderBtn?.addEventListener('click', () => popover(orderBtn, renderOrder, { width: 240, align: 'end' }));

  // ── Group ──
  const groupBtn = groups.length ? h('button', { type: 'button', class: 'btn ghost small vb-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }) : null;
  // What to group by, then (grouped) the order inside each group and whether a group with no item shows. It stays open
  // across picks: the three are set together.
  function renderGroup(el) {
    const toggle = (on, onChange, aria) => h('button', {
      type: 'button', class: `vb-switch ${on ? 'on' : ''}`, role: 'switch', 'aria-checked': String(on), 'aria-label': aria, onclick: () => onChange(!on),
    }, h('span', {}));
    el.replaceChildren(...[
      h('div', { class: 'menu-label' }, 'Group by'),
      ...(isBoard() ? groups : [null, ...groups]).map((g) => h('button', { // a board's columns are its groups: never None
        type: 'button', class: `menu-item ${view.groupBy === g ? 'current' : ''}`, 'aria-pressed': String(view.groupBy === g),
        onclick: () => change({ groupBy: g, folded: [] }),
      }, h('span', {}, labelOf(g)), view.groupBy === g ? icon('check', 14) : null)),
      ...(view.groupBy ? [
        h('div', { class: 'menu-sep' }),
        orders.length && !isBoard() ? h('div', { class: 'vb-row' }, h('span', {}, 'Order in groups'),
          select([[null, 'As the list'], ...orders], view.orderInGroups, (k) => change({ orderInGroups: k }), { class: 'small', 'aria-label': 'Order in groups', search: false })) : null,
        isBoard() || opts.emptyGroups === false ? null : h('div', { class: 'vb-row' }, h('span', {}, 'Show empty groups'), toggle(!!view.showEmpty, (on) => change({ showEmpty: on }), 'Show empty groups')),
        // A board's columns, in the order they were dragged to for this grouping: back to the group's own.
        isBoard() && opts.columnOrder?.on() ? (opts.columnOrder.custom()
          ? h('button', { type: 'button', class: 'menu-item', onclick: () => { opts.columnOrder.reset(); repaint(); } }, h('span', {}, 'Reset column order'))
          : h('p', { class: 'vb-hint' }, 'Drag a column by its header to move it.')) : null,
      ] : []),
    ].filter(Boolean));
  }
  groupBtn?.addEventListener('click', () => popover(groupBtn, renderGroup, { width: 280, align: 'end' }));

  // ── Display ──
  /** A row of pills that each turn a thing on or off (a column, a card's property): dark while on. */
  const pills = (label, pairs, isOn, flip) => h('div', { class: 'vb-props' }, h('div', { class: 'menu-label' }, label),
    h('div', { class: 'vb-pills' }, ...pairs.map(([k, l]) => h('button', {
      type: 'button', class: `vb-pill ${isOn(k) ? 'on' : ''}`, 'aria-pressed': String(isOn(k)), onclick: () => flip(k),
    }, l))));
  const displayBtn = h('button', { type: 'button', class: 'btn ghost small vb-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: 'Display' }, icon('columns', 14), h('span', { class: 'vb-btn-text' }, 'Display'));
  function renderDisplay(el) {
    const row = (label, control) => h('div', { class: 'vb-row' }, h('span', {}, label), control);
    const seg = (pairs, current, pick, aria) => h('div', { class: 'seg', role: 'group', 'aria-label': aria }, ...pairs.map(([k, l]) => h('button', {
      type: 'button', class: `btn small ${current === k ? 'active' : ''}`, 'aria-pressed': String(current === k), onclick: () => pick(k),
    }, l)));
    el.replaceChildren(...[
      ...(opts.displayRows?.() || []),
      closable ? row('Show closed', seg(opts.closedModes || CLOSED_MODES, view.closed, (k) => change({ closed: k }), 'Show closed')) : null,
      isBoard() ? row('Empty columns', seg(EMPTY_MODES, view.emptyCols || 'fold', (k) => change({ emptyCols: k, boardFold: {} }), 'Empty columns')) : null,
      props.length && !isBoard() ? pills(opts.propsLabel || 'Show columns', props, (k) => columnOn(view.props, k),
        (k) => change({ props: { ...view.props, [k]: !columnOn(view.props, k) } })) : null,
      cardProps.length && isBoard() ? pills('Show on cards', cardProps, (k) => cardShows(view, k),
        (k) => change({ cards: { ...(view.cards || {}), [k]: !cardShows(view, k) } })) : null,
      h('div', { class: 'menu-sep' }),
      h('div', { class: 'vb-pop-foot' },
        h('button', {
          type: 'button', class: 'vb-foot-btn',
          onclick: () => { const d = fresh(); opts.onOrder?.(null); opts.onReset?.(); change({ closed: opts.closedDefault || d.closed, props: {}, cards: {}, emptyCols: null, boardFold: {} }); update(); },
        }, 'Reset to default'),
        opts.saveAs ? saveAsBtn('vb-foot-btn strong') : null),
    ].filter(Boolean));
  }
  displayBtn.addEventListener('click', () => popover(displayBtn, renderDisplay, { width: 300, align: 'end' }));

  // ── List | Board ──
  const layoutSeg = layout ? h('div', { class: 'seg vb-layout', role: 'group', 'aria-label': 'Layout' }) : null;
  const paintLayout = () => layoutSeg?.replaceChildren(...LAYOUTS.map(([k, l, ico]) => h('button', {
    type: 'button', class: `btn small ${layout.current() === k ? 'active' : ''}`, 'aria-pressed': String(layout.current() === k), title: `Show as a ${l.toLowerCase()}`,
    onclick: () => { if (layout.current() !== k) { closePopover(); layout.pick(k); } },
  }, icon(ico, 14), h('span', { class: 'vb-layout-text' }, l))));

  const bar = h('div', { class: 'view-bar', role: 'toolbar', 'aria-label': 'View' },
    searchBox, filterBtn, ...(opts.lead || []), h('span', { class: 'spacer' }), opts.note ? h('span', { class: 'vb-note' }, opts.note) : null, orderBtn, groupBtn, displayBtn, layoutSeg);

  function update() {
    paintChips();
    paintLayout();
    if (orderBtn) orderBtn.replaceChildren(...[h('span', { class: 'muted' }, 'Order:'), orderLabel(), unordered() ? null : icon((opts.dir?.() ?? 1) > 0 ? 'up' : 'down', 12)].filter(Boolean));
    if (groupBtn) {
      groupBtn.replaceChildren(h('span', { class: 'muted' }, 'Group:'), labelOf(view.groupBy), icon('down', 12));
      groupBtn.hidden = opts.boardGroups === false && isBoard();
    }
  }
  update();
  return { bar, chips, search, update };
}
