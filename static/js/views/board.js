// Board: one type's items as a board (views/list.js as a board, boardview.js), "Board  Tasks ▾" picking the type, one at
// a time. Grouped by status, a task's board keeps the lists of <root>/.task-manager/board.md (each sets a status: rename,
// WIP limit, reorder, add or delete one); grouped by priority, project or initiative, a card dropped in a column takes
// its value. Its List switch goes to the List page filtered to that type.
import { pref } from '../prefs.js';
import { boardTypes, listView } from './list.js';

/** The type the Board shows: the one last picked, else tasks, else the first type with a status. */
const boardType = () => {
  const types = boardTypes();
  const t = pref('list.board', 'task');
  return types.includes(t) ? t : types.includes('task') ? 'task' : types[0];
};

export function mount(root) {
  let inner = listView(boardType(), { page: 'board' }).mount(root);
  // Another type picked: the same page, that type's board (and its own view).
  // #view outlives this page: the listener goes with it (main.js unmount).
  const onType = () => { inner = listView(boardType(), { page: 'board' }).mount(root); inner.update(); };
  root.addEventListener('board-type', onType);
  return { update: () => inner.update(), unmount: () => root.removeEventListener('board-type', onType) };
}
