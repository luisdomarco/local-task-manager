// Month: this month on one board, a column per horizon — Today (with what was carried over from past days, as on
// Today), Tomorrow, This week (the rest of it), Next week and Later this month — and, first, what was carried over from
// past weeks or months. What goes where is rules.js planHorizon: an item's day decides, else its week, else its month
// (`plan_month`, for what has no week yet). Drag a card onto a column to plan it there: Today or Tomorrow give it that
// day, This week and Next week that week with no day, Later this month the month with neither. Cards show what they are
// planned for and keep the order you drop them in (`plan_order`, the same as on Today and Week).
import { openCreateModal } from '../create.js';
import { addDays, isoWeek, monthLabel, shiftWeek, thisMonth, thisWeek, today } from '../dates.js';
import { openItem } from '../panel.js';
import { quickAddBar } from '../quickadd.js';
import { MONTH_HORIZONS, byManualOrder, isDone, monthBuckets, planHorizon } from '../rules.js';
import { noMonth, placeInPlan, planWeek, state } from '../state.js';
import { byPriority, dropZone, h, icon, itemCard } from '../ui.js';

let hideDone = false;

/** The values that plan an item for a column (`key` of MONTH_HORIZONS); {} when it is already there. */
function planFor(key, item) {
  if (planHorizon(item) === key) return {};
  const t = today();
  if (key === 'today') return { plan_day: t, plan_week: thisWeek(), ...noMonth(item) };
  if (key === 'tomorrow') { const d = addDays(t, 1); return { plan_day: d, plan_week: isoWeek(d), ...noMonth(item) }; }
  if (key === 'week') return { plan_week: thisWeek(), plan_day: null, ...noMonth(item) };
  if (key === 'nextweek') return { plan_week: shiftWeek(thisWeek(), 1), plan_day: null, ...noMonth(item) };
  return { plan_month: thisMonth(), plan_week: null, plan_day: null };
}

const EMPTY = {
  today: 'Nothing planned for today', tomorrow: 'Nothing planned for tomorrow', week: 'Nothing else this week',
  nextweek: 'Nothing planned for next week', month: 'Nothing else planned this month',
};

function column(key, title, items) {
  const carried = key === 'carried';
  const toWeek = (i) => h('button', { class: 'btn icon small', title: 'Move to this week', 'aria-label': `Move ${i.title} to this week`,
    onclick: () => planWeek(i, thisWeek()) }, icon('arrow', 14));
  const zone = h('div', { class: 'col-cards' }, items.length
    ? items.map((i) => itemCard(i, { onOpen: openItem, draggable: true, showPlan: true, extra: carried ? toWeek(i) : null }))
    : h('p', { class: 'muted small col-empty' }, EMPTY[key]));
  if (!carried) {
    dropZone(zone, (k, index) => {
      const it = state.items.find((i) => i.key === k);
      if (it) placeInPlan(it, planFor(key, it), items, index);
    });
  }
  const open = items.filter((i) => !isDone(i)).length;
  return h('section', { class: `board-col week-col month-col ${carried ? 'warn' : ''} ${key === 'today' ? 'today' : ''}`, 'data-horizon': key, 'aria-label': `${title} column` },
    h('header', { class: 'list-head week-col-head' }, h('h3', { class: 'list-name' }, title), h('span', { class: 'count' }, open || '')),
    zone,
    // A new card: the column's plan, without the nulls that clear another one.
    carried ? null : quickAddBar({ type: 'task', values: Object.fromEntries(Object.entries(planFor(key, { type: 'task', fields: {} })).filter(([, v]) => v)) },
      { placeholder: '+ Add a card' }));
}

export function mount(root) {
  const board = h('div', { class: 'board week-board month-board' });
  const subtitle = h('p', { class: 'muted' });
  const doneToggle = h('label', { class: 'toggle' },
    h('input', { type: 'checkbox', checked: hideDone, onchange: (e) => { hideDone = e.target.checked; api.update(); } }), 'Hide closed');
  root.replaceChildren(
    h('header', { class: 'view-head row' },
      h('div', {}, h('h1', {}, 'Month'), subtitle),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => openCreateModal('task', { plan: 'month' }, { fixedType: true }) }, icon('plus', 16), 'Add task')),
    h('div', { class: 'toolbar' }, doneToggle),
    board);
  const api = {
    update() {
      subtitle.textContent = monthLabel(thisMonth());
      const b = monthBuckets(state.items, { hideDone, sort: byManualOrder(byPriority) });
      board.replaceChildren(...MONTH_HORIZONS
        .filter(([key]) => key !== 'carried' || b.carried.length)
        .map(([key, title]) => column(key, title, b[key])));
    },
  };
  return api;
}

/** The sidebar's count: the open items on the board. */
export const openCount = () => state.items.filter((i) => !isDone(i) && planHorizon(i)).length;
