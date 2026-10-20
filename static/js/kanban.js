// Kanban pieces shared by the Board (lists mapped to a status) and the Today
// board (free columns): a draggable list header with a ⋯ menu, inline rename,
// list reordering by drag, and the "Add another list" column. Card dragging
// lives in ui.js (dropZone); lists use their own MIME type so the two never mix.
import { h, icon } from './ui.js';

export const LIST_MIME = 'application/x-tm-list';
const isListDrag = (e) => [...e.dataTransfer.types].includes(LIST_MIME);

/** Swap the heading for an input; onCommit(newName) only when it changed. */
export function startRename(nameEl, current, onCommit) {
  const input = h('input', { type: 'text', class: 'list-rename', value: current, 'aria-label': 'List name' });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = current; input.blur(); }
  });
  input.addEventListener('blur', () => {
    const v = input.value.trim();
    if (v && v !== current) onCommit(v);
    else input.replaceWith(nameEl);
  });
  nameEl.replaceWith(input);
  input.focus();
  input.select();
}

/**
 * The header of a column: drag handle for reordering, name (double-click renames),
 * count and a ⋯ button. `menu(anchor, nameEl)` opens the column's menu.
 */
export function listHeader({ list, idx, count, countTitle = null, cls = '', before = null, menu, onRename }) {
  const name = h('h2', { class: 'list-name', title: `${list.name} — double-click to rename` }, list.name);
  name.addEventListener('dblclick', () => startRename(name, list.name, onRename));
  const more = h('button', { class: 'btn icon', title: `${list.name} list actions`, 'aria-haspopup': 'menu' }, icon('more', 16));
  more.addEventListener('click', (e) => { e.stopPropagation(); menu(more, name); });
  // The header is the drag handle that reorders lists (keyboard: ⋯ → Move left/right).
  const head = h('header', { class: `list-head ${cls}`, draggable: 'true', title: 'Drag to reorder the list' },
    before, name,
    h('span', { class: 'count', title: countTitle || `${count} cards` }, count),
    more);
  head.addEventListener('dragstart', (e) => {
    if (e.target !== head) return;
    e.dataTransfer.setData(LIST_MIME, String(idx));
    e.dataTransfer.effectAllowed = 'move';
    const col = head.closest('.board-col');
    e.dataTransfer.setDragImage(col, 20, 20);
    requestAnimationFrame(() => col.classList.add('dragging'));
  });
  head.addEventListener('dragend', () => head.closest('.board-col')?.classList.remove('dragging'));
  return head;
}

/** Menu entries to move a list left/right, for a ⋯ menu. */
export const moveEntries = (idx, last, move) => [
  idx > 0 ? { label: 'Move left', icon: 'left', onSelect: () => move(idx, idx - 1) } : null,
  idx < last ? { label: 'Move right', icon: 'right', onSelect: () => move(idx, idx + 1) } : null,
];

/** Lists reorder by dragging their header: a marker shows where the list will land. onReorder(from, to). */
export function listDropZone(board, onReorder) {
  const marker = h('div', { class: 'list-marker', 'aria-hidden': 'true' });
  const slot = (e) => {
    const cols = [...board.querySelectorAll('.board-col[data-list]')];
    const i = cols.findIndex((c) => { const r = c.getBoundingClientRect(); return e.clientX < r.left + r.width / 2; });
    return { cols, index: i < 0 ? cols.length : i };
  };
  board.addEventListener('dragover', (e) => {
    if (!isListDrag(e)) return;
    e.preventDefault();
    const { cols, index } = slot(e);
    const ref = cols[index] || board.querySelector('.board-col.add-list');
    if (ref && marker.nextSibling !== ref) board.insertBefore(marker, ref);
  });
  board.addEventListener('dragleave', (e) => { if (!board.contains(e.relatedTarget)) marker.remove(); });
  board.addEventListener('drop', (e) => {
    if (!isListDrag(e)) return;
    e.preventDefault();
    marker.remove();
    const from = Number(e.dataTransfer.getData(LIST_MIME));
    let to = slot(e).index;
    if (to > from) to -= 1;
    if (Number.isInteger(from) && to !== from) onReorder(from, to);
  });
  board.addEventListener('dragend', () => marker.remove());
}

/** Reorder helper for list arrays: moves ls[from] to index `to` in place. */
export const moveList = (ls, from, to) => ls.splice(to, 0, ls.splice(from, 1)[0]);

/**
 * The trailing "Add another list" column. `extra()` may return a control shown
 * under the name (the Board's status select); onAdd(name, extraEl) creates the list.
 */
export function addListColumn({ label = 'Add another list', placeholder = 'List name…', extra = null, onAdd }) {
  const col = h('div', { class: 'board-col add-list' });
  const closed = () => {
    col.replaceChildren(h('button', { class: 'add-list-btn', onclick: opened }, icon('plus', 16), label));
  };
  const opened = () => {
    const input = h('input', { type: 'text', placeholder, 'aria-label': 'New list name' });
    const extraEl = extra ? extra() : null;
    const add = () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      onAdd(name, extraEl);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); if (e.key === 'Escape') closed(); });
    col.replaceChildren(input, extraEl, h('div', { class: 'row-actions' },
      h('button', { class: 'btn primary small', onclick: add }, 'Add list'),
      h('button', { class: 'btn icon', title: 'Cancel', onclick: closed }, icon('x', 16))));
    input.focus();
  };
  closed();
  return col;
}
