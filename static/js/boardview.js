// A list as a board (docs/design.md §3 Board): the rows its view shows, in a column per group of what it groups by.
// views/list.js builds the columns (which items, what a drop sets, what a new card starts with); this draws them:
//
//   [● Backlog 4 ⌄ ⋯] [● ToDo 2 ⌄ ⋯] … [▌Done 12▐]      a closed or empty column folds into a 40 px strip
//    card                card                           (Display → Empty columns); a click unfolds it
//    card
//    + Add a card  (on hover)
//
// Grouped by status, a task's board keeps the lists of <root>/.task-manager/board.md: each list sets a status, and has
// its name, WIP limit and ⋯ menu (rename, move, delete); "Add another list" adds one. Any other board's columns move
// too, when the page keeps their order (views/list.js, colorder.js): dragged by their header (or their strip, folded),
// or Shift+←/→ on it. The board fills the window: it scrolls sideways at the bottom, and each column on its own.
import { dragsList, listDropZone, addListColumn, listHeader, moveEntries, moveList, startRename } from './kanban.js';
import { quickAddBar } from './quickadd.js';
import { STATUSES, anyStatusRank } from './rules.js';
import { saveBoard, slugId, state, toast } from './state.js';
import { cssKey, dropZone, dropdown, h, icon, itemCard, select, statusLabel } from './ui.js';

/**
 * The board. `columns`: [{ key, face (nodes: its dot or icon and name), items, cls?, head? (a header of its own: a
 * board.md list's), drop? (key, index) → a drop sets its value, quick? { type, values } (its "+ Add a card"),
 * folded, card? (item) → its card (Planning's: planrows.js planCard), aside? (a node at its head's right: "Move all"),
 * empty? (a line said when it holds nothing), unfoldable? (never folds), lead? (cards over its own that are no drop
 * target: a day's meetings), movable? (it drags by its own header or strip: a board whose page keeps its columns'
 * order) }]. onFold(key, folded) remembers a column folded or unfolded; `after` goes last ("Add another list");
 * onReorder(from, to) lets the columns be dragged by their header (board.md lists, and the `movable` ones: `from` and
 * `to` count the board's columns that move); shows(key) what the cards carry (Display → Show on cards).
 */
export function boardOf({ columns, onFold, onOpen, projectName, after = null, onReorder = null, shows }) {
  const board = h('div', { class: 'board vboard' });
  if (onReorder) listDropZone(board, onReorder);
  const movable = onReorder ? columns.filter((c) => c.movable) : [];
  const moveOf = (c) => (movable.includes(c) ? { idx: movable.indexOf(c), last: movable.length - 1, onReorder } : null);
  board.append(...columns.map((c) => (c.folded ? strip(c, onFold, moveOf(c)) : column(c, { onFold, onOpen, projectName, shows, move: moveOf(c) }))), ...(after ? [after] : []));
  return board;
}

/** A movable column's handle (its header, or its strip folded): dragged, it moves the column (kanban.js, a card's drag
 *  never does); Shift+←/→ moves it one place, as a pinned chip does, and the focus stays on it. */
function moves(handle, c, { idx, last, onReorder }) {
  dragsList(handle, idx);
  handle.dataset.colHandle = '';
  handle.addEventListener('keydown', (e) => {
    if (!e.shiftKey || e.target !== handle || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const to = idx + (e.key === 'ArrowLeft' ? -1 : 1);
    if (to < 0 || to > last) return;
    e.preventDefault();
    onReorder(idx, to);
    // The board is drawn again: the focus goes back to the column it moved.
    requestAnimationFrame(() => document.querySelector(`.board-col[data-list="${CSS.escape(c.key)}"] [data-col-handle]`)?.focus());
  });
  return handle;
}
const moveTip = 'drag, or Shift+←/→, to move the column';

/** A folded column: a 40 px strip with its name and count, read top to bottom; a click (or a card dropped on it) opens it. */
function strip(c, onFold, move = null) {
  const el = h('section', { class: `board-col folded ${c.cls || ''}`, 'aria-label': `${c.label} (folded)`, ...(c.attrs || {}), ...(move ? { 'data-list': c.key } : {}) },
    h('button', { type: 'button', class: 'fold-strip', title: move ? `Unfold ${c.label} — ${moveTip}` : `Unfold ${c.label}`, 'aria-expanded': 'false', onclick: () => onFold(c.key, false) },
      h('span', { class: 'strip-count' }, String(c.items.length + (c.lead?.length || 0))),
      h('span', { class: 'strip-name' }, ...c.face)));
  if (move) moves(el.firstChild, c, move);
  if (c.drop) dropZone(el, (key, index) => c.drop(key, index));
  return el;
}

function column(c, { onFold, onOpen, projectName, shows, move = null }) {
  const fold = h('button', {
    type: 'button', class: 'btn icon small col-fold', title: `Fold ${c.label}`, 'aria-label': `Fold ${c.label}`, 'aria-expanded': 'true',
    onclick: (e) => { e.stopPropagation(); onFold(c.key, true); },
  }, icon('minimize', 14));
  let head = c.head;
  // The count sits right by the name (app.css); the fold (on hover) and the ⋯ at the head's right.
  if (head) head.insertBefore(fold, head.lastChild); // a list's: fold before its ⋯
  else {
    head = h('header', { class: 'list-head vb-col-head' }, h('span', { class: 'group-title' }, ...c.face),
      h('span', { class: 'count' }, String(c.items.length)), c.aside || null, c.unfoldable ? null : fold);
    if (move) {
      Object.assign(head, { tabIndex: 0, title: `${c.label} — ${moveTip}` });
      head.setAttribute('role', 'group');
      head.setAttribute('aria-label', `${c.label}: Shift+Left or Shift+Right moves the column`);
      head.setAttribute('aria-keyshortcuts', 'Shift+ArrowLeft Shift+ArrowRight');
      moves(head, c, move);
    }
  }
  const cards = h('div', { class: 'col-cards' }, c.items.length || !c.empty
    ? c.items.map((i) => (c.card ? c.card(i) : itemCard(i, { onOpen, variant: 'board', projectName, shows, draggable: !!c.drop })))
    : h('p', { class: 'col-empty' }, c.empty));
  if (c.drop) dropZone(cards, (key, index) => c.drop(key, index));
  return h('section', { class: `board-col ${c.cls || ''}`, 'aria-label': `${c.label} column`, ...(c.attrs || {}), ...(move ? { 'data-list': c.key } : {}) },
    head, c.lead?.length ? h('div', { class: 'col-cards col-lead' }, c.lead) : null, cards,
    c.quick ? h('div', { class: 'col-add' }, quickAddBar(c.quick, { placeholder: '+ Add a card' })) : null);
}

// ── the board.md lists (a task's board grouped by status) ─────────────────────
/** The statuses a list can set: every one of the vault's, by group then order (Settings → Statuses). */
export const boardStatuses = () => [...STATUSES].sort((a, b) => anyStatusRank(a) - anyStatusRank(b));

export function editLists(fn) {
  const next = state.board.lists.map((l) => ({ ...l }));
  fn(next);
  return saveBoard(next).catch(() => {});
}

/** The ⋯ menu of a list: status it sets, WIP limit, rename, move, delete. `total`: the tasks in it, closed ones too. */
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

/** A list's header: its dot, name (double-click renames), count against its WIP limit and ⋯. Dragged, it moves the list
 *  (`pos`: its place among the lists the board shows, for boardOf's onReorder). */
export function listHead(list, idx, count, total, pos = idx) {
  const over = list.wip && count > list.wip;
  return listHeader({
    list, idx, dragIdx: pos, count: list.wip ? `${count}/${list.wip}` : count, countTitle: list.wip ? `WIP limit ${list.wip}` : null,
    cls: over ? 'over' : '',
    before: h('span', { class: 'status-dot', title: `Sets ${statusLabel(list.status)}` }),
    label: list.name === list.status ? statusLabel(list.name) : list.name, // a list named as its status reads as the status does
    menu: (anchor, nameEl) => listMenu(anchor, list, idx, total, nameEl),
    onRename: (v) => editLists((ls) => { ls[idx].name = v; }),
  });
}

/** The trailing "Add another list" column, with the status the new list sets. */
export const addList = () => addListColumn({
  extra: () => select(boardStatuses().map((st) => [st, `Sets ${st}`]), STATUSES.includes('ToDo') ? 'ToDo' : boardStatuses()[0], () => {}, { 'aria-label': 'Status for its cards' }),
  onAdd: (name, status) => editLists((ls) => ls.push({ id: slugId(name, ls.map((l) => l.id)), name, status: status.value })),
});
