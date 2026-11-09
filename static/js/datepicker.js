// The app's date picker (shadcn Calendar inside a Popover), in place of the browser's own <input type="date"> popup:
// the same look in every browser and theme, Monday first, English labels like the rest of the page.
//
//   dateInput(value, attrs)          a field that stands in for <input type="date">: `.value` is 'YYYY-MM-DD' or '',
//                                    and picking fires `change` and `input`, so code written for the input keeps working
//   pickDate(anchor, value, onPick)  opens the calendar under any element (Planned's "Pick a date…")
//   calendar(value, onPick)          the panel alone
import { addDays, addMonths, longDate, monthGrid, monthLabel, monthOf, shiftMonth, today } from './dates.js';
import { closeMenu, dropdown, h, icon } from './ui.js';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const KEY_STEP = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/**
 * A month of days with ‹ › to move between months, and Today / Clear underneath. onPick(day) with 'YYYY-MM-DD', or
 * null for Clear. Keyboard as a grid: arrows move a day or a week, PageUp/PageDown a month, Enter picks.
 */
export function calendar(value, onPick, { clearable = true } = {}) {
  let month = monthOf(value || today());
  const el = h('div', { class: 'cal' });

  const render = (focusDay = null) => {
    const now = today();
    // The one day the Tab key reaches (a roving tabindex): the focused one, else the picked one, else today, else the 1st.
    const days = monthGrid(month);
    const tabbable = [focusDay, value, now, `${month}-01`].find((d) => d && monthOf(d) === month);
    const nav = (n, label, ico) => h('button', {
      type: 'button', class: 'btn icon cal-nav', 'aria-label': label, title: label,
      onclick: () => { month = shiftMonth(month, n); render(); },
    }, icon(ico, 16));
    const grid = h('div', { class: 'cal-grid', role: 'grid', 'aria-label': monthLabel(month) },
      WEEKDAYS.map((d) => h('span', { class: 'cal-dow', role: 'columnheader' }, d)),
      days.map((day) => h('button', {
        type: 'button', role: 'gridcell', 'data-day': day, tabindex: day === tabbable ? 0 : -1,
        class: ['cal-day', monthOf(day) !== month && 'outside', day === now && 'today', day === value && 'selected'].filter(Boolean).join(' '),
        'aria-selected': String(day === value), 'aria-label': longDate(day),
        onclick: () => onPick(day),
      }, String(Number(day.slice(8))))));
    el.replaceChildren(
      h('div', { class: 'cal-head' }, nav(-1, 'Previous month', 'left'),
        h('div', { class: 'cal-title', 'aria-live': 'polite' }, monthLabel(month)), nav(1, 'Next month', 'right')),
      grid,
      h('div', { class: 'cal-foot' },
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => onPick(now) }, 'Today'),
        clearable && value ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => onPick(null) }, 'Clear') : null));
    if (focusDay) grid.querySelector(`[data-day="${focusDay}"]`)?.focus();
  };

  el.addEventListener('keydown', (e) => {
    const day = e.target.dataset?.day;
    if (!day) return;
    const next = KEY_STEP[e.key] ? addDays(day, KEY_STEP[e.key])
      : e.key === 'PageUp' ? addMonths(day, -1) : e.key === 'PageDown' ? addMonths(day, 1) : null;
    if (!next) return;
    e.preventDefault();
    month = monthOf(next);
    render(next);
  });
  render();
  return el;
}

/** Open the calendar under `anchor`; onPick(day | null) once a day (or Clear) is chosen. Esc or a click outside cancel. */
export function pickDate(anchor, value, onPick, { clearable = true } = {}) {
  const cal = calendar(value || null, (day) => { closeMenu(); anchor.focus(); onPick(day); }, { clearable });
  dropdown(anchor, [cal], { focus: false });
  cal.querySelector('.cal-day[tabindex="0"]')?.focus();
}

/**
 * A date field: a button with the day in full ("Nov 7, 2026") or a grey placeholder, which opens the calendar.
 * attrs as on any element (aria-label, data-fk…) plus `placeholder` and `clearable` (default true).
 */
export function dateInput(value, { placeholder = 'Pick a date', clearable = true, class: cls = '', ...attrs } = {}) {
  let current = value || '';
  const label = h('span', { class: 'select-label' });
  const btn = h('button', { type: 'button', 'aria-haspopup': 'dialog', ...attrs, class: `select-btn date-btn ${cls}` },
    icon('calendar', 14), label);
  const paint = () => {
    label.textContent = current ? longDate(current) : placeholder;
    btn.classList.toggle('is-empty', !current);
  };
  Object.defineProperty(btn, 'value', { get: () => current, set: (v) => { current = v || ''; paint(); } });
  btn.addEventListener('click', (e) => {
    e.preventDefault(); // inside a <label>: the click is the button's, not a second one from the label
    pickDate(btn, current, (day) => {
      if ((day || '') === current) return;
      btn.value = day;
      btn.dispatchEvent(new Event('input', { bubbles: true }));
      btn.dispatchEvent(new Event('change', { bubbles: true }));
    }, { clearable });
  });
  btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); btn.click(); } });
  paint();
  return btn;
}
