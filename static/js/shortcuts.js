// The "g then <key>" shortcuts, in one place: main.js listens to GO, and keymap.js lists them (Settings → Keyboard, ?).
import { viewOn } from './features.js';
import { onStructure } from './rules.js';

// The views every vault has. A type's view is there when the vault's structure has the type (its `go_key`).
const FIXED = [['t', 'today', 'Today'], ['w', 'week', 'Week'],
  ['b', 'board', 'Board'], ['a', 'table', 'List'], ['l', 'log', 'Work log'], ['h', 'labels', 'Labels'], ['e', 'contacts', 'Contacts'],
  ['d', 'trash', 'Trash']];
// The order Settings lists them in; a key not here (another structure's type) goes at the end.
const ORDER = 'itrwnskoxmcbalhepd';

/** [key, view (the hash route), label] */
export let GO_KEYS = [];
/** key → view, for the keydown handler. */
export let GO = {};
onStructure((s) => {
  const keys = [...FIXED.filter(([, view]) => viewOn(view)), ...s.types.filter((t) => t.go_key).map((t) => [t.go_key, t.route, t.plural])]
    .filter(([key], i, all) => all.findIndex(([k]) => k === key) === i); // a type may not take a key the app uses
  const rank = (key) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length);
  GO_KEYS = keys.sort((a, b) => rank(a[0]) - rank(b[0]));
  GO = Object.fromEntries(GO_KEYS.map(([key, view]) => [key, view]));
});

/**
 * One key on an item (itemkeys.js): the open card's, else the card or row under the keyboard focus, else under the
 * pointer. [key, action, what it does]. Never q, / or g, which the app takes.
 */
export const ITEM_KEYS = [
  ['x', 'close', 'close or reopen'],
  ['t', 'today', 'plan for today'],
  ['w', 'week', 'plan for this week'],
  ['s', 'status', 'change the status'],
  ['p', 'priority', 'change the priority'],
];
