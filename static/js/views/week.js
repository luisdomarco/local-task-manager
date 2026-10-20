// Week, as an agenda (List: a section per day, Mon…Sun, with full-width cards) or as a board (Board: a column per day,
// side by side), the choice remembered like Today's (TSK-043). Both have "Anytime this week" for items planned for the
// week but not a day, and, on this week, what was carried over from earlier weeks. Drag a card onto a day to plan it
// there (onto Anytime to keep the week and clear the day); each day has its own quick add. What goes where is
// rules.js weekBuckets, the same for both. The board can be kept to some weekdays (remembered too; Carried over and
// Anytime always show). Cards keep the order you drop them in, in both (TSK-053: `plan_order`); those never placed follow,
// by priority.
import { openCreateModal } from '../create.js';
import { dayLabel, isoWeek, shiftWeek, thisWeek, today, weekLabel } from '../dates.js';
import { openItem } from '../panel.js';
import { quickAddBar } from '../quickadd.js';
import { byManualOrder, isDone, pickDays, weekBuckets } from '../rules.js';
import { placeInPlan, planWeek, state } from '../state.js';
import { byPriority, checkSelect, dropZone, h, icon, itemCard } from '../ui.js';

const MODE_KEY = 'tm-week-mode';
const readMode = () => { try { return localStorage.getItem(MODE_KEY) === 'board' ? 'board' : 'list'; } catch { return 'list'; } };
let mode = readMode();
const DAYS_KEY = 'tm-week-days';
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// The weekdays the board shows, 0 = Mon … 6 = Sun; none = all.
const readDays = () => { try { const v = JSON.parse(localStorage.getItem(DAYS_KEY)); return Array.isArray(v) ? v.filter((n) => WEEKDAYS[n]) : []; } catch { return []; } };
let boardDays = readDays();
let week = thisWeek();
let hideDone = false;
let seekToday = true; // the board scrolls to today's column once: on opening, switching to it, or changing week

const find = (key) => state.items.find((i) => i.key === key);
const toThisWeek = (i) => h('button', { class: 'btn small', onclick: () => planWeek(i, week) }, '→ This week');
// On the board's narrow column, an icon (its name in the tooltip) leaves the title room.
const toThisWeekIcon = (i) => h('button', { class: 'btn icon small', title: 'Move to this week', 'aria-label': `Move ${i.title} to this week`,
  onclick: () => planWeek(i, week) }, icon('arrow', 14));

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

export function mount(root) {
  const agenda = h('div', { class: 'agenda' });
  const board = h('div', { class: 'board week-board' });
  const label = h('span', { class: 'week-label' });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Layout' });
  const doneToggle = h('label', { class: 'toggle' },
    h('input', { type: 'checkbox', checked: hideDone, onchange: (e) => { hideDone = e.target.checked; api.update(); } }), 'Hide closed');
  const dayFilter = checkSelect(WEEKDAYS.map((name, n) => [n, name]), boardDays, (picked) => {
    boardDays = picked;
    try { localStorage.setItem(DAYS_KEY, JSON.stringify(picked)); } catch { /* fine */ }
    api.update();
  }, { any: 'All days', text: (p) => (p.length <= 3 ? p.map((n) => WEEKDAYS[n].slice(0, 3)).join(', ') : `${p.length} days`), class: 'small', 'aria-label': 'Days shown' });
  const nav = (n) => () => { week = n === 0 ? thisWeek() : shiftWeek(week, n); seekToday = true; api.update(); };
  seekToday = true;
  root.replaceChildren(
    h('header', { class: 'view-head row' }, h('h1', {}, 'Week'),
      h('div', { class: 'week-nav' },
        h('button', { class: 'btn small', onclick: nav(-1), title: 'Previous week' }, icon('left', 14)),
        h('button', { class: 'btn small', onclick: nav(0) }, 'This week'),
        h('button', { class: 'btn small', onclick: nav(1), title: 'Next week' }, icon('right', 14)),
        label),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => openCreateModal('task', { plan: week === thisWeek() ? 'week' : 'nextweek' }, { fixedType: true }) }, icon('plus', 16), 'Add task')),
    h('div', { class: 'toolbar' }, seg, dayFilter, doneToggle),
    agenda, board);

  const api = {
    update() {
      label.textContent = weekLabel(week);
      seg.replaceChildren(...[['list', 'text', 'List'], ['board', 'kanban', 'Board']].map(([m, ico, name]) => h('button', {
        class: `btn small ${mode === m ? 'active' : ''}`, 'aria-pressed': String(mode === m),
        onclick: () => { mode = m; seekToday = true; try { localStorage.setItem(MODE_KEY, m); } catch { /* fine */ } api.update(); },
      }, icon(ico, 14), name)));
      agenda.hidden = mode !== 'list';
      board.hidden = mode !== 'board';
      dayFilter.hidden = mode !== 'board';
      const b = weekBuckets(state.items, week, { hideDone, sort: byManualOrder(byPriority) });
      // A card dropped on a day (or on Anytime) is planned there, at the place it was dropped.
      const toDay = (d) => (it, index) => placeInPlan(it, it.fields.plan_day === d ? {} : { plan_day: d, plan_week: isoWeek(d) }, b.byDay[d], index);
      const toAnytime = (it, index) => placeInPlan(it, !it.fields.plan_day && it.fields.plan_week === week ? {} : { plan_week: week, plan_day: null },
        b.anytime, index);
      const logged = (d) => state.worklog.filter((e) => e.date === d).length;
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
}
