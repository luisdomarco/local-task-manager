// Prioritization: what is coming up, in the order you choose. On the right, the pool: every open item planned within
// the next four weeks (rules.js prioHorizon: late, this week, next week, the two after) that sits in no column, with a
// search and a type filter, folded away when you want the room. On the left, a board of columns of your own (Now, Next,
// Later to begin with): drag a card from the pool onto one to place it, back onto the pool to take it out. A column is
// an order, never a status or a priority; a card placed stays in its column whatever its plan becomes, until it is
// taken out or closed (Hide closed). Cards show what they are planned for. Columns and pool: `prio_list`, `prio_order`.
import { weekDays } from '../dates.js';
import { addListColumn, listDropZone, listHeader, moveEntries, moveList, startRename } from '../kanban.js';
import { openItem } from '../panel.js';
import { pref, setPref } from '../prefs.js';
import { quickAddBar } from '../quickadd.js';
import { PLANNABLE, PRIO_HORIZONS, PRIO_WEEKS, TYPE_DEFS, byManualOrder, isDone, prioHorizon } from '../rules.js';
import { matches } from '../search.js';
import { placeInPrio, prioListOf, savePrioLists, slugId, state, updateMany } from '../state.js';
import { byPriority, dropZone, dropdown, h, icon, itemCard, select } from '../ui.js';

const POOL_PREF = 'prioritization.poolClosed';
let hideDone = true;
let query = '';
let typeFilter = null; // a type name, or null for all

/** The day an item is planned for, or the Monday of its week: the pool sorts by it, soonest first. */
const planDate = (it) => it.fields.plan_day || (it.fields.plan_week ? weekDays(it.fields.plan_week)[0] : '');
const bySoonest = (a, b) => planDate(a).localeCompare(planDate(b)) || byPriority(a, b);

/** The cards of the board: every plannable item placed in a column that still exists. */
const placed = () => state.items.filter((i) => PLANNABLE.has(i.type) && prioListOf(i) && !(hideDone && isDone(i)));

/** The pool: open items planned within the horizon that sit in no column, as the search and type filter leave them. */
function poolItems() {
  return state.items.filter((i) => !prioListOf(i) && prioHorizon(i))
    .filter((i) => !typeFilter || i.type === typeFilter)
    .filter((i) => !query || matches(query, `${i.id || ''} ${i.title} ${(i.fields.labels || []).join(' ')}`))
    .sort(bySoonest);
}

function editLists(fn) {
  const next = state.prio.lists.map((l) => ({ ...l }));
  fn(next);
  return savePrioLists(next).catch(() => {});
}

/** Deleting a column sends its cards back to the pool first, so a column made later under the same name starts empty. */
async function deleteColumn(list, idx) {
  const cards = state.items.filter((i) => i.fields.prio_list === list.id);
  if (cards.length) await updateMany(cards.map((i) => [i.key, { prio_list: null, prio_order: null }])).catch(() => {});
  return editLists((ls) => ls.splice(idx, 1));
}

function columnMenu(anchor, list, idx, nameEl) {
  dropdown(anchor, [
    { heading: list.name },
    { label: 'Rename', icon: 'pencil', onSelect: () => startRename(nameEl, list.name, (v) => editLists((ls) => { ls[idx].name = v; })) },
    ...moveEntries(idx, state.prio.lists.length - 1, (from, to) => editLists((ls) => moveList(ls, from, to))),
    '-',
    { label: 'Delete column (its cards go back to the pool)', icon: 'trash', danger: true, onSelect: () => deleteColumn(list, idx) },
  ], { width: 300 });
}

const card = (item) => itemCard(item, { onOpen: openItem, draggable: true, showPlan: true });

function column(list, idx, items) {
  const zone = h('div', { class: 'col-cards' }, items.map(card));
  dropZone(zone, (key, index) => {
    const item = state.items.find((i) => i.key === key);
    if (item) placeInPrio(item, list.id, items, index);
  });
  const open = items.filter((i) => !isDone(i)).length;
  return h('section', { class: 'board-col prio-col', 'data-list': list.id, 'aria-label': `${list.name} column` },
    listHeader({
      list, idx, count: open || '', countTitle: `${open} open`,
      menu: (anchor, nameEl) => columnMenu(anchor, list, idx, nameEl),
      onRename: (v) => editLists((ls) => { ls[idx].name = v; }),
    }),
    zone,
    quickAddBar({ type: 'task', values: { prio_list: list.id } }, { placeholder: '+ Add a card', mic: false }));
}

function renderBoard(board) {
  const items = placed().sort(byManualOrder(byPriority, 'prio_order'));
  const byList = new Map(state.prio.lists.map((l) => [l.id, []]));
  for (const it of items) byList.get(prioListOf(it).id).push(it);
  board.replaceChildren(
    ...state.prio.lists.map((l, i) => column(l, i, byList.get(l.id))),
    addListColumn({
      label: 'Add a column', placeholder: 'Column name… (Now, Next, Later)',
      onAdd: (name) => editLists((ls) => ls.push({ id: slugId(name, ls.map((l) => l.id)), name })),
    }));
}

function renderPool(list, count) {
  const items = poolItems();
  count.textContent = items.length || '';
  const sections = PRIO_HORIZONS.map(([key, title]) => {
    const of = items.filter((i) => prioHorizon(i) === key);
    return of.length ? h('section', { class: `pool-group ${key}` },
      h('h3', {}, title, h('span', { class: 'count' }, of.length)),
      h('div', { class: 'pool-cards' }, of.map(card))) : null;
  }).filter(Boolean);
  list.replaceChildren(...(sections.length ? sections : [h('p', { class: 'muted small pool-empty' }, query || typeFilter
    ? 'Nothing planned matches.'
    : `Nothing planned in the next ${PRIO_WEEKS} weeks is left out of the board. Plan items from their Planned field.`)]));
}

export function mount(root) {
  const board = h('div', { class: 'board prio-board' });
  listDropZone(board, (from, to) => editLists((ls) => moveList(ls, from, to)));

  const count = h('span', { class: 'count' });
  const list = h('div', { class: 'pool-list' });
  const search = h('input', { type: 'search', class: 'pool-search', placeholder: 'Search id, title, label', 'aria-label': 'Search the pool' });
  search.addEventListener('input', () => { query = search.value.trim(); renderPool(list, count); });
  const types = h('div', { class: 'pool-types' });
  const pool = h('aside', { class: 'prio-pool', 'aria-label': 'Pool' });
  const toggle = h('button', { class: 'btn icon', onclick: () => { setPref(POOL_PREF, pool.classList.contains('closed') ? null : true); paintPool(); } });
  // The pool takes the cards dropped on it out of their column.
  dropZone(pool, (key) => {
    const item = state.items.find((i) => i.key === key);
    if (item && prioListOf(item)) placeInPrio(item, null);
  });
  pool.append(
    h('header', { class: 'pool-head' }, toggle, h('h2', {}, 'Pool'), count),
    h('div', { class: 'pool-body' }, search, types, list));
  function paintPool() {
    const closed = !!pref(POOL_PREF, null);
    pool.classList.toggle('closed', closed);
    toggle.replaceChildren(icon('panel', 16));
    toggle.title = closed ? 'Show the pool' : 'Hide the pool';
    toggle.setAttribute('aria-expanded', String(!closed));
  }

  const doneToggle = h('label', { class: 'toggle' },
    h('input', { type: 'checkbox', checked: hideDone, onchange: (e) => { hideDone = e.target.checked; api.update(); } }), 'Hide closed');
  root.replaceChildren(
    h('header', { class: 'view-head' },
      h('h1', {}, 'Prioritization'),
      h('p', { class: 'muted' }, `What is planned for the next ${PRIO_WEEKS} weeks, in the order you choose.`)),
    h('div', { class: 'toolbar' }, doneToggle),
    h('div', { class: 'prio-layout' }, board, pool));

  const api = {
    update() {
      // Only the types of this vault that can be planned; a filter left on a type the vault no longer has is dropped.
      const plannable = [...PLANNABLE].filter((t) => TYPE_DEFS[t]);
      if (typeFilter && !plannable.includes(typeFilter)) typeFilter = null;
      types.replaceChildren(select([[null, 'All types'], ...plannable.map((t) => [t, TYPE_DEFS[t].plural])], typeFilter,
        (v) => { typeFilter = v; renderPool(list, count); }, { class: 'small', 'aria-label': 'Type' }));
      paintPool();
      renderBoard(board);
      renderPool(list, count);
    },
  };
  return api;
}

/** The sidebar's count: the open cards on the board. */
export const openCount = () => state.items.filter((i) => PLANNABLE.has(i.type) && prioListOf(i) && !isDone(i)).length;