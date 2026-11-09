// An entry of an item's history (tm/history.py: GET /api/item/history) as Activity reads it: "Due: Oct 20 → Oct 25",
// "Ticket ID set to 4521", "Local path cleared (was ~/work)". Who made it, when not you: "· by an agent".
import { shortDate } from './dates.js';

const URL_MAX = 40;

/** A field's name, as Properties names it; `ext` is the structure's external_ref (its label: "Ticket"). */
function fieldName(field, ext = {}) {
  const label = ext.label || 'Ticket';
  const names = {
    status: 'Status', priority: 'Priority', start: 'Start', due: 'Due', planned: 'Planned', local_path: 'Local path',
    [ext.tracker_key || 'tracker']: 'Tracker', [ext.id_key || 'ticket_id']: `${label} ID`, [ext.url_key || 'ticket_url']: `${label} URL`,
  };
  return names[field] || field;
}

/** A value to read: a day as "Oct 25", a status split into words ("InProgress" → "In progress"), a long URL cut. */
function shown(field, value) {
  const v = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return shortDate(v);
  if (field === 'status') {
    const words = v.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
    return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
  }
  return v.length > URL_MAX ? `${v.slice(0, URL_MAX - 1)}…` : v;
}

const BY = { agent: 'by an agent', rule: 'by a rule' };

/** → its line: what changed, from what to what, and who made it when it was not you (`by` other than owner). */
export function historyText({ field, from, to, by } = {}, ext = {}) {
  const name = fieldName(field, ext);
  const has = (v) => v !== null && v !== undefined && v !== '';
  const what = !has(from) ? `${name} set to ${shown(field, to)}`
    : !has(to) ? `${name} cleared (was ${shown(field, from)})`
      : `${name}: ${shown(field, from)} → ${shown(field, to)}`;
  return BY[by] ? `${what} · ${BY[by]}` : what;
}
