// The "g then <key>" shortcuts, in one place: main.js listens to GO and Settings prints the same list.
import { onStructure } from './rules.js';

// The views every vault has. A type's view is there when the vault's structure has the type (its `go_key`).
const FIXED = [['t', 'today', 'Today'], ['r', 'tomorrow', 'Tomorrow'], ['w', 'week', 'Week'],
  ['b', 'board', 'Board'], ['a', 'table', 'All items'], ['l', 'log', 'Work log'], ['h', 'labels', 'Labels'], ['e', 'people', 'People'],
  ['d', 'trash', 'Trash']];
// The order Settings lists them in; a key not here (another structure's type) goes at the end.
const ORDER = 'itrwnskoxmcbalhepd';

/** [key, view (the hash route), label] */
export let GO_KEYS = [];
/** key → view, for the keydown handler. */
export let GO = {};
onStructure((s) => {
  const keys = [...FIXED, ...s.types.filter((t) => t.go_key).map((t) => [t.go_key, t.route, t.plural])]
    .filter(([key], i, all) => all.findIndex(([k]) => k === key) === i); // a type may not take a key the app uses
  const rank = (key) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length);
  GO_KEYS = keys.sort((a, b) => rank(a[0]) - rank(b[0]));
  GO = Object.fromEntries(GO_KEYS.map(([key, view]) => [key, view]));
});

/** The line Settings shows. */
export const keyboardHelp = () => `q — quick add · / — focus filter · ⌘K — command palette · Esc — close panel · g then ${GO_KEYS.map(([k]) => k).join('/')} — go to ${GO_KEYS.map(([, , l]) => l).join('/')}`;
