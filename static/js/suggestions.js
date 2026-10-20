// Work-log suggestions: what you probably worked on but did not log.
//
// Every item records when it was created, last edited, closed or resolved, and when each
// comment was written; a meeting records its date. From those timestamps, an item "had
// activity" on a day when one of them falls on it. If you logged no work for that item on
// that day, it is suggested, with a guess at the kind of work and the reasons as the note.
//
// It is a heuristic and says so: an item only remembers its LAST edit, so older days show
// less than they did. Nothing is saved until you accept a suggestion.
import { pref, setPref } from './prefs.js';

const dayOf = (stamp) => String(stamp || '').slice(0, 10);

/** Which kind of work an item's activity most likely was; the user can change it before accepting. */
export function guessKind(item, reasons) {
  switch (item.type) {
    case 'meeting': return 'Meeting';
    case 'activity': return 'Management';
    case 'note': return 'Definition';
    case 'transcription': return 'Meeting';
    default: // tasks and initiatives
      return reasons.has('closed') || item.fields.status === 'Review' ? 'Testing' : 'Analysis';
  }
}

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

/**
 * suggestLog({ items, worklog, from, to, today, dismissed }) → suggestions, newest day first:
 *   [{ key, date, id, itemKey, title, type, kind, reasons: string[], note }]
 * `from` / `to` bound the days ('' is open); `dismissed` is a Set of `${date}|${id}` keys.
 */
export function suggestLog({ items, worklog, from = '', to = '', today, dismissed = new Set() }) {
  const upper = !to || to > today ? today : to; // never suggest the future
  const inRange = (d) => d && d.length === 10 && (!from || d >= from) && d <= upper;
  const logged = new Set(worklog.map((e) => `${e.date}|${e.id}`));
  const found = new Map(); // `${date}|${id}` → { item, reasons: Set, comments: n }

  const note = (item, date, reason) => {
    if (!inRange(date)) return;
    const key = `${date}|${item.id}`;
    const hit = found.get(key) || { item, date, reasons: new Set(), comments: 0 };
    if (reason === 'comment') hit.comments += 1; else hit.reasons.add(reason);
    found.set(key, hit);
  };

  for (const item of items) {
    if (!item.id || item.type === 'inbox' || item.type === 'prompt' || item.fields.archived === true) continue; // a prompt is a template, not work
    const f = item.fields;
    note(item, dayOf(f.created_at), 'created');
    note(item, dayOf(f.completed_at), 'closed');
    note(item, dayOf(f.resolved_at), 'resolved');
    if (item.type === 'meeting') note(item, dayOf(f.date), 'held');
    for (const c of f.comments || []) note(item, dayOf(c.at), 'comment');
    note(item, dayOf(f.updated_at), 'edited');
  }

  const out = [];
  for (const [key, hit] of found) {
    if (logged.has(key) || dismissed.has(key)) continue;
    const { item, date, reasons, comments } = hit;
    // "edited" says nothing the other reasons do not say better.
    if (reasons.size > 1 || comments) reasons.delete('edited');
    const parts = [...reasons].map((r) => ({ created: 'Created', closed: 'Closed', resolved: 'Resolved', held: 'Meeting held', edited: 'Edited' }[r]));
    if (comments) parts.push(plural(comments, 'comment'));
    out.push({
      key, date, id: item.id, itemKey: item.key, title: item.title, type: item.type,
      kind: guessKind(item, reasons), reasons: parts, note: parts.join(' · '),
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

// Dismissed suggestions are remembered in this browser only: they are a convenience, not data. They name
// ids, so each vault keeps its own (prefs.js).
export function loadDismissed() {
  const saved = pref('logDismissed', []);
  return new Set(Array.isArray(saved) ? saved : []);
}
export function saveDismissed(set) {
  setPref('logDismissed', [...set]);
}
