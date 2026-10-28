// Which item a Claude session is about: a popover with a search over the vault's items (composer.js matchItems, as
// the composer's #), the current one ticked, and "No item" for the general history. The dock's head opens it, and
// so does a history row's Move…; the caller moves the record (api.claudeAssociate).
import { matchItems } from './composer.js';
import { hasField, isDone } from './rules.js';
import { state } from './state.js';
import { h, icon, typeIcon } from './ui.js';

let open = null;

export function closeItemPicker() {
  if (!open) return;
  open.el.remove();
  document.removeEventListener('mousedown', open.outside, true);
  open.anchor.setAttribute('aria-expanded', 'false');
  open = null;
}

/** The name a session shows for its item: "TSK-0001 · title". */
export const itemName = (it) => `${it.id || it.type} · ${it.title}`;

/**
 * Open under (or above) `anchor`. `current` is the key the session is about now (null: none); `onPick(item | null)`
 * runs with the item chosen, or null for no item. Only items of a type that keeps Claude sessions are offered.
 */
export function itemPicker(anchor, current, onPick) {
  if (open?.anchor === anchor) { closeItemPicker(); return; }
  closeItemPicker();
  const keeps = (it) => hasField(it.type, 'claude_sessions');
  const now = current ? state.items.find((it) => it.key === current) : null;
  const input = h('input', { type: 'search', class: 'ip-search', placeholder: 'Find an item by id or title', 'aria-label': 'Find an item',
    autocomplete: 'off', spellcheck: 'false' });
  const list = h('div', { class: 'ip-list', role: 'listbox', 'aria-label': 'Items' });
  const el = h('div', { class: 'menu ip', role: 'dialog', 'aria-label': 'The item this session is about' }, input, list);
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
      h('span', { class: 'ip-text' }, it ? h('span', {}, h('b', {}, it.id || it.type), ` ${it.title}`) : 'No item (general history)'),
      on ? icon('check', 14) : null);
    b.addEventListener('mousemove', () => mark(rows.findIndex((r) => r.el === b)));
    return { el: b, it };
  };
  const paint = () => {
    const q = input.value.trim();
    const found = q ? matchItems(state.items.filter(keeps), q, { isClosed: isDone }) : (now ? [now] : []);
    rows = [...found.map(row), row(null)];
    list.replaceChildren(...rows.map((r) => r.el), ...(q && !found.length ? [h('div', { class: 'menu-empty' }, 'No item matches')] : []));
    mark(0);
  };
  input.addEventListener('input', paint);
  // Its keys stay here: the page's (Escape closes the card, letters are shortcuts) and the dock's never see them.
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); mark(at + (e.key === 'ArrowDown' ? 1 : -1)); }
    else if (e.key === 'Enter' && rows[at]) { e.preventDefault(); pick(rows[at].it); }
    else if (e.key === 'Escape') { e.preventDefault(); closeItemPicker(); anchor.focus(); }
  });
  paint();

  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  // Its rows change with the search: anchored by the edge nearest the button, so it grows away from it.
  if (r.bottom + 6 + 320 > innerHeight - 8) el.style.bottom = `${innerHeight - r.top + 6}px`;
  else el.style.top = `${r.bottom + 6}px`;
  const outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeItemPicker(); };
  document.addEventListener('mousedown', outside, true);
  anchor.setAttribute('aria-expanded', 'true');
  open = { el, anchor, outside };
  input.focus();
}
