// The Inbox's captured items: their order (the last changed first) and the "Updated" line each card shows. Pure (no
// DOM, no state), tested on its own (tests/js/inboxitems.test.mjs); the page that draws them is views/inbox.js.
import { relDay } from './dates.js';
import { commentAts } from './comments.js';

const idNumber = (i) => Number(/(\d+)$/.exec(String(i.id || ''))?.[1]) || 0;

/** Newest capture first: by `created_at` (a day in a Projects vault, a day and a time in a legacy one), then — the same
 *  day — by the id's number, one counter per vault, so a higher one was captured later. A comparator. */
export function byNewestCapture(a, b) {
  return String(b.fields.created_at || '').localeCompare(String(a.fields.created_at || '')) || idNumber(b) - idNumber(a);
}

const pad = (n) => String(n).padStart(2, '0');

/** "YYYY-MM-DDTHH:MM", local time, of epoch seconds. */
export function localStamp(secs) {
  const d = new Date(secs * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The moment of its last comment (comments.js: where comments are files, writing one leaves the item's file as it
 *  was), as "YYYY-MM-DDTHH:MM:SS…", or ''. */
const lastComment = (item) => commentAts(item).at(-1) || '';

/** When it last changed, in ms: its file's time (`mtime`: here or in Obsidian), else its `updated_at` — or its last
 *  comment, when that came later. */
const changedAt = (i) => Math.max(i.mtime ? i.mtime * 1000 : Date.parse(String(i.fields?.updated_at || '')) || 0,
  Date.parse(lastComment(i)) || 0);

/** When it last changed, as "YYYY-MM-DDTHH:MM" (or the day alone): its file's time (`mtime`: here or in Obsidian), else
 *  its `updated_at`, or its last comment when later; '' when none is known. */
export function updatedStamp(item) {
  const own = item.mtime ? localStamp(item.mtime) : String(item.fields?.updated_at || '');
  const said = lastComment(item);
  return said && (Date.parse(said) || 0) > (item.mtime ? item.mtime * 1000 : Date.parse(own) || 0) ? said.slice(0, 16) : own;
}

/** The Inbox's order: the last changed first (by its file's time, to the second, else by `updated_at`, or by its last
 *  comment when later), the same time newest capture first. A comparator. */
export function byLastUpdated(a, b) {
  return changedAt(b) - changedAt(a) || byNewestCapture(a, b);
}

/** When it last changed, to read on its card: "Updated Today, 10:42", "Updated Yesterday, 18:05", "Updated Nov 3, 09:12".
 *  From its file's time (`mtime`: here or in Obsidian), else its `updated_at` (a day alone, or a day and a time); ''
 *  when neither is known. */
export function updatedLabel(item) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(updatedStamp(item));
  if (!m) return '';
  return `Updated ${relDay(m[1])}${m[2] ? `, ${m[2]}` : ''}`;
}
