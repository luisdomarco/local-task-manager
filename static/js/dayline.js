// The line under Today's date: how the day goes, in words — no bars, no cards. Pure (tests/js/dayline.test.mjs).

/** Minutes as "1h 30m", "45m", "2h". */
export const minutesLabel = (n) => {
  const h = Math.floor(n / 60);
  const m = n % 60;
  return [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ') || '0m';
};

/**
 * What the day says, as short phrases to join with " · ":
 *   planned  — today's items, each { done } (closed ones count as done)   → "2 of 5 done"
 *   minutes  — the time logged today (confirmed entries)                    → "1h 30m logged"
 *   meetings — today's meetings, each { time: 'HH:MM' | '', title }         → "next: Pricing kick-off at 10:00"
 *   now      — 'HH:MM', the time now: the next meeting is the first not started yet
 * A part with nothing to say is left out.
 */
export function daySummary({ planned = [], minutes = 0, meetings = [], now = '00:00' } = {}) {
  const parts = [];
  if (planned.length) parts.push(`${planned.filter((p) => p.done).length} of ${planned.length} done`);
  if (minutes > 0) parts.push(`${minutesLabel(minutes)} logged`);
  const next = meetings.filter((m) => m.time && m.time >= now).sort((a, b) => a.time.localeCompare(b.time))[0];
  if (next) parts.push(`next: ${next.title} at ${next.time}`);
  return parts;
}
