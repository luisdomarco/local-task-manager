// One key on an item (shortcuts.js ITEM_KEYS): x closes or reopens it, t plans it for today, w for this week, s opens
// its status and p its priority. The item is the open card's (or page's); else the card or table row that has the
// keyboard focus; else the one under the pointer. main.js calls handleItemKey from its keydown, never while typing.
import { thisWeek, today } from './dates.js';
import { openItemKey } from './panel.js';
import { ITEM_KEYS } from './shortcuts.js';
import { PLANNABLE, hasField, isDone } from './rules.js';
import { planDay, planWeek, setCompleted, state, toast } from './state.js';
import { refOf } from './shownid.js';

let hovered = null; // the [data-key] element under the pointer
if (typeof document !== 'undefined') {
  document.addEventListener('mouseover', (e) => { hovered = e.target.closest?.('[data-key]') || null; });
}

const ACTION = Object.fromEntries(ITEM_KEYS.map(([k, a]) => [k, a]));
const find = (key) => state.all.find((i) => i.key === key) || state.byId.get(key);

/** The item a key acts on, and the element it was found from (to reach its own status or priority control). */
function target() {
  const open = openItemKey();
  if (open) return { item: find(open), el: document.getElementById('item-modal') };
  const page = document.querySelector('#view .page-title') ? document.querySelector('#view') : null;
  const focused = document.activeElement?.closest?.('[data-key]');
  const el = focused || (hovered?.isConnected ? hovered : null);
  if (el) return { item: find(el.dataset.key), el };
  if (page) { const key = location.hash.split('/').pop(); return { item: find(decodeURIComponent(key)), el: page }; }
  return { item: null, el: null };
}

/** Opens the status or priority control of the item, where it shows one (its card, page or table row). */
function openControl(el, cls) {
  const btn = [...el.querySelectorAll(`.${cls}`)].find((b) => b.offsetParent !== null);
  if (btn) { btn.focus(); btn.click(); return true; }
  return false;
}

/** → true when the key was one of the item keys and something was done with it. */
export function handleItemKey(e) {
  const action = ACTION[e.key];
  if (!action) return false;
  const { item, el } = target();
  if (!item) return false;
  const plannable = PLANNABLE.has(item.type);
  if (action === 'close' && hasField(item.type, 'status')) { e.preventDefault(); setCompleted(item, !isDone(item)).catch(() => {}); return true; }
  if (action === 'today' && plannable) {
    e.preventDefault();
    planDay(item, today()).then(() => toast(`Planned ${refOf(item) || item.title} for today`)).catch(() => {});
    return true;
  }
  if (action === 'week' && plannable) {
    e.preventDefault();
    planWeek(item, thisWeek()).then(() => toast(`Planned ${refOf(item) || item.title} for this week`)).catch(() => {});
    return true;
  }
  if (action === 'status' && el) { e.preventDefault(); return openControl(el, 'status-select'); }
  if (action === 'priority' && el) { e.preventDefault(); return openControl(el, 'prio-select'); }
  return false;
}
