// Week (docs/design.md §3 Planning; mock-ups H and H2): one week, this one to start with, moved with ‹ This week › in
// Planning's head (#/nextweek opens it one week on). The view bar: search, Filter, "3 of 7 done", Display (Show closed;
// on the board, Empty columns and the days shown) and List | Board | Free board, each remembered (prefs `plan.week`).
//
// List, an agenda: Carried over from earlier weeks (this week only: each with its move, and "Move all to this week") ·
// Anytime this week · a section per day — past days grey, today's line dark with its tag, a day's meetings at their
// time — where days with nothing share one line ("Tue 10 · Wed 11  Nothing planned"), and under this week a line to
// the next one. Board: a column per day beside Carried over and Anytime, past days and empty ones folded into strips
// (Display → Empty columns), today's a little wider. Free board: columns of your own like Today's (Waiting, Deep
// work…), one set shared by every week so a card keeps its column when it moves to another week (`week_list`, columns
// in <root>/.task-manager/week.md); a drop there only changes its column, never its day.
// Drag a row or card onto a day to plan it there, onto Anytime to keep the week and clear the day. What goes where is
// rules.js weekBuckets, the same for all three. Cards and rows keep the order you drop them in (TSK-053: `plan_order` by
// day, `week_order` on the Free board); those never placed follow, by priority.
import { dayLabel, isoWeek, shiftWeek, thisWeek, today, weekLabel } from '../dates.js';
import { addListColumn, listHeader, moveEntries, moveList, startRename } from '../kanban.js';
import { openItem } from '../panel.js';
import { quickAddBar } from '../quickadd.js';
import { PLANNABLE, byManualOrder, isDone, pickDays, weekBuckets } from '../rules.js';
import {
  TODAY_DEFAULT, noMonth, placeInPlan, placeInWeekList, planWeek, saveWeekLists, slugId, state, updateMany, weekListOf,
} from '../state.js';
import { byPriority, checkSelect, dropZone, dropdown, h, icon } from '../ui.js';
import { boardOf } from '../boardview.js';
import { viewBar } from '../viewbar.js';
import { filterFields, matches } from '../viewmodel.js';
import { idMatches } from '../shownid.js';
import { vaultCtx } from './list.js';
import {
  emptySlot, meetingsOn, moveNow, nextWeekLine, periodHead, planCard, planRow, planSection, planViewOf, sectionAction,
} from '../planrows.js';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const LAYOUTS = [['list', 'List', 'list'], ['board', 'Board', 'kanban'], ['free', 'Free board', 'columns']];
const CLOSED = [['none', 'None'], ['all', 'All']];
const find = (key) => state.items.find((i) => i.key === key);

// ── Free board: the week's cards in columns of your own ─────────────────────
function editLists(fn) {
  const next = state.weekBoard.lists.map((l) => ({ ...l }));
  fn(next);
  return saveWeekLists(next).catch(() => {});
}

/** Deleting a column sends its cards (of any week) to Uncategorized first, so a column made later under the same name starts empty. */
async function deleteColumn(list, idx) {
  const cards = state.all.filter((i) => i.fields.week_list === list.id);
  if (cards.length) await updateMany(cards.map((i) => [i.key, { week_list: null, week_order: null }])).catch(() => {});
  return editLists((ls) => ls.splice(idx, 1));
}

function freeListMenu(anchor, list, idx, nameEl) {
  dropdown(anchor, [
    { heading: list.name },
    { label: 'Rename', icon: 'pencil', onSelect: () => startRename(nameEl, list.name, (v) => editLists((ls) => { ls[idx].name = v; })) },
    ...moveEntries(idx, state.weekBoard.lists.length - 1, (from, to) => editLists((ls) => moveList(ls, from, to))),
    '-',
    list.id === TODAY_DEFAULT
      ? { label: 'Default column — cannot be deleted', icon: 'inbox', onSelect: () => {} }
      : { label: 'Delete column (its cards go to Uncategorized)', icon: 'trash', danger: true, onSelect: () => deleteColumn(list, idx) },
  ], { width: 300 });
}

/** The read-only old layout (tm-<name>-mode) and day filter (tm-<name>-days) of before the view bar. */
function oldPrefs(name) {
  let mode = null;
  let days = [];
  try { mode = localStorage.getItem(`tm-${name}-mode`); } catch { /* none */ }
  try { const v = JSON.parse(localStorage.getItem(`tm-${name}-days`)); if (Array.isArray(v)) days = v.filter((n) => WEEKDAYS[n]); } catch { /* none */ }
  return { layout: LAYOUTS.some(([k]) => k === mode) ? mode : 'list', days };
}

/** The view for a week: `offset` 0 opens this week, 1 the next (#/nextweek); ‹ › move from there. */
function weekView({ offset }) {
  return function mount(root) {
    const { view, save } = planViewOf('week', { closed: 'all', ...oldPrefs('week') });
    if (!Array.isArray(view.days)) view.days = [];
    let shift = 0; // weeks away from where this view opened
    let text = '';
    let seekToday = true; // the board scrolls to today's column once: on opening, switching to it, or changing week
    const weekNow = () => shiftWeek(thisWeek(), offset + shift);
    const change = (patch) => { Object.assign(view, patch); save(); api.update(); };
    const go = (n) => () => { shift = n === 0 ? -offset : shift + n; seekToday = true; api.update(); };
    let head = h('header', { class: 'view-head row period-head' });
    const body = h('div', { class: 'plan-list week-list' });
    const note = h('span', {});
    const fields = () => filterFields([...PLANNABLE], vaultCtx());
    const inWeek = () => {
      const b = weekBuckets(state.items, weekNow());
      return [...b.carried, ...b.anytime, ...b.days.flatMap((d) => b.byDay[d])];
    };
    const vb = viewBar({
      view, save, fields, ctx: vaultCtx, items: inWeek, closable: true, closedModes: CLOSED, closedDefault: 'all', note,
      placeholder: 'Search this week…',
      layout: { current: () => view.layout, pick: (l) => { seekToday = true; change({ layout: l }); }, options: LAYOUTS, isBoard: () => view.layout !== 'list' },
      displayRows: () => (view.layout === 'board' ? [h('div', { class: 'vb-row' }, h('span', {}, 'Days'),
        checkSelect(WEEKDAYS.map((day, n) => [n, day]), view.days, (picked) => change({ days: picked }),
          { any: 'All days', text: (p) => (p.length <= 3 ? p.map((n) => WEEKDAYS[n].slice(0, 3)).join(', ') : `${p.length} days`), class: 'small', 'aria-label': 'Days shown' }))] : []),
      onReset: () => { view.days = []; },
      onText: (t) => { text = t; api.update(); },
      onChange: () => api.update(),
    });
    root.replaceChildren(head, vb.bar, vb.chips, body);

    const api = {
      update() {
        const week = weekNow();
        const away = week !== thisWeek();
        const nextHead = periodHead({
          period: 'week', range: weekLabel(week),
          nav: { prev: go(-1), now: go(0), next: go(1), label: 'This week', away },
        });
        head.replaceWith(nextHead);
        head = nextHead;
        vb.update();
        const fs = fields();
        const ctx = vaultCtx();
        const q = text.toLowerCase();
        const keep = (i) => matches(i, view.filters, fs, ctx) && (!q || idMatches(i, q) || i.title.toLowerCase().includes(q));
        const hideDone = view.closed === 'none';
        const all = weekBuckets(state.items.filter(keep), week, { sort: byManualOrder(byPriority) });
        const planned = [...all.anytime, ...all.days.flatMap((d) => all.byDay[d])];
        note.textContent = planned.length ? `${planned.filter(isDone).length} of ${planned.length} done` : '';
        const b = weekBuckets(state.items.filter(keep), week, { hideDone, sort: byManualOrder(byPriority) });
        // Meetings show on their day while nothing narrows the week (a filter is about the work).
        const meetingsOf = (d) => (view.filters.length ? [] : meetingsOn(d).filter((m) => !q || m.title.toLowerCase().includes(q)));
        const toThisWeek = (i) => moveNow(i, 'this week', (it) => planWeek(it, week));
        const moveAll = () => updateMany(b.carried.map((i) => [i.key, { plan_week: week, plan_day: null, ...noMonth(i) }]));
        // A card dropped on a day (or on Anytime) is planned there, at the place it was dropped.
        const toDay = (d) => (it, index) => placeInPlan(it, it.fields.plan_day === d ? {} : { plan_day: d, plan_week: isoWeek(d), ...noMonth(it) },
          b.byDay[d], index);
        const toAnytime = (it, index) => placeInPlan(it, !it.fields.plan_day && it.fields.plan_week === week ? {}
          : { plan_week: week, plan_day: null, ...noMonth(it) }, b.anytime, index);
        root.classList.toggle('board-layout', view.layout !== 'list');
        body.classList.toggle('list-main', view.layout !== 'list');
        if (view.layout === 'free') { paintFree(b, week, toThisWeek); return; }
        if (view.layout === 'board') { paintBoard(b, week, { toDay, toAnytime, toThisWeek, moveAll, meetingsOf }); return; }
        paintAgenda(b, week, { toDay, toAnytime, toThisWeek, moveAll, meetingsOf });
      },
    };

    /** A day's few words: open ones, else how many are done; and its meetings. */
    const dayCount = (items, meetings) => [
      items.filter((i) => !isDone(i)).length || (items.length ? `${items.length} done` : ''),
      meetings.length ? `${meetings.length} ${meetings.length === 1 ? 'meeting' : 'meetings'}` : '',
    ].filter(Boolean).join(' · ');

    function rowsZone(items, onDrop, opts = {}) {
      const zone = h('div', { class: 'plan-rows' }, items.map((i) => planRow(i, { onOpen: openItem, ...(opts.row?.(i) || {}) })));
      if (onDrop) dropZone(zone, (key, index) => { const it = find(key); if (it) onDrop(it, index); });
      return zone;
    }

    /** A slot's quick add, shown from its head's "+" (and focused). */
    function quickFor(values, placeholder) {
      const box = h('div', { class: 'plan-quick', hidden: true }, quickAddBar({ values }, { placeholder }));
      const add = h('button', {
        type: 'button', class: 'btn icon small plan-add', title: placeholder, 'aria-label': placeholder,
        onclick: () => { box.hidden = !box.hidden; if (!box.hidden) box.querySelector('input')?.focus(); },
      }, icon('plus', 14));
      return { box, add };
    }

    function paintAgenda(b, week, { toDay, toAnytime, toThisWeek, moveAll, meetingsOf }) {
      const t = today();
      const out = [];
      const opened = new Set(api.openSlots || []);
      const openSlot = (d) => { api.openSlots = [...opened, d]; api.update(); };
      if (b.carried.length) {
        out.push(h('section', { class: 'plan-block carried' },
          planSection({ title: 'Carried over', count: b.carried.length, dot: 'late', action: sectionAction('Move all to this week', moveAll) }),
          rowsZone(b.carried, null, { row: (i) => ({ action: toThisWeek(i) }) })));
      }
      const anyName = week === thisWeek() ? 'Anytime this week' : 'Anytime that week';
      const anyQ = quickFor({ plan_week: week }, 'Add to this week, any day…');
      if (b.anytime.length || opened.has('anytime')) {
        if (!b.anytime.length) anyQ.box.hidden = false;
        out.push(h('section', { class: 'plan-block anytime' },
          planSection({ title: anyName, count: b.anytime.filter((i) => !isDone(i)).length || '', action: anyQ.add }),
          rowsZone(b.anytime, toAnytime), anyQ.box));
      } else {
        // Empty, one line as an empty day's: its name takes a drop, and a click adds to it.
        const slot = h('button', { type: 'button', class: 'plan-slot', title: 'Add to this week, any day', onclick: () => openSlot('anytime') }, anyName);
        dropZone(slot, (key) => { const it = find(key); if (it) toAnytime(it, 0); });
        out.push(emptySlot([slot]));
      }
      // Days with nothing (no item, no meeting) in a row share one line; each name takes a drop, and a click adds to it.
      let run = [];
      const flush = () => {
        if (!run.length) return;
        const names = [];
        run.forEach((d, n) => {
          if (n) names.push(h('span', { class: 'sep' }, '·'));
          const slot = h('button', { type: 'button', class: 'plan-slot', title: `Add a task for ${dayLabel(d)}`,
            onclick: () => { openSlot(d); } }, dayLabel(d));
          dropZone(slot, (key) => { const it = find(key); if (it) toDay(d)(it, 0); });
          names.push(slot);
        });
        out.push(emptySlot(names));
        run = [];
      };
      for (const d of b.days) {
        const items = b.byDay[d];
        const meetings = meetingsOf(d);
        if (!items.length && !meetings.length && !opened.has(d) && d !== t) { run.push(d); continue; }
        flush();
        const q = quickFor({ plan_day: d, plan_week: week }, `Add a task for ${dayLabel(d)}…`);
        if (opened.has(d) && !items.length) q.box.hidden = false;
        out.push(h('section', { class: 'plan-block day' },
          planSection({
            title: dayLabel(d), count: dayCount(items, meetings), cls: d === t ? 'today' : d < t ? 'past' : '',
            tag: d === t ? 'Today' : null, action: q.add,
          }),
          meetings.length ? h('div', { class: 'plan-rows' }, meetings.map((m) => planRow(m, { onOpen: openItem }))) : null,
          items.length || meetings.length ? rowsZone(items, toDay(d)) : (() => {
            const z = rowsZone([], toDay(d));
            if (q.box.hidden) z.append(h('p', { class: 'plan-line-empty' }, 'Nothing planned'));
            return z;
          })(),
          q.box));
      }
      flush();
      if (week === thisWeek()) out.push(nextWeekLine(state.items));
      body.replaceChildren(...out);
      const focus = api.openSlots?.length && body.querySelector('.plan-quick:not([hidden]) input');
      if (focus) { focus.focus(); api.openSlots = []; }
    }

    function paintBoard(b, week, { toDay, toAnytime, toThisWeek, moveAll, meetingsOf }) {
      const t = today();
      const fold = view.boardFold || {};
      const empties = view.emptyCols || 'fold';
      const onFold = (k, f) => change({ boardFold: { ...fold, [k]: f } });
      const cols = [];
      if (b.carried.length) {
        cols.push({
          key: 'carried', label: 'Carried over', items: b.carried, cls: 'carried-col', unfoldable: true,
          face: [h('span', { class: 'plan-dot late' }), h('span', { class: 'group-name' }, 'Carried over')],
          aside: h('button', { type: 'button', class: 'btn ghost small plan-sec-btn', onclick: moveAll }, 'Move all'),
          card: (i) => planCard(i, { onOpen: openItem, action: toThisWeek(i) }), folded: false,
        });
      }
      cols.push({
        key: 'anytime', label: 'Anytime', items: b.anytime, cls: 'anytime-col',
        face: [h('span', { class: 'group-name' }, week === thisWeek() ? 'Anytime this week' : 'Anytime')],
        card: (i) => planCard(i, { onOpen: openItem }), drop: (key, index) => { const it = find(key); if (it) toAnytime(it, index); },
        quick: { type: 'task', values: { plan_week: week } }, folded: fold.anytime ?? (!b.anytime.length && empties === 'fold'),
      });
      for (const d of pickDays(b.days, view.days)) {
        const items = b.byDay[d];
        const meetings = meetingsOf(d);
        const empty = !items.length && !meetings.length;
        if (empty && empties === 'hide' && fold[d] === undefined && d !== t) continue;
        cols.push({
          key: d, label: dayLabel(d), items, cls: `day-col ${d === t ? 'now-col' : ''} ${d < t ? 'past' : ''}`,
          face: [h('span', { class: 'group-name' }, dayLabel(d)), d === t ? h('span', { class: 'plan-tag' }, 'Today') : null].filter(Boolean),
          lead: meetings.map((m) => planCard(m, { onOpen: openItem, draggable: false })),
          card: (i) => planCard(i, { onOpen: openItem }), drop: (key, index) => { const it = find(key); if (it) toDay(d)(it, index); },
          quick: { type: 'task', values: { plan_day: d, plan_week: week } },
          folded: fold[d] ?? (d !== t && (d < t || (empty && empties === 'fold'))),
        });
      }
      const board = boardOf({ columns: cols, onFold, onOpen: openItem });
      board.classList.add('plan-board', 'week-board');
      body.replaceChildren(board);
      const todayCol = seekToday && board.querySelector('.now-col');
      // Just enough for today to show: Carried over and Anytime stay in view when it fits beside them.
      if (todayCol) board.scrollLeft = Math.max(0, todayCol.offsetLeft - board.offsetLeft + todayCol.offsetWidth + 24 - board.clientWidth);
      seekToday = false;
    }

    function paintFree(b, week, toThisWeek) {
      const items = [...b.carried, ...b.anytime, ...b.days.flatMap((d) => b.byDay[d])].sort(byManualOrder(byPriority, 'week_order'));
      const placed = new Map(state.weekBoard.lists.map((l) => [l.id, []]));
      for (const it of items) placed.get(weekListOf(it)?.id ?? TODAY_DEFAULT)?.push(it);
      const fold = view.freeFold || {};
      const cols = state.weekBoard.lists.map((list, idx) => {
        const its = placed.get(list.id) || [];
        const open = its.filter((i) => !isDone(i)).length;
        return {
          key: list.id, label: list.name, items: its, attrs: { 'data-list': list.id }, cls: `free-col ${list.id === TODAY_DEFAULT ? 'default' : ''}`,
          face: [h('span', { class: 'group-name' }, list.name)],
          head: listHeader({
            list, idx, count: open || '', countTitle: `${open} open`,
            menu: (anchor, nameEl) => freeListMenu(anchor, list, idx, nameEl),
            onRename: (v) => editLists((ls) => { ls[idx].name = v; }),
          }),
          card: (i) => planCard(i, { onOpen: openItem, plan: true, action: b.carried.includes(i) ? toThisWeek(i) : null }),
          drop: (key, index) => { const it = find(key); if (it) placeInWeekList(it, list.id, its, index); },
          quick: { type: 'task', values: { plan_week: week, ...(list.id === TODAY_DEFAULT ? {} : { week_list: list.id }) } },
          folded: fold[list.id] ?? false,
        };
      });
      const board = boardOf({
        columns: cols, onFold: (k, f) => change({ freeFold: { ...fold, [k]: f } }), onOpen: openItem,
        after: addListColumn({
          label: 'Add a column', placeholder: 'Column name… (Waiting, Deep work, Errands)',
          onAdd: (name) => editLists((ls) => ls.push({ id: slugId(name, ls.map((l) => l.id)), name })),
        }),
        onReorder: (from, to) => editLists((ls) => moveList(ls, from, to)),
      });
      board.classList.add('plan-board', 'free-board');
      body.replaceChildren(board);
    }
    return api;
  };
}

export const mount = weekView({ offset: 0 });
export const nextWeek = { mount: weekView({ offset: 1 }) };
