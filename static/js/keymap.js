// Every key the app answers, in one place: Settings → Keyboard and the ? dialog print keymap(); main.js asks is() for
// the keys it listens to on every page. A key listened to elsewhere (the editor's, the create form's, a pin's) is
// listed here as text; tests/js/keymap.test.mjs checks main.js and the editor's toolbar against this file.
import { has } from './features.js';
import { GO_KEYS, ITEM_KEYS } from './shortcuts.js';

/**
 * The keys main.js's keydown handler answers on every page, by id. `mod`: ⌘ (Ctrl off a Mac); `shift` counts only
 * with `mod` (a plain key is matched as typed: ? is already a shifted /); `feature`: listed only while the vault has
 * it (features.js; main.js checks has() itself). [id]: { key, mod?, shift?, label, group, feature? }
 */
export const GLOBAL_KEYS = {
  palette: { key: 'k', mod: true, label: 'Command palette: search, go anywhere, run a command', group: 'Navigate' },
  go: { key: 'g', label: 'Go to a page: g, then its letter (below)', group: 'Navigate' },
  docs: { key: 'd', mod: true, shift: true, label: 'Docs', group: 'Navigate' },
  filter: { key: '/', label: 'Focus the page’s search or filter', group: 'Navigate' },
  help: { key: '?', label: 'This list of keys', group: 'Navigate' },
  quick: { key: 'q', label: 'Quick add to the Inbox', group: 'Create', feature: 'inbox' },
  sidebar: { key: '\\', mod: true, label: 'Show or hide the sidebar', group: 'Panels' },
  sidemode: { key: 'e', mod: true, shift: true, label: 'Next sidebar mode: Project, Explorer, Agents', group: 'Panels' },
};

/** Whether the keydown `e` is the global key `id` (GLOBAL_KEYS). */
export function is(e, id) {
  const k = GLOBAL_KEYS[id];
  if (!k || e.altKey) return false;
  const mod = !!(e.metaKey || e.ctrlKey);
  if (!k.mod) return !mod && e.key === k.key;
  return mod && !!e.shiftKey === !!k.shift && String(e.key).toLowerCase() === k.key;
}

/** How a key is drawn: ⌘⇧E, ⌘\, q, ?. */
export const keyText = ({ key, mod, shift }) => (mod ? `⌘${shift ? '⇧' : ''}${key.toUpperCase()}` : key);

// Listened to where they act, not by main.js: [keys as drawn, what they do].
export const EDITOR_KEYS = [
  ['⌘B', 'Bold'], ['⌘I', 'Italic'], ['⌘K', 'Link (in the editor, not the palette)'], ['⌘⇧C', 'Code'],
  ['Tab · ⇧Tab', 'Indent or outdent the selected lines'], ['↵', 'Continue a list or a checklist (an empty item ends it)'],
  ['⌘↵ · ⌘S', 'Save and go back to reading'], ['Esc', 'Leave the editor (saved as you type)'],
];
const CREATE_KEYS = [['↵', 'In the subject: create it'], ['⌘↵', 'Create it, from anywhere in the form'], ['Esc', 'Cancel']];
const PANEL_KEYS = [['Esc', 'Close the palette, a menu or the open card'], ['⇧← · ⇧→', 'Move the focused pin'], ['Delete', 'Unpin the focused pin']];

/** The groups Settings → Keyboard and the ? dialog show, in order: [{ group, about?, rows: [[keys, label]] }]. The
 *  g-keys follow the vault's structure (shortcuts.js GO_KEYS: a type's page has its letter where the vault has it). */
export function keymap() {
  const of = (group) => Object.values(GLOBAL_KEYS).filter((k) => k.group === group && (!k.feature || has(k.feature))).map((k) => [keyText(k), k.label]);
  return [
    { group: 'Navigate', rows: of('Navigate') },
    { group: 'Go to', about: 'g, then the letter, within a second.', rows: GO_KEYS.map(([key, , label]) => [`g ${key}`, label]) },
    { group: 'Create', rows: [...of('Create'), ...CREATE_KEYS.map(([k, l]) => [k, `New item form · ${l}`])] },
    { group: 'Item', about: 'On the open card, else the card or row focused, else the one under the pointer.',
      rows: ITEM_KEYS.map(([key, , what]) => [key, what[0].toUpperCase() + what.slice(1)]) },
    { group: 'Editor', about: 'While editing a description, a doc or a note.', rows: EDITOR_KEYS },
    { group: 'Panels', rows: [...of('Panels'), ...PANEL_KEYS] },
  ];
}
