// Reminders, the page's side (tm/reminders.py is the server's): the offsets an item rings at before its moment, and
// the words for them. An item with no `reminders` of its own follows the vault's default (Settings → Reminders), live;
// `[]` is "none". tests/test_reminders.py holds OFFSETS equal to the server's.
import { api } from './api.js';

// id as kept on disk, minutes before, words.
export const OFFSETS = [
  ['at', 0, 'At the time'],
  ['10m', 10, '10 minutes before'],
  ['30m', 30, '30 minutes before'],
  ['1h', 60, '1 hour before'],
  ['2h', 120, '2 hours before'],
  ['1d', 1440, '1 day before'],
];
const SHORT = { '10m': '10 min', '30m': '30 min', '1h': '1 h', '2h': '2 h', '1d': '1 day' };
const RANK = Object.fromEntries(OFFSETS.map(([k], i) => [k, i]));

export const DEFAULTS = { on: true, offsets: ['10m'], urgent: false, duration: '00:30' };

let current = { ...DEFAULTS };
let loaded = null;

/** The vault's reminder defaults (GET /api/vault/settings), read once per vault; `force` reads them again. */
export function loadDefaults(force = false) {
  if (!loaded || force) {
    loaded = api.vaultSettings().then((out) => { current = { ...DEFAULTS, ...(out.reminders || {}) }; return current; })
      .catch(() => current);
  }
  return loaded;
}

/** The defaults as last read (DEFAULTS until loadDefaults has answered). */
export const defaults = () => current;

/** What a Settings save answered: the defaults now. */
export function setDefaults(next) { current = { ...DEFAULTS, ...(next || {}) }; loaded = Promise.resolve(current); }

/** Offsets sorted as OFFSETS, each once, known ones only. */
export const sortOffsets = (list) => [...new Set((list || []).filter((k) => k in RANK))].sort((a, b) => RANK[a] - RANK[b]);

/** Whether an item has a moment to ring before: a planned day with its time, or a meeting's date with its time. */
export const hasMoment = (f) => Boolean((f.plan_day && f.plan_time) || (f.date && f.time));

/** {offsets, urgent, inherited}: what rings for an item, its own or the vault's default. */
export function effective(f, d = current) {
  const own = Array.isArray(f.reminders) ? f.reminders : null;
  const offsets = own ? sortOffsets(own) : (d.on ? sortOffsets(d.offsets) : []);
  const urgent = f.reminder_urgent === true || f.reminder_urgent === false ? f.reminder_urgent : Boolean(d.urgent);
  return { offsets, urgent, inherited: own === null };
}

/** "At the time, 10 min, 1 h before" — or "None". */
export function offsetsText(offsets) {
  const before = offsets.filter((k) => k !== 'at').map((k) => SHORT[k] || k);
  const parts = [offsets.includes('at') ? 'At the time' : null, before.length ? `${before.join(', ')} before` : null].filter(Boolean);
  return parts.length ? parts.join(', ') : 'None';
}

/** The Reminders row's words: "10 min before · Urgent", "Default · 10 min before", "None". */
export function summary(f, d = current) {
  const r = effective(f, d);
  if (!r.offsets.length) return r.inherited ? 'Default · none' : 'None';
  const text = `${offsetsText(r.offsets)}${r.urgent ? ' · Urgent' : ''}`;
  return r.inherited ? `Default · ${text}` : text;
}
