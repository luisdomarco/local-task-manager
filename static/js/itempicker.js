// Which item a Claude session is about: a popover with a search over the vault's items (composer.js matchItems, as
// the composer's #), the current one ticked, and "No item" for the general history. The dock's head opens it, and
// so does a history row's Move…; the caller moves the record (api.claudeAssociate).
import { matchItems } from './composer.js';
import { hasField, isDone } from './rules.js';
import { state } from './state.js';
import { closeFloating, floating, floatingFrom, h, icon, typeIcon } from './ui.js';
import { refOf } from './shownid.js';

/** Close it (a 'panel' of ui.js floating: whatever panel is open). */
export const closeItemPicker = () => closeFloating('panel');

/** The name a session shows for its item: "TSK-0001 · title". */
export const itemName = (it) => `${refOf(it) || it.type} · ${it.title}`;

/**
 * Open under (or above) `anchor`. `current` is the key the session is about now (null: none); `onPick(item | null)`
 * runs with the item chosen, or null for no item. Only items of a type that keeps Claude sessions are offered.
 * Another use says what it offers: `keeps` (which items), `first` (what it lists before anything is typed), `none`
 * (the "no item" row's words; null: no such row) and `label` (what the popover is for).
 */
export function itemPicker(anchor, current, onPick, {
  keeps = (it) => hasField(it.type, 'claude_sessions'), first = null, none = 'No item (general history)', label = 'The item this session is about',
} = {}) {
  if (floatingFrom(anchor, 'panel')) { closeItemPicker(); return; }
  const now = current ? state.items.find((it) => it.key === current) : null;
  const input = h('input', { type: 'search', class: 'ip-search', placeholder: 'Find an item by id or title', 'aria-label': 'Find an item',
    autocomplete: 'off', spellcheck: 'false' });
  const list = h('div', { class: 'ip-list', role: 'listbox', 'aria-label': 'Items' });
  const el = h('div', { class: 'menu ip', role: 'dialog', 'aria-label': label }, input, list);
  let rows = [];
  let at = 0;

  const pick = (it) => { closeItemPicker(); anchor.focus(); onPick(it); };
  const mark = (i) => {
    at = Math.max(0, Math.min(rows.length - 1, i));
    rows.forEach((r, k) => r.el.classList.toggle('active', k === at));
    rows[at]?.el.scrollIntoView({ block: 'nearest' });
  };
  const row = (it) => {
    const on = it ? it.key === current : !current;
    const b = h('button', { type: 'button', class: 'menu-item ip-row', role: 'option', 'aria-selected': String(on), onclick: () => pick(it) },
      it ? typeIcon(it.type, 14) : icon('clock', 14),
      h('span', { class: 'ip-text' }, it ? h('span', {}, h('b', {}, refOf(it) || it.type), ` ${it.title}`) : none),
      on ? icon('check', 14) : null);
    b.addEventListener('mousemove', () => mark(rows.findIndex((r) => r.el === b)));
    return { el: b, it };
  };
  const paint = () => {
    const q = input.value.trim();
    const found = q ? matchItems(state.items.filter(keeps), q, { isClosed: isDone }) : first ? first() : (now ? [now] : []);
    rows = [...found.map(row), ...(none ? [row(null)] : [])];
    list.replaceChildren(...rows.map((r) => r.el), ...(q && !found.length ? [h('div', { class: 'menu-empty' }, 'No item matches')] : []));
    mark(0);
  };
  input.addEventListener('input', paint);
  // Its keys stay here: the page's (letters are shortcuts) and the dock's never see them; Esc is floating's.
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); mark(at + (e.key === 'ArrowDown' ? 1 : -1)); }
    else if (e.key === 'Enter' && rows[at]) { e.preventDefault(); pick(rows[at].it); }
  });
  paint();

  floating(anchor, el, { layer: 'panel', grow: 320 }); // its rows change with the search: it grows away from the button
  input.focus();
}
