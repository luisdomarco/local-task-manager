// A board's Custom grouping (tm/boards.py): columns of the user's own — Uncategorized, then "Waiting", "Deep work"… —
// and where each card sits, kept in the vault's .task-manager/boards/<name>.json, never in the item's file. Today's
// board, the Week's and the Month's Custom grouping, and every list's Custom board read one. Pure: no DOM, no state.
//
//   board = { columns: [{ id, name }], cards: { '<item id>': [column, order | null] } }
//
// A card names its column and its place in it (a number, or null: never placed by hand, so it follows the page's own
// order). One whose column is gone, or that no card names, is in Uncategorized, the column every board has.
import { placement } from './rules.js';

export const UNCATEGORIZED = 'uncategorized';
export const emptyBoard = () => ({ columns: [{ id: UNCATEGORIZED, name: 'Uncategorized' }], cards: {} });

const cardOf = (board, item) => board?.cards?.[String(item.id)] || null;

/** The column `item` sits in: its card's, when the board still has that column; else Uncategorized. */
export function columnOf(board, item) {
  const card = cardOf(board, item);
  return card && board.columns.some((c) => c.id === card[0]) ? card[0] : UNCATEGORIZED;
}

/** Its place in that column, or null when it was never placed by hand. */
export const orderOf = (board, item) => (typeof cardOf(board, item)?.[1] === 'number' ? cardOf(board, item)[1] : null);

/**
 * The items in the board's columns: Map(column id → items), every column there (empty or not), in the board's order.
 * Inside a column, `manual` (the default) puts the cards placed by hand first, in their place, then the rest as `sort`
 * orders them; not manual, `sort` alone orders it (the page's Order wins over the hand's).
 */
export function byColumn(board, items, sort = () => 0, { manual = true } = {}) {
  const out = new Map(board.columns.map((c) => [c.id, []]));
  for (const it of items) out.get(columnOf(board, it)).push(it);
  const placedFirst = (a, b) => {
    const x = orderOf(board, a) ?? Infinity;
    const y = orderOf(board, b) ?? Infinity;
    return (x === y ? 0 : x - y) || sort(a, b);
  };
  for (const [id, its] of out) out.set(id, its.sort(manual ? placedFirst : sort));
  return out;
}

/**
 * `item` dropped on column `col` at `index` among `cards` (that column as shown): the `place` to save, { id: [col,
 * order] } — only the cards whose place changes. Manual, it lands where it was dropped (rules.js placement: between two
 * placed cards it takes the middle, else the column is numbered in steps of 10, as shown); not manual it only changes
 * column, keeping the place it had.
 */
export function placeCard(board, item, col, cards, index, { manual = true } = {}) {
  if (!manual) return columnOf(board, item) === col ? {} : { [item.id]: [col, orderOf(board, item)] };
  const wrap = (c) => ({ c, key: c.key, fields: { order: orderOf(board, c) } });
  const others = cards.filter((c) => c.key !== item.key).map(wrap);
  const place = {};
  for (const [w, order] of placement(wrap(item), others, index)) {
    const it = w.c;
    if (it.key === item.key ? columnOf(board, it) !== col || orderOf(board, it) !== order : orderOf(board, it) !== order) {
      place[it.id] = [it.key === item.key ? col : columnOf(board, it), order];
    }
  }
  return place;
}

/** The columns with `id` taken out (Uncategorized never is): the board then sends its cards to Uncategorized. */
export const withoutColumn = (columns, id) => (id === UNCATEGORIZED ? columns : columns.filter((c) => c.id !== id));
