// The order of a board's columns as the user dragged them (views/list.js; kept with the view, per list and per
// grouping: view.colOrder = { status: [keys], project: [keys]… }). Pure: tested in tests/js/colorder.test.mjs.
//
// A column key is a group's (a status, a priority, a project's key, an initiative's id, a label, NONE for "No …").
// Order never reorders columns: it sorts the cards inside each one.

/**
 * `keys` (the columns in their default order) in the user's `saved` order: the saved ones first, as saved, then any
 * the saved order does not know (a new status, a project made since) in their default order. A saved key with no
 * column now (hidden, gone) is skipped. No saved order: `keys` as they are.
 */
export function applyOrder(keys, saved) {
  if (!Array.isArray(saved) || !saved.length) return [...keys];
  const have = new Set(keys);
  const placed = saved.filter((k, i) => have.has(k) && saved.indexOf(k) === i);
  const known = new Set(placed);
  return [...placed, ...keys.filter((k) => !known.has(k))];
}

/** `keys` with the one at `from` moved to index `to` (where it ends up); out-of-range moves leave it as it is. */
export function moveKey(keys, from, to) {
  const out = [...keys];
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= out.length || to < 0 || to >= out.length) return out;
  out.splice(to, 0, out.splice(from, 1)[0]);
  return out;
}

/**
 * The order to save: `shown` (the columns on the board now, in their order) as the user left it, with each key of
 * the old `saved` order that is not on the board now (an empty column hidden, a group filtered out) kept right after
 * the key it followed there — so hiding a column and showing it again puts it back where it was.
 */
export function mergeOrder(saved, shown) {
  const out = [...new Set(shown)];
  if (!Array.isArray(saved)) return out;
  const on = new Set(out);
  let after = null; // the last key of `saved` that is in `out`: an absent key goes right after it
  for (const k of saved) {
    if (on.has(k)) { after = k; continue; }
    out.splice(after === null ? 0 : out.indexOf(after) + 1, 0, k);
    on.add(k);
    after = k;
  }
  return out;
}

/** What to save when the column at `from` of `shown` is dropped at `to`: the move, merged with the old order. */
export const reorderColumns = (saved, shown, from, to) => mergeOrder(saved, moveKey(shown, from, to));
