// Local-time date helpers. Days are 'YYYY-MM-DD', weeks are ISO 'YYYY-Www'
// (the same format <input type="week"> uses), so plain string comparison orders them.

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => ymd(new Date());

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function isoWeek(s) {
  const d = parseYmd(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3); // Thursday decides the ISO year
  const days = Math.round((d - new Date(d.getFullYear(), 0, 1)) / 86400000);
  return `${d.getFullYear()}-W${pad(Math.floor(days / 7) + 1)}`;
}

export function weekDays(week) {
  const [y, w] = week.split('-W').map(Number);
  const jan4 = new Date(y, 0, 4);
  const monday = ymd(new Date(y, 0, 4 - ((jan4.getDay() + 6) % 7) + (w - 1) * 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export const thisWeek = () => isoWeek(today());
export const shiftWeek = (week, n) => isoWeek(addDays(weekDays(week)[0], 7 * n));

// Months are 'YYYY-MM': they sort as strings too. A week belongs to the month of its Thursday, as ISO weeks do to years.
export const monthOf = (day) => day.slice(0, 7);
export const weekMonth = (week) => monthOf(weekDays(week)[3]);
export const thisMonth = () => monthOf(today());

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Next date (today included) that falls on the given weekday name: 'mon'…'sun'. */
export function nextDow(name) {
  const target = DOW.indexOf(name.slice(0, 3).toLowerCase());
  if (target < 0) return null;
  const d = new Date();
  d.setDate(d.getDate() + ((target - d.getDay() + 7) % 7));
  return ymd(d);
}

export function shortDate(s) {
  if (!s) return '';
  const d = parseYmd(s.slice(0, 10));
  const label = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date().getFullYear() ? label : `${label} ${d.getFullYear()}`;
}

export function dayLabel(s) {
  const d = parseYmd(s);
  return `${DOW[d.getDay()][0].toUpperCase()}${DOW[d.getDay()].slice(1)} ${d.getDate()}`;
}

export function relDay(s) {
  if (!s) return '';
  const t = today();
  if (s === t) return 'Today';
  if (s === addDays(t, 1)) return 'Tomorrow';
  if (s === addDays(t, -1)) return 'Yesterday';
  return shortDate(s);
}

/** 'YYYY-MM' → "October 2026"; `short` → "Oct" (this year) or "Oct 2027". */
export function monthLabel(month, short = false) {
  const [y, m] = month.split('-').map(Number);
  if (short) return y === new Date().getFullYear() ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${y}`;
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

export function weekLabel(week) {
  const days = weekDays(week);
  return `${week.split('-')[1]} · ${shortDate(days[0])} – ${shortDate(days[6])}`;
}
