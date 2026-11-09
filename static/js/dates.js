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
export function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
/** The same day `n` months on; a day the target month lacks (the 31st) becomes its last. */
export function addMonths(day, n) {
  const month = shiftMonth(monthOf(day), n);
  const [y, m] = month.split('-').map(Number);
  return `${month}-${pad(Math.min(Number(day.slice(8, 10)), new Date(y, m, 0).getDate()))}`;
}
/** The 42 days a month's calendar shows, Monday first: always six weeks, so the calendar never changes height. */
export function monthGrid(month) {
  const first = `${month}-01`;
  const start = addDays(first, -((parseYmd(first).getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

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

/** A moment the file records (created_at, updated_at: "2026-10-20T09:54"), to read: "Oct 20, 09:54" — the year
 *  only when it is not this one; the day alone when it has no time. */
export function stampLabel(s) {
  if (!s) return '';
  const time = /^\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2})/.exec(String(s))?.[1];
  return time ? `${shortDate(s)}, ${time}` : shortDate(s);
}

/** How long ago a local moment was ("2026-10-20T09:54"), short: "just now", "5 min ago", "3 h ago" (under a day),
 *  "Yesterday", then its day ("Oct 2"). A moment ahead of now (another clock) reads "just now". */
export function agoLabel(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(s || ''));
  if (!m) return '';
  const at = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  const mins = Math.floor((Date.now() - at.getTime()) / 60000);
  if (!m[4]) return relDay(s.slice(0, 10));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ago`;
  return s.slice(0, 10) === addDays(today(), -1) ? 'Yesterday' : shortDate(s);
}

/** A day in full, for a date field: "Nov 7, 2026". */
export function longDate(s) {
  if (!s) return '';
  const d = parseYmd(s.slice(0, 10));
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
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

/**
 * How late something planned in the past is, from its plan fields (a day, else a week, else a month):
 * { since, text } — since what ("Oct 20", "W43", "Oct") and how long ("Yesterday", "18 d late", "2 wk late", "1 mo late");
 * null when its plan is not in the past.
 */
export function lateBy({ plan_day: day, plan_week: week, plan_month: month } = {}) {
  const t = today();
  if (day) {
    if (day >= t) return null;
    const days = Math.round((parseYmd(t) - parseYmd(day)) / 86400000);
    return { since: shortDate(day), text: days === 1 ? 'Yesterday' : `${days} d late` };
  }
  if (week) {
    const now = thisWeek();
    if (week >= now) return null;
    const weeks = Math.round((parseYmd(weekDays(now)[0]) - parseYmd(weekDays(week)[0])) / (7 * 86400000));
    return { since: week.split('-')[1], text: `${weeks} wk late` };
  }
  if (month) {
    const now = thisMonth();
    if (month >= now) return null;
    const [y1, m1] = now.split('-').map(Number);
    const [y0, m0] = month.split('-').map(Number);
    return { since: monthLabel(month, true), text: `${(y1 - y0) * 12 + (m1 - m0)} mo late` };
  }
  return null;
}
