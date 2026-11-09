// Scheduled agent runs, the pure part (views/runs.js, views/settings.js): the rule the Schedule dialog builds from its
// fields, and when a schedule fires next, said short. What a rule means — its words and its next time — is the
// server's (tm/schedules.py label, next_ts): nothing here works one out.
export const REPEATS = [['day', 'Every day'], ['weekday', 'Every weekday'], ['week', 'On some days'], ['hours', 'Every few hours']];
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // 0 is Monday, as in tm/schedules.py
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The rule of the dialog's fields: only what its kind uses. */
export function ruleFrom({ every = 'day', at = '09:00', days = [], hours = 6 } = {}) {
  const rule = { every, at };
  if (every === 'week') rule.days = [...new Set(days.map(Number))].sort((a, b) => a - b);
  if (every === 'hours') rule.hours = Number(hours);
  return rule;
}

/** The dialog's fields of a rule (a schedule being changed), with the defaults for what its kind does not use. */
export function fieldsOf(rule = {}) {
  return { every: rule.every || 'day', at: rule.at || '09:00', days: rule.days || [0, 1, 2, 3, 4], hours: rule.hours || 6 };
}

const clock = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** A moment near now, in local time — when it fires next, or last ran: 'today 9:00', 'tomorrow 9:00',
 *  'yesterday 9:00', 'Tue 9:00' within a week either way, else '12 Nov 9:00'. */
export function nextLabel(ts, now = Date.now()) {
  if (!ts) return '';
  const at = new Date(ts);
  const days = Math.round((dayStart(at) - dayStart(new Date(now))) / 86_400_000);
  if (days === 0) return `today ${clock(at)}`;
  if (days === 1) return `tomorrow ${clock(at)}`;
  if (days === -1) return `yesterday ${clock(at)}`;
  if (Math.abs(days) < 7) return `${DAY_NAMES[(at.getDay() + 6) % 7]} ${clock(at)}`;
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${clock(at)}`;
}

/** How long until then: 'in 5 min', 'in 3 h', 'in 2 d' ('now' when due). */
export function inLabel(ts, now = Date.now()) {
  const min = Math.round((ts - now) / 60_000);
  if (min <= 0) return 'now';
  if (min < 60) return `in ${min} min`;
  if (min < 48 * 60) return `in ${Math.round(min / 60)} h`;
  return `in ${Math.round(min / 1440)} d`;
}

/** A schedule's state for its chip: paused, or its last run could not start, or on. */
export function scheduleState(s) {
  if (s.paused) return { key: 'paused', label: 'Paused', tone: 'muted' };
  if (s.error) return { key: 'error', label: 'Could not start', tone: 'error' };
  return { key: 'on', label: 'On', tone: 'success' };
}
