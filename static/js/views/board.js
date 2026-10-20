// Board, Trello-style: user-defined lists (stored in <root>/.task-manager/board.md)
// with tasks as cards. Every list maps to a status: dropping a card on a list sets
// both `list` and `status`. By default there is one list per status; you can add
// more ("Waiting client" → OnHold), rename, drag to reorder, set WIP limits or delete them.
import { openItem } from '../panel.js';
import { quickAddBar } from '../quickadd.js';
import { createFilters } from '../filterbar.js';
import { STATUSES, anyStatusRank, isClosedStatus, isDone } from '../rules.js';

// The board's lists pick from every status of the vault, by group then order (Settings → Item type status).
const boardStatuses = () => [...STATUSES].sort((a, b) => anyStatusRank(a) - anyStatusRank(b));
import { byType, listOf, moveToList, saveBoard, slugId, state, toast, updateMany } from '../state.js';
import { openCreateModal } from '../create.js';
import { addListColumn, listDropZone, listHeader, moveEntries, moveList, startRename } from '../kanban.js';
import { cssKey, dropZone, dropdown, h, icon, itemCard, select } from '../ui.js';

// The Board shows its Done list, so closed tasks start visible; the controls are All items' (filterbar.js).
// Tasks start ticked; initiatives and stories can be ticked too and sit in the list of their status.
const flt = createFilters({ types: ['task', 'initiative', 'story'], selected: ['task'], showDone: true });

const byOrder = (a, b) => (a.fields.order ?? Infinity) - (b.fields.order ?? Infinity)
  || String(a.fields.created_at || '').localeCompare(String(b.fields.created_at || ''));

/** The tasks the board shows: filtered, in card order. */
const boardTasks = () => flt.source().filter(flt.matches).sort(byOrder);

/** Orders for dropping `item` at `index` among `cards` (dragged item excluded). */
function placement(item, cards, index) {
  const orders = cards.map((c) => c.fields.order);
  const prev = index > 0 ? orders[index - 1] : null;
  const next = index < cards.length ? orders[index] : null;
  const gapless = (index > 0 && typeof prev !== 'number') || (index < cards.length && typeof next !== 'number')
    || (typeof prev === 'number' && typeof next === 'number' && next - prev < 1e-6);
  if (gapless) { // renumber the whole column in steps of 10
    const seq = [...cards.slice(0, index), item, ...cards.slice(index)];
    return seq.map((c, i) => [c, i * 10]);
  }
  const order = prev === null && next === null ? 0 : prev === null ? next - 10 : next === null ? prev + 10 : (prev + next) / 2;
  return [[item, order]];
}

async function drop(key, list, index) {
  const item = state.items.find((i) => i.key === key);
  if (!item || item.type !== 'task') return;
  const cards = boardTasks().filter((t) => t.key !== key && listOf(t)?.id === list.id);
  const patches = placement(item, cards, index);
  const others = patches.filter(([c, o]) => c.type === 'task' && c.key !== key && c.fields.order !== o);
  try {
    if (others.length) await updateMany(others.map(([c, o]) => [c.key, { order: o }]));
    await moveToList(item, list, patches.find(([c]) => c.key === key)[1]);
  } catch { /* already toasted */ }
}

// ── list management ──────────────────────────────────────────────────────────
function editLists(fn) {
  const next = state.board.lists.map((l) => ({ ...l }));
  fn(next);
  return saveBoard(next).catch(() => {});
}

/** The ⋯ menu of a list: status it sets, WIP limit, rename, move, delete. */
function listMenu(anchor, list, idx, total, nameEl) {
  const last = state.board.lists.length - 1;
  const status = select(boardStatuses().map((st) => [st, st]), list.status, (v) => editLists((ls) => { ls[idx].status = v; }),
    { id: `lm-status-${idx}`, class: `status-select s-${cssKey(list.status)}` });
  const wip = h('input', {
    id: `lm-wip-${idx}`, type: 'number', min: '0', value: list.wip || '', placeholder: 'No limit',
    onchange: (e) => editLists((ls) => { ls[idx].wip = Number(e.target.value) || null; }),
  });
  dropdown(anchor, [
    { heading: list.name },
    h('div', { class: 'menu-field' }, h('label', { for: status.id }, 'Sets status'), status),
    h('div', { class: 'menu-field' }, h('label', { for: wip.id }, 'WIP limit'), wip),
    '-',
    { label: 'Rename', icon: 'pencil', onSelect: () => startRename(nameEl, list.name, (v) => editLists((ls) => { ls[idx].name = v; })) },
    ...moveEntries(idx, last, (from, to) => editLists((ls) => moveList(ls, from, to))),
    '-',
    { label: total ? 'Delete list (move its cards first)' : 'Delete list', icon: 'trash', danger: true, onSelect: () => (total
      ? toast('Move its cards out first — a list with tasks cannot be deleted', true)
      : editLists((ls) => ls.splice(idx, 1))) },
  ], { width: 260 });
}

function boardListHeader(list, idx, count, total) {
  const over = list.wip && count > list.wip;
  return listHeader({
    list, idx, count: list.wip ? `${count}/${list.wip}` : count, countTitle: list.wip ? `WIP limit ${list.wip}` : null,
    cls: `s-${cssKey(list.status)} ${over ? 'over' : ''}`,
    before: h('span', { class: 'status-dot', title: `Sets ${list.status}` }),
    menu: (anchor, nameEl) => listMenu(anchor, list, idx, total, nameEl),
    onRename: (v) => editLists((ls) => { ls[idx].name = v; }),
  });
}

function boardColumn(list, idx, tasks) {
  const zone = h('div', { class: 'col-cards' },
    tasks.map((t) => itemCard(t, { onOpen: openItem, draggable: t.type === 'task', hideStatus: !!list })));
  if (!list) {
    return h('section', { class: 'board-col no-list', 'aria-label': 'No list' },
      h('header', { class: 'list-head' },
        h('h2', { class: 'list-name', title: 'No list maps to their status — add one for it' }, 'No list'),
        h('span', { class: 'count' }, tasks.length)),
      zone);
  }
  dropZone(zone, (key, index) => drop(key, list, index));
  const count = isClosedStatus(list.status) ? tasks.length : tasks.filter((t) => !isDone(t)).length;
  const total = byType('task').filter((t) => listOf(t)?.id === list.id).length;
  return h('section', { class: `board-col s-${cssKey(list.status)}`, 'data-list': list.id, 'aria-label': `${list.name} list` },
    boardListHeader(list, idx, count, total),
    zone,
    quickAddBar({ type: 'task', values: { list: list.id, ...flt.relatedDefault('task') } },
      { placeholder: '+ Add a card' }));
}

export function mount(root) {
  const cols = h('div', { class: 'board' });
  listDropZone(cols, (from, to) => editLists((ls) => moveList(ls, from, to)));
  const bar = flt.bar(() => api.update());
  root.replaceChildren(
    h('header', { class: 'view-head row' }, h('h1', {}, 'Board'), h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => openCreateModal('task', flt.relatedDefault('task'), { fixedType: true }) },
        icon('plus', 16), 'Add task')),
    bar,
    cols);
  const api = {
    update() {
      bar.refresh();
      const tasks = boardTasks();
      const placed = new Map(state.board.lists.map((l) => [l.id, []]));
      const orphans = [];
      for (const t of tasks) {
        const l = listOf(t);
        (l ? placed.get(l.id) : orphans).push(t);
      }
      cols.replaceChildren(
        orphans.length ? boardColumn(null, -1, orphans) : '',
        ...state.board.lists.map((l, i) => boardColumn(l, i, placed.get(l.id))),
        addListColumn({
          extra: () => select(boardStatuses().map((st) => [st, `Sets ${st}`]), STATUSES.includes('ToDo') ? 'ToDo' : boardStatuses()[0], () => {}, { 'aria-label': 'Status for its cards' }),
          onAdd: (name, status) => editLists((ls) => ls.push({ id: slugId(name, ls.map((l) => l.id)), name, status: status.value })),
        }));
    },
  };
  return api;
}
