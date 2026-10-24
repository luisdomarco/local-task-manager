// Time spent on a work-log entry, as "HH:MM" (hours may pass 24: "26:30").
const TIME_RE = /^(\d{1,3}):([0-5]\d)$/;

export const toMinutes = (t) => {
  const m = TIME_RE.exec(String(t || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

export const fromMinutes = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/**
 * What the user typed → "HH:MM", or null when it is not a time. Blank is 00:00.
 * Forgiving: "1:30" → 01:30, "130" → 01:30, "0045" → 00:45, "2" (hours) → 02:00.
 */
export function cleanTime(value) {
  const v = String(value ?? '').trim();
  if (!v) return '00:00';
  if (/^\d{1,2}$/.test(v)) return `${v.padStart(2, '0')}:00`;
  const digits = /^(\d{1,2})(\d{2})$/.exec(v);
  const text = digits ? `${digits[1]}:${digits[2]}` : v;
  const m = TIME_RE.exec(text);
  return m && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

/** Whether a work-log entry is only proposed (by the worklog proposal command) and not confirmed yet. */
export const isTentative = (e) => e?.status === 'tentative';

/** Total time of a list of entries; a tentative one does not count until confirmed. */
export const sumTime = (entries) => fromMinutes(entries.reduce((n, e) => n + (isTentative(e) ? 0 : toMinutes(e.time)), 0));
