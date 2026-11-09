// Month as a calendar (views/month.js; mock-up I): what goes in each cell of a month's six weeks. Pure — no DOM and no
// state (what is plannable and what is closed come in as functions), so it is tested on its own
// (tests/js/calendar.test.mjs).
//
//   Week │ Mon … Sun
//   W46  │  9: 11:00 Checkout review (a meeting) · Review the passkeys spec (planned that day) · Due · Map the steps
//   ↑ planned for the week with no day
import { isoWeek, monthGrid, monthOf, today } from './dates.js';

/**
 * The calendar of `month` ('YYYY-MM'): { weeks: [{ week, current, items, days: [{ day, out, past, today, entries }] }],
 * monthOnly }. A day's `entries`, in order: its meetings by time ({ item, kind: 'meeting' }), what is planned for it
 * ('plan'), then what is due that day and planned for another one or none ('due', only while open). A week's `items`:
 * planned for that week with no day. `monthOnly`: planned for the month with neither a week nor a day.
 */
export function monthCalendar(items, month, { plannable = () => true, isDone = () => false, now = today() } = {}) {
  const days = monthGrid(month);
  const planned = items.filter(plannable);
  const meetings = items.filter((i) => i.type === 'meeting' && i.fields.date);
  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const span = days.slice(w * 7, w * 7 + 7);
    const week = isoWeek(span[0]);
    weeks.push({
      week,
      current: week === isoWeek(now),
      items: planned.filter((i) => i.fields.plan_week === week && !i.fields.plan_day),
      days: span.map((day) => ({
        day,
        out: monthOf(day) !== month,
        past: day < now,
        today: day === now,
        entries: [
          ...meetings.filter((m) => m.fields.date === day)
            .sort((a, b) => String(a.fields.time || '').localeCompare(String(b.fields.time || '')))
            .map((item) => ({ item, kind: 'meeting' })),
          ...planned.filter((i) => i.fields.plan_day === day).map((item) => ({ item, kind: 'plan' })),
          ...planned.filter((i) => i.fields.due === day && i.fields.plan_day !== day && !isDone(i)).map((item) => ({ item, kind: 'due' })),
        ],
      })),
    });
  }
  const monthOnly = planned.filter((i) => i.fields.plan_month === month && !i.fields.plan_week && !i.fields.plan_day);
  return { weeks, monthOnly };
}

/** The entries a cell shows: all of them when they fit in `max` (or it is opened), else `max - 1` and "+N more". */
export function cellEntries(entries, { max = 3, opened = false } = {}) {
  if (opened || entries.length <= max) return { shown: entries, more: 0 };
  return { shown: entries.slice(0, max - 1), more: entries.length - (max - 1) };
}
