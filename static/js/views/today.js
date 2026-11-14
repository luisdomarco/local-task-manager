// Today (docs/design.md §3 Planning; mock-up J): the items of the day — planned today, or carried over from a past
// day — under the date and how the day goes (dayline.js), with the view bar (Filter · Display · List | Board).
//
// List: Schedule (today's meetings, by time) · Carried over (each with its move to today, and "Move all to today") ·
// Today (what is planned, a line to add one), and "2 done today · Show": the closed ones wait behind it (Display →
// Show closed). Rows drag: one dropped in Today is planned for today, at that place.
// Board: columns you make yourself — Uncategorized by default, then "Morning", "Waiting"… — which organise the day and
// never change a status, and a fixed Meetings column (first, or folded last on a day without any). They are the day's
// Custom board (.task-manager/boards/today.json, customboard.js): a card keeps the column and the place it is dropped
// in there, never in its file; those never placed follow their order of the day (`plan_order`), carried over first
// and then by priority. A card planned for another day leaves its column (the server takes it off the board).
import { thisWeek, today } from '../dates.js';
import { openItem } from '../panel.js';
import { quickAddBar } from '../quickadd.js';
import { PLANNABLE, byManualOrder, carriedOverDay, isDone, isEnabled, isPlannedToday } from '../rules.js';
import { placeInPlan, planDay, state, updateMany } from '../state.js';
import { byPriority, dropZone, h, icon, linkButton } from '../ui.js';
import { daySummary } from '../dayline.js';
import { isTentative, toMinutes } from '../worktime.js';
import { boardOf, customColumns } from '../boardview.js';
import { viewBar } from '../viewbar.js';
import { filterFields, matches } from '../viewmodel.js';
import { vaultCtx } from './list.js';
import { meetingsOn, moveNow, planCard, planRow, planSection, planViewOf, sectionAction } from '../planrows.js';
import { PHONE_TOUCH } from '../phone.js';

// The layout picked before the view bar (tm-today-mode); never picked, List on a phone and Board elsewhere.
const oldMode = () => {
  let saved = null;
  try { saved = localStorage.getItem('tm-today-mode'); } catch { /* storage unavailable */ }
  if (saved === 'list' || saved === 'board') return saved;
  return typeof matchMedia === 'function' && matchMedia(`(max-width: 640px), ${PHONE_TOUCH}`).matches ? 'list' : 'board';
};
const CLOSED = [['none', 'None'], ['all', 'All']];

const toToday = (item) => moveNow(item, 'today', (i) => planDay(i, today()));

// ── board ────────────────────────────────────────────────────────────────────
/** The board: the Meetings column, then the day's own columns (its Custom board, boardview.js customColumns) and "Add a
 *  column". `sort` orders the cards never placed on it. */
function paintBoard(box, items, view, change, sort) {
  const fold = view.boardFold || {};
  const empties = view.emptyCols || 'fold';
  const meetings = meetingsOn(today());
  const meetingCol = isEnabled('meeting') && !(empties === 'hide' && !meetings.length && fold.meetings === undefined) ? {
    key: 'meetings', label: 'Meetings', cls: 'meetings-col', items: meetings, empty: 'No meetings today',
    face: [icon('users', 14), h('span', { class: 'group-name' }, 'Meetings')],
    card: (m) => planCard(m, { onOpen: openItem, draggable: false }),
    folded: fold.meetings ?? (!meetings.length && empties === 'fold'),
  } : null;
  const custom = customColumns('today', items, {
    sort, fold, cls: 'today-col', placeholder: 'Column name… (Morning, Waiting, Deep work)',
    card: (i) => planCard(i, { onOpen: openItem, plan: carriedOverDay(i), action: carriedOverDay(i) ? toToday(i) : null }),
    quick: () => ({ type: 'task', values: { plan_day: today(), plan_week: thisWeek() } }),
  });
  const lead = meetingCol && meetings.length ? [meetingCol] : [];
  const trail = meetingCol && !meetings.length ? [meetingCol] : [];
  const board = boardOf({
    columns: [...lead, ...custom.columns, ...trail],
    onFold: (k, f) => change({ boardFold: { ...fold, [k]: f } }),
    onOpen: openItem, after: custom.after, onReorder: custom.onReorder,
  });
  board.classList.add('plan-board', 'today-board');
  box.replaceChildren(board);
}

// ── list ─────────────────────────────────────────────────────────────────────
function paintList(box, { carried, planned, doneToday }, view, change) {
  const t = today();
  const meetings = meetingsOn(t);
  const rows = (items, opts = {}) => {
    const zone = h('div', { class: 'plan-rows' }, items.map((i) => planRow(i, { onOpen: openItem, ...opts.row?.(i) })));
    if (opts.drop) dropZone(zone, (key, index) => { const it = state.items.find((i) => i.key === key); if (it) opts.drop(it, index); });
    return zone;
  };
  const toTodayAt = (it, index) => placeInPlan(it, it.fields.plan_day === t ? {} : { plan_day: t, plan_week: thisWeek(), plan_month: null }, planned, index);
  box.replaceChildren(...[
    meetings.length ? h('section', { class: 'plan-block' },
      planSection({ title: 'Schedule', count: `${meetings.length} ${meetings.length === 1 ? 'meeting' : 'meetings'}` }),
      rows(meetings)) : null,
    carried.length ? h('section', { class: 'plan-block carried' },
      planSection({
        title: 'Carried over', count: carried.length, dot: 'late',
        action: sectionAction('Move all to today', () => updateMany(carried.map((i) => [i.key, { plan_day: t, plan_week: thisWeek() }]))),
      }),
      rows(carried, { row: (i) => ({ action: toToday(i) }) })) : null,
    h('section', { class: 'plan-block' },
      planSection({ title: 'Today', count: planned.length }),
      planned.length ? rows(planned, { drop: toTodayAt }) : (() => {
        const z = h('div', { class: 'plan-rows' }, h('p', { class: 'plan-line-empty' }, 'Nothing planned for today yet.'));
        dropZone(z, (key) => { const it = state.items.find((i) => i.key === key); if (it) toTodayAt(it, 0); });
        return z;
      })(),
      h('div', { class: 'plan-quick' }, quickAddBar({ values: { plan_day: t, plan_week: thisWeek() } }, { placeholder: '+ Add a task for today…' }))),
    doneToday ? h('p', { class: 'plan-closed' }, h('span', { class: 'plan-dot' }),
      `${doneToday} done today ·`,
      linkButton(view.closed === 'none' ? 'Show' : 'Hide', () => change({ closed: view.closed === 'none' ? 'all' : 'none' }), { muted: true, attrs: { 'aria-pressed': String(view.closed !== 'none') } })) : null,
  ].filter(Boolean));
}

export function mount(root) {
  const { view, save } = planViewOf('today', { closed: 'none', layout: oldMode() });
  const types = () => [...PLANNABLE];
  const fields = () => filterFields(types(), vaultCtx());
  const ofDay = () => state.items.filter((i) => PLANNABLE.has(i.type) && (isPlannedToday(i) || carriedOverDay(i)));
  const change = (patch) => { Object.assign(view, patch); save(); api.update(); };
  const dayLine = h('span', { class: 'day-line' });
  const body = h('div', { class: 'plan-list today-list' });
  const vb = viewBar({
    view, save, fields, ctx: vaultCtx, items: ofDay, closable: true, closedModes: CLOSED, closedDefault: 'none', search: false,
    layout: { current: () => view.layout, pick: (l) => change({ layout: l }) },
    onText: () => {}, onChange: () => api.update(),
  });
  root.replaceChildren(
    h('header', { class: 'view-head row today-head-row' },
      h('div', { class: 'today-head' }, h('h1', {}, 'Today'), dayLine),
      h('span', { class: 'spacer' })), // no Add: the day's quick add is under its list
    vb.bar, vb.chips, body);
  const api = {
    update() {
      // The date, then how the day goes in words (dayline.js): done of planned, time logged, the next meeting.
      const t = today();
      const day = ofDay();
      const minutes = state.worklog.filter((e) => e.date === t && !isTentative(e)).reduce((n, e) => n + toMinutes(e.time), 0);
      const now = new Date();
      const parts = daySummary({
        planned: day.map((i) => ({ done: isDone(i) })), minutes,
        meetings: meetingsOn(t).map((m) => ({ time: m.fields.time || '', title: m.title })),
        now: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      });
      dayLine.replaceChildren(now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
        ...parts.map((p) => h('span', { class: 'day-part' }, p)));
      vb.update();
      const fs = fields();
      const ctx = vaultCtx();
      const shown = day.filter((i) => matches(i, view.filters, fs, ctx));
      const open = (i) => view.closed !== 'none' || !isDone(i);
      const sort = byManualOrder((a, b) => carriedOverDay(b) - carriedOverDay(a) || byPriority(a, b));
      root.classList.toggle('board-layout', view.layout === 'board');
      body.classList.toggle('list-main', view.layout === 'board'); // the board takes the height left (app.css)
      if (view.layout === 'board') { paintBoard(body, shown.filter(open), view, change, sort); return; }
      paintList(body, {
        carried: shown.filter(carriedOverDay).sort(byManualOrder(byPriority)),
        planned: shown.filter((i) => isPlannedToday(i) && open(i)).sort(byManualOrder(byPriority)),
        doneToday: shown.filter((i) => isPlannedToday(i) && isDone(i)).length,
      }, view, change);
    },
  };
  return api;
}
