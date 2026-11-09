// Month (docs/design.md §3 Planning; mock-ups I and I2), two layouts in the view bar (Calendar | Board, remembered in
// prefs `plan.month`):
//
// Calendar: a month's six weeks, moved with ‹ This month › — a week column (what is planned for the week with no day),
// then Mon…Sun, each day its number (today's dark) and its pills: its meetings at their time, what is planned that day
// (a status's dot and the subject), what is due that day ("Due · …", red once late); past three, "+N more" opens the
// day. What is late shows on one line over it, with "Move all to today"; what is planned for the month with no week, on
// another. Drag a pill onto a day to plan it there, onto a week to keep that week with no day (calendar.js lays it out).
// Board: this month by horizon — Carried over from past weeks or months, Today (with what was carried over from past
// days, as on Today), This week (the rest of it), Next week and Later this month (rules.js planHorizon). Drag a card
// onto a column to plan it there: Today gives it that day, This week and Next week that week with no day, Later this
// month the month with neither. Cards say what they are planned for and keep the order they are dropped in
// (`plan_order`, as on Today and Week).
import { dayLabel, isoWeek, monthLabel, shiftMonth, shiftWeek, thisMonth, thisWeek, today } from '../dates.js';
import { openItem } from '../panel.js';
import { MONTH_HORIZONS, PLANNABLE, byManualOrder, carriedOverDay, isDone, isLate, monthBuckets, planHorizon } from '../rules.js';
import { noMonth, placeInPlan, planWeek, state, updateMany } from '../state.js';
import { byPriority, cssKey, dropZone, h } from '../ui.js';
import { opener } from '../links.js';
import { boardOf } from '../boardview.js';
import { viewBar } from '../viewbar.js';
import { filterFields, matches } from '../viewmodel.js';
import { idMatches } from '../shownid.js';
import { vaultCtx } from './list.js';
import { cellEntries, monthCalendar } from '../calendar.js';
import { moveNow, periodHead, planCard, planViewOf } from '../planrows.js';

const LAYOUTS = [['calendar', 'Calendar', 'calendardays'], ['board', 'Board', 'kanban']];
const CLOSED = [['none', 'None'], ['all', 'All']];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const find = (key) => state.items.find((i) => i.key === key);

/** The values that plan an item for a column (`key` of MONTH_HORIZONS); {} when it is already there. */
function planFor(key, item) {
  if (planHorizon(item) === key) return {};
  const t = today();
  if (key === 'today') return { plan_day: t, plan_week: thisWeek(), ...noMonth(item) };
  if (key === 'week') return { plan_week: thisWeek(), plan_day: null, ...noMonth(item) };
  if (key === 'nextweek') return { plan_week: shiftWeek(thisWeek(), 1), plan_day: null, ...noMonth(item) };
  return { plan_month: thisMonth(), plan_week: null, plan_day: null };
}

const EMPTY = {
  today: 'Nothing planned for today', week: 'Nothing else this week',
  nextweek: 'Nothing planned for next week', month: 'Nothing else planned this month',
};

export function mount(root) {
  const { view, save } = planViewOf('month', { closed: 'all', layout: 'calendar' });
  let shift = 0; // months away from this one (the calendar)
  let text = '';
  const opened = new Set(); // days whose "+N more" was opened
  const monthNow = () => shiftMonth(thisMonth(), shift);
  const change = (patch) => { Object.assign(view, patch); save(); api.update(); };
  const go = (n) => () => { shift = n === 0 ? 0 : shift + n; opened.clear(); api.update(); };
  let head = h('header', { class: 'view-head row period-head' });
  const body = h('div', { class: 'plan-list month-list' });
  const fields = () => filterFields([...PLANNABLE], vaultCtx());
  const pool = () => state.items.filter((i) => PLANNABLE.has(i.type) && (planHorizon(i) || isLate(i)));
  const vb = viewBar({
    view, save, fields, ctx: vaultCtx, items: pool, closable: true, closedModes: CLOSED, closedDefault: 'all',
    placeholder: 'Search this month…',
    layout: { current: () => view.layout, pick: (l) => change({ layout: l }), options: LAYOUTS, isBoard: () => view.layout === 'board' },
    onText: (t) => { text = t; api.update(); },
    onChange: () => api.update(),
  });
  root.replaceChildren(head, vb.bar, vb.chips, body);

  const keepFn = () => {
    const fs = fields();
    const ctx = vaultCtx();
    const q = text.toLowerCase();
    return (i) => (i.type === 'meeting' ? !view.filters.length : matches(i, view.filters, fs, ctx))
      && (!q || idMatches(i, q) || i.title.toLowerCase().includes(q))
      && !(view.closed === 'none' && isDone(i) && i.type !== 'meeting');
  };

  /** A pill of the calendar: its dot (a status's, a meeting's square) and its subject; it opens the item, and drags. */
  function pill(entry) {
    const { item, kind } = entry;
    const meeting = kind === 'meeting';
    const late = (kind === 'due' && item.fields.due < today()) || (kind === 'plan' && !isDone(item) && isLate(item));
    const el = h('button', {
      type: 'button', class: `mcal-pill ${meeting ? 'mtg' : ''} ${isDone(item) && !meeting ? 'done' : ''} ${late ? 'late' : ''}`, 'data-key': item.key,
      title: `${item.title}${kind === 'due' ? ` · due ${item.fields.due}` : ''}`, ...opener(item, openItem),
    },
    h('span', { class: `status-dot ${meeting ? '' : `s-${cssKey(item.fields.status || 'Backlog')}`}` }),
    h('span', {}, meeting && item.fields.time ? `${item.fields.time} ${item.title}` : kind === 'due' ? `Due · ${item.title}` : item.title));
    if (!meeting && PLANNABLE.has(item.type)) {
      el.setAttribute('draggable', 'true');
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', item.key); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
    }
    return el;
  }

  function paintCalendar(keep) {
    const month = monthNow();
    const items = state.items.filter(keep);
    const cal = monthCalendar(items, month, { plannable: (i) => PLANNABLE.has(i.type), isDone });
    const late = items.filter((i) => PLANNABLE.has(i.type) && isLate(i)).sort(byManualOrder(byPriority));
    const t = today();
    const line = (cls, lead, list, action = null) => h('div', { class: `plan-carry ${cls}` }, ...lead,
      ...list.flatMap((i, n) => [n ? h('span', { class: 'muted' }, '·') : null,
        h('button', { type: 'button', class: 'item-link', title: i.title, ...opener(i, openItem) }, i.title)].filter(Boolean)),
      action);
    const out = [];
    if (late.length && month === thisMonth()) {
      out.push(line('carried', [h('span', { class: 'plan-dot late' }), h('b', {}, 'Carried over'), h('span', { class: 'muted' }, String(late.length))], late,
        h('button', { type: 'button', class: 'btn ghost small plan-sec-btn plan-carry-act', onclick: () => updateMany(late.map((i) => [i.key, { plan_day: t, plan_week: thisWeek(), plan_month: null }])) }, 'Move all to today')));
    }
    if (cal.monthOnly.length) out.push(line('month-only', [h('b', {}, 'Anytime this month'), h('span', { class: 'muted' }, String(cal.monthOnly.length))], cal.monthOnly));
    const cells = [h('div', { class: 'mcal-dh' }, 'Week'), ...DAY_NAMES.map((d) => h('div', { class: 'mcal-dh' }, d))];
    const fill = (cell, entries, key) => {
      const { shown, more } = cellEntries(entries, { opened: opened.has(key) });
      cell.append(...shown.map(pill));
      if (more) cell.append(h('button', { type: 'button', class: 'mcal-more', onclick: () => { opened.add(key); api.update(); } }, `+${more} more`));
    };
    for (const w of cal.weeks) {
      const wk = h('div', { class: `mcal-wk ${w.current ? 'cur' : ''}`, 'aria-label': `Week ${w.week.split('-')[1]}` }, h('b', {}, w.week.split('-')[1]));
      fill(wk, w.items.map((item) => ({ item, kind: 'plan' })), w.week);
      dropZone(wk, (key) => {
        const it = find(key);
        if (it && (it.fields.plan_day || it.fields.plan_week !== w.week)) placeInPlan(it, { plan_week: w.week, plan_day: null, ...noMonth(it) }, w.items, w.items.length);
      });
      cells.push(wk);
      for (const d of w.days) {
        const cell = h('div', { class: `mcal-day ${d.out ? 'out' : ''} ${d.past ? 'past' : ''} ${d.today ? 'today' : ''}`, role: 'gridcell', 'aria-label': dayLabel(d.day) },
          h('span', { class: 'mcal-num' }, String(Number(d.day.slice(8)))));
        fill(cell, d.entries, d.day);
        const planned = d.entries.filter((e) => e.kind === 'plan').map((e) => e.item);
        dropZone(cell, (key) => {
          const it = find(key);
          if (it && it.fields.plan_day !== d.day) placeInPlan(it, { plan_day: d.day, plan_week: isoWeek(d.day), ...noMonth(it) }, planned, planned.length);
        });
        cells.push(cell);
      }
    }
    out.push(h('div', { class: 'mcal', role: 'grid', 'aria-label': monthLabel(month) }, cells));
    body.replaceChildren(...out);
  }

  function paintBoard(keep) {
    const fold = view.boardFold || {};
    const empties = view.emptyCols || 'fold';
    const b = monthBuckets(state.items.filter((i) => keep(i)), { sort: byManualOrder(byPriority) });
    const toWeek = (i) => moveNow(i, 'this week', (it) => planWeek(it, thisWeek()));
    const toToday = (i) => moveNow(i, 'today', (it) => placeInPlan(it, planFor('today', it), b.today, 0));
    const t = today();
    const cols = MONTH_HORIZONS.filter(([key]) => key !== 'carried' || b.carried.length).map(([key, title]) => {
      const items = b[key];
      const carried = key === 'carried';
      const sub = key === 'week' ? thisWeek() : key === 'nextweek' ? shiftWeek(thisWeek(), 1) : null;
      return {
        key, label: title, items, cls: `horizon-${key} ${key === 'today' ? 'now-col' : ''}`, attrs: { 'data-horizon': key }, empty: EMPTY[key] || null,
        face: [
          carried ? h('span', { class: 'plan-dot late' }) : null,
          h('span', { class: 'group-name' }, title),
          key === 'today' ? h('span', { class: 'plan-tag' }, dayLabel(t)) : null,
          sub ? h('span', { class: 'head-sub' }, sub.split('-')[1]) : null,
        ].filter(Boolean),
        aside: carried ? h('button', { type: 'button', class: 'btn ghost small plan-sec-btn', onclick: () => updateMany(items.map((i) => [i.key, { plan_week: thisWeek(), plan_day: null, ...noMonth(i) }])) }, 'Move all') : null,
        unfoldable: carried,
        card: (i) => planCard(i, {
          onOpen: openItem, plan: key !== 'today' || carriedOverDay(i),
          action: carried ? toWeek(i) : key === 'today' && carriedOverDay(i) ? toToday(i) : null,
        }),
        drop: carried ? null : (k, index) => { const it = find(k); if (it) placeInPlan(it, planFor(key, it), items, index); },
        // A new card: the column's plan, without the nulls that clear another one.
        quick: carried ? null : { type: 'task', values: Object.fromEntries(Object.entries(planFor(key, { type: 'task', fields: {} })).filter(([, v]) => v)) },
        folded: fold[key] ?? (!carried && key !== 'today' && !items.length && empties === 'fold'),
      };
    });
    const board = boardOf({ columns: cols, onFold: (k, f) => change({ boardFold: { ...fold, [k]: f } }), onOpen: openItem });
    board.classList.add('plan-board', 'month-board');
    body.replaceChildren(board);
  }

  const api = {
    update() {
      const cal = view.layout !== 'board';
      const month = monthNow();
      const nextHead = periodHead({
        period: 'month', range: monthLabel(cal ? month : thisMonth()),
        nav: cal ? { prev: go(-1), now: go(0), next: go(1), label: 'This month', away: month !== thisMonth() } : null,
      });
      head.replaceWith(nextHead);
      head = nextHead;
      vb.update();
      const keep = keepFn();
      root.classList.toggle('board-layout', !cal);
      body.classList.toggle('list-main', !cal);
      if (cal) paintCalendar(keep); else paintBoard(keep);
    },
  };
  return api;
}

/** The sidebar's count: the open items on the board. */
export const openCount = () => state.items.filter((i) => !isDone(i) && planHorizon(i)).length;
