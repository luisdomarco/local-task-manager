// Week and Next week, the same view on two weeks: this one (with Previous / Next to move through the others) and the
// next one, fixed. Three layouts, each remembered per view (TSK-043): List, an agenda (a section per day, Mon…Sun, with
// full-width cards); Board, a column per day side by side; and Free board, columns of your own like Today's (Waiting,
// Deep work…), one set shared by both views so a card keeps its column when it moves to another week (`week_list`,
// columns in <root>/.task-manager/week.md). List and Board have "Anytime this week" for items planned for the week
// but not a day, and, on this week, what was carried over from earlier weeks; the Free board holds all of them and shows
// each card's day. Drag a card onto a day to plan it there (onto Anytime to keep the week and clear the day); on the Free
// board a drop only changes its column, never its day. What goes where is rules.js weekBuckets, the same for all three.
// The board can be kept to some weekdays (remembered too; Carried over and Anytime always show). Cards keep the order
// you drop them in (TSK-053: `plan_order` by day, `week_order` on the Free board); those never placed follow, by priority.
import { openCreateModal } from '../create.js';
import { dayLabel, isoWeek, shiftWeek, thisWeek, today, weekLabel } from '../dates.js';
import { addListColumn, listDropZone, listHeader, moveEntries, moveList, startRename } from '../kanban.js';
import { openItem } from '../panel.js';
import { quickAddBar } from '../quickadd.js';
import { byManualOrder, isDone, pickDays, weekBuckets } from '../rules.js';
import {
  TODAY_DEFAULT, noMonth, placeInPlan, placeInWeekList, planWeek, saveWeekLists, slugId, state, updateMany, weekListOf,
} from '../state.js';
import { byPriority, checkSelect, dropZone, dropdown, h, icon, itemCard } from '../ui.js';
import { isTentative } from '../worktime.js';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MODES = [['list', 'text', 'List'], ['board', 'kanban', 'Board'], ['free', 'columns', 'Free board']];
const find = (key) => state.items.find((i) => i.key === key);

/** One agenda section: heading, its cards (a drop target), and a quick add for that slot. */
function section(title, items, onDrop, { cls = '', meta = null, qaValues, qaPlaceholder } = {}) {
  const zone = h('div', { class: 'cards agenda-cards' },
    items.length ? items.map((i) => itemCard(i, { onOpen: openItem, draggable: true }))
      : h('div', { class: 'agenda-empty' }, 'Nothing here — drop a card or add one below'));
  dropZone(zone, (key, index) => { const it = find(key); if (it) onDrop(it, index); });
  const open = items.filter((i) => !isDone(i)).length;
  return h('section', { class: `agenda-day ${cls}` },
    h('header', { class: 'agenda-head' },
      h('h3', {}, title), meta,
      h('span', { class: 'count' }, open || '')),
    zone,
    quickAddBar({ values: qaValues }, { placeholder: qaPlaceholder }));
}

/** One board column: its name, its open count, its cards (a drop target unless `onDrop` is null), and a quick add. */
function column(title, items, onDrop, { cls = '', meta = null, qaValues = null, extraFor = null } = {}) {
  const zone = h('div', { class: 'col-cards' }, items.map((i) => itemCard(i, { onOpen: openItem, draggable: true, extra: extraFor?.(i) })));
  if (onDrop) dropZone(zone, (key, index) => { const it = find(key); if (it) onDrop(it, index); });
  const open = items.filter((i) => !isDone(i)).length;
  return h('section', { class: `board-col week-col ${cls}`, 'aria-label': `${title} column` },
    h('header', { class: 'list-head week-col-head' }, h('h3', { class: 'list-name' }, title), meta, h('span', { class: 'count' }, open || '')),
    zone,
    qaValues ? quickAddBar({ type: 'task', values: qaValues }, { placeholder: '+ Add a card' }) : null);
}

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

function freeColumn(list, idx, items, week, extraFor) {
  const zone = h('div', { class: 'col-cards' },
    items.map((i) => itemCard(i, { onOpen: openItem, draggable: true, showPlan: true, extra: extraFor(i) })));
  dropZone(zone, (key, index) => { const it = find(key); if (it) placeInWeekList(it, list.id, items, index); });
  const open = items.filter((i) => !isDone(i)).length;
  return h('section', { class: `board-col today-col free-col ${list.id === TODAY_DEFAULT ? 'default' : ''}`, 'data-list': list.id, 'aria-label': `${list.name} column` },
    listHeader({
      list, idx, count: open || '', countTitle: `${open} open`,
      menu: (anchor, nameEl) => freeListMenu(anchor, list, idx, nameEl),
      onRename: (v) => editLists((ls) => { ls[idx].name = v; }),
    }),
    zone,
    quickAddBar({ type: 'task', values: { plan_week: week, ...(list.id === TODAY_DEFAULT ? {} : { week_list: list.id }) } },
      { placeholder: '+ Add a card' }));
}

function renderFree(free, b, week, extraFor) {
  const items = [...b.carried, ...b.anytime, ...b.days.flatMap((d) => b.byDay[d])].sort(byManualOrder(byPriority, 'week_order'));
  const placed = new Map(state.weekBoard.lists.map((l) => [l.id, []]));
  for (const it of items) placed.get(weekListOf(it)?.id ?? TODAY_DEFAULT)?.push(it);
  free.replaceChildren(
    ...state.weekBoard.lists.map((l, i) => freeColumn(l, i, placed.get(l.id) || [], week, extraFor)),
    addListColumn({
      label: 'Add a column', placeholder: 'Column name… (Waiting, Deep work, Errands)',
      onAdd: (name) => editLists((ls) => ls.push({ id: slugId(name, ls.map((l) => l.id)), name })),
    }));
}

/**
 * The view for one week: `offset` 0 is this week, which Previous / Next move away from (`nav`); 1 is next week, fixed.
 * Each keeps its own layout and day filter (`tm-<name>-mode`, `tm-<name>-days`).
 */
function weekView({ name, title, offset, nav }) {
  const MODE_KEY = `tm-${name}-mode`;
  const DAYS_KEY = `tm-${name}-days`;
  const readMode = () => { try { const m = localStorage.getItem(MODE_KEY); return MODES.some(([k]) => k === m) ? m : 'list'; } catch { return 'list'; } };
  // The weekdays the board shows, 0 = Mon … 6 = Sun; none = all.
  const readDays = () => { try { const v = JSON.parse(localStorage.getItem(DAYS_KEY)); return Array.isArray(v) ? v.filter((n) => WEEKDAYS[n]) : []; } catch { return []; } };
  let mode = readMode();
  let boardDays = readDays();
  let shift = 0; // weeks away from this view's own (Week only)
  let hideDone = false;
  let seekToday = true; // the board scrolls to today's column once: on opening, switching to it, or changing week

  return function mount(root) {
    const weekNow = () => shiftWeek(thisWeek(), offset + shift);
    const agenda = h('div', { class: 'agenda' });
    const board = h('div', { class: 'board week-board' });
    const free = h('div', { class: 'board today-board week-free' });
    listDropZone(free, (from, to) => editLists((ls) => moveList(ls, from, to)));
    const label = h('span', { class: 'week-label' });
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Layout' });
    const doneToggle = h('label', { class: 'toggle' },
      h('input', { type: 'checkbox', checked: hideDone, onchange: (e) => { hideDone = e.target.checked; api.update(); } }), 'Hide closed');
    const dayFilter = checkSelect(WEEKDAYS.map((day, n) => [n, day]), boardDays, (picked) => {
      boardDays = picked;
      try { localStorage.setItem(DAYS_KEY, JSON.stringify(picked)); } catch { /* fine */ }
      api.update();
    }, { any: 'All days', text: (p) => (p.length <= 3 ? p.map((n) => WEEKDAYS[n].slice(0, 3)).join(', ') : `${p.length} days`), class: 'small', 'aria-label': 'Days shown' });
    const go = (n) => () => { shift = n === 0 ? 0 : shift + n; seekToday = true; api.update(); };
    const addTask = () => {
      const week = weekNow();
      const plan = week === thisWeek() ? 'week' : week === shiftWeek(thisWeek(), 1) ? 'nextweek' : week;
      openCreateModal('task', { plan }, { fixedType: true });
    };
    seekToday = true;
    root.replaceChildren(
      h('header', { class: 'view-head row' }, h('h1', {}, title),
        h('div', { class: 'week-nav' },
          nav ? [
            h('button', { class: 'btn small', onclick: go(-1), title: 'Previous week' }, icon('left', 14)),
            h('button', { class: 'btn small', onclick: go(0) }, 'This week'),
            h('button', { class: 'btn small', onclick: go(1), title: 'Next week' }, icon('right', 14)),
          ] : null,
          label),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn primary', onclick: addTask }, icon('plus', 16), 'Add task')),
      h('div', { class: 'toolbar' }, seg, dayFilter, doneToggle),
      agenda, board, free);

    const api = {
      update() {
        const week = weekNow();
        label.textContent = weekLabel(week);
        seg.replaceChildren(...MODES.map(([m, ico, text]) => h('button', {
          class: `btn small ${mode === m ? 'active' : ''}`, 'aria-pressed': String(mode === m),
          onclick: () => { mode = m; seekToday = true; try { localStorage.setItem(MODE_KEY, m); } catch { /* fine */ } api.update(); },
        }, icon(ico, 14), text)));
        agenda.hidden = mode !== 'list';
        board.hidden = mode !== 'board';
        free.hidden = mode !== 'free';
        dayFilter.hidden = mode !== 'board';
        const b = weekBuckets(state.items, week, { hideDone, sort: byManualOrder(byPriority) });
        const toWeek = (i) => planWeek(i, week);
        const toThisWeek = (i) => h('button', { class: 'btn small', onclick: () => toWeek(i) }, '→ This week');
        // On the board's narrow column, an icon (its name in the tooltip) leaves the title room.
        const toThisWeekIcon = (i) => h('button', { class: 'btn icon small', title: 'Move to this week', 'aria-label': `Move ${i.title} to this week`,
          onclick: () => toWeek(i) }, icon('arrow', 14));
        if (mode === 'free') {
          // Carried-over cards stay in their column, with the same one-click move to this week.
          renderFree(free, b, week, (i) => (b.carried.includes(i) ? toThisWeekIcon(i) : null));
          return;
        }
        // A card dropped on a day (or on Anytime) is planned there, at the place it was dropped.
        const toDay = (d) => (it, index) => placeInPlan(it, it.fields.plan_day === d ? {} : { plan_day: d, plan_week: isoWeek(d), ...noMonth(it) },
          b.byDay[d], index);
        const toAnytime = (it, index) => placeInPlan(it, !it.fields.plan_day && it.fields.plan_week === week ? {}
          : { plan_week: week, plan_day: null, ...noMonth(it) }, b.anytime, index);
        const logged = (d) => state.worklog.filter((e) => e.date === d && !isTentative(e)).length;
        const dayMeta = (d) => [
          d === today() ? h('span', { class: 'chip plan today' }, 'Today') : null,
          logged(d) ? h('span', { class: 'muted small', title: 'Work log entries' }, icon('clock', 11), ` ${logged(d)}`) : null,
        ];
        const dayCls = (d) => `${d === today() ? 'today' : ''} ${d < today() ? 'past' : ''}`;

        if (mode === 'board') {
          board.replaceChildren(...[
            b.carried.length ? column('Carried over', b.carried, null, { cls: 'warn', extraFor: toThisWeekIcon }) : null,
            column('Anytime', b.anytime, toAnytime, { cls: 'anytime', qaValues: { plan_week: week } }),
            ...pickDays(b.days, boardDays).map((d) => column(dayLabel(d), b.byDay[d], toDay(d),
              { cls: dayCls(d), meta: dayMeta(d), qaValues: { plan_day: d, plan_week: week } })),
          ].filter(Boolean));
          const todayCol = seekToday && board.querySelector('.week-col.today');
          // Just enough for today to show: Carried over and Anytime stay in view when it fits beside them.
          if (todayCol) board.scrollLeft = Math.max(0, todayCol.offsetLeft - board.offsetLeft + todayCol.offsetWidth + 24 - board.clientWidth);
          seekToday = false;
          return;
        }
        agenda.replaceChildren(...[
          b.carried.length ? h('section', { class: 'agenda-day warn' },
            h('header', { class: 'agenda-head' }, h('h3', {}, 'Carried over from previous weeks'), h('span', { class: 'count' }, b.carried.length)),
            h('div', { class: 'cards agenda-cards' }, b.carried.map((i) => itemCard(i, { onOpen: openItem, draggable: true, extra: toThisWeek(i) })))) : null,
          section('Anytime this week', b.anytime, toAnytime, {
            cls: 'anytime', qaValues: { plan_week: week }, qaPlaceholder: 'Add to this week, any day…',
          }),
          ...b.days.map((d) => section(dayLabel(d), b.byDay[d], toDay(d), {
            cls: dayCls(d), meta: dayMeta(d), qaValues: { plan_day: d, plan_week: week }, qaPlaceholder: `Add a task for ${dayLabel(d)}…`,
          })),
        ].filter(Boolean));
      },
    };
    return api;
  };
}

export const mount = weekView({ name: 'week', title: 'Week', offset: 0, nav: true });
export const nextWeek = { mount: weekView({ name: 'nextweek', title: 'Next week', offset: 1, nav: false }) };
