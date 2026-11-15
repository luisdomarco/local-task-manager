// The Timeline layout (Goals, Projects, Initiatives: timelineview.js draws it). Pure: no DOM, no state — what runs
// when, on which scale, in which rows, and where a dragged end lands.
//
//   span   an item's [start, end] as days: from `start` (else its planned day, week or month, else the day it was made)
//          to `due` (else the day it closed, else its planned day/week/month's end, else today). A due date with no
//          start nor plan is a milestone: one day, drawn as a diamond.
//   scale  days · weeks · months, each a width per day; zoom doubles or halves it (−3…+3).
//   rows   one per item, under its parent among those shown (goal → project → initiative → story), foldable.
//
// Days are 'YYYY-MM-DD'; inside, a day is its number since 1970-01-01 (UTC, so no clock change shifts it).
import { pad, weekDays } from './dates.js';

const DAY = 86400000;
export const dayNum = (s) => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
export const fromNum = (n) => { const d = new Date(n * DAY); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
const day10 = (v) => (isDay(v) ? v.slice(0, 10) : null);
const monthEnd = (month) => { const [y, m] = month.split('-').map(Number); return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`; };

/** Where an item's plan puts it: [first day, last day] of its planned day, week or month; null when unplanned. */
function planned(f) {
  if (isDay(f.plan_day)) return [f.plan_day.slice(0, 10), f.plan_day.slice(0, 10)];
  if (/^\d{4}-W\d{2}$/.test(f.plan_week || '')) { const w = weekDays(f.plan_week); return [w[0], w[6]]; }
  if (/^\d{4}-\d{2}$/.test(f.plan_month || '')) return [`${f.plan_month}-01`, monthEnd(f.plan_month)];
  return null;
}

/**
 * An item's span: { start, end, milestone } as 'YYYY-MM-DD' (end ≥ start), and `from` / `to` saying where each end came
 * from ('start' | 'plan' | 'created' and 'due' | 'closed' | 'plan' | 'today'): only an end from its own field drags.
 * `closed` tells whether it is done (its closing day ends it); null when it has no day at all to stand on.
 */
export function spanOf(item, { now, closed = false } = {}) {
  const f = item.fields || {};
  const plan = planned(f);
  const start = day10(f.start);
  const due = day10(f.due);
  if (due && !start && !plan) return { start: due, end: due, milestone: true, from: 'due', to: 'due' };
  const s = start || plan?.[0] || day10(f.created_at) || day10(f.creation_date);
  if (!s) return null;
  const doneOn = closed ? day10(f.completed_at) || day10(f.resolved_at) : null;
  const [e, to] = due ? [due, 'due'] : doneOn ? [doneOn, 'closed'] : plan ? [plan[1], 'plan'] : [now, 'today'];
  const from = start ? 'start' : plan ? 'plan' : 'created';
  return e < s ? { start: s, end: s, milestone: false, from, to } : { start: s, end: e, milestone: false, from, to };
}

// ── scale ────────────────────────────────────────────────────────────────────
export const SCALES = { days: 32, weeks: 10, months: 2.5 }; // px per day at zoom 0
export const ZOOM = [-3, 3];
/** Pixels per day for a scale at a zoom (each step doubles or halves it). */
export const pxPerDay = (scale, zoom = 0) => (SCALES[scale] || SCALES.weeks) * 2 ** Math.max(ZOOM[0], Math.min(ZOOM[1], zoom));

/** The first day of the unit `day` falls in: itself, its Monday, the 1st of its month, or of its year. */
export function unitStart(day, unit) {
  if (unit === 'week') return weekDays(isoWeekOf(day))[0];
  if (unit === 'month') return `${day.slice(0, 7)}-01`;
  if (unit === 'year') return `${day.slice(0, 4)}-01-01`;
  return day;
}
const isoWeekOf = (day) => {
  const n = dayNum(day);
  const thu = n - ((new Date(n * DAY).getUTCDay() + 6) % 7) + 3;
  const y = new Date(thu * DAY).getUTCFullYear();
  return `${y}-W${pad(Math.floor((thu - dayNum(`${y}-01-01`)) / 7) + 1)}`;
};
const nextUnit = (day, unit) => {
  if (unit === 'day') return fromNum(dayNum(day) + 1);
  if (unit === 'week') return fromNum(dayNum(day) + 7);
  const [y, m] = day.split('-').map(Number);
  return unit === 'month' ? (m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`) : `${y + 1}-01-01`;
};
const UNITS = { days: ['day', 'month'], weeks: ['week', 'month'], months: ['month', 'year'] }; // [tick, band over it]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The days the timeline shows: every span and today, a margin around, from the start of a tick unit (a Monday on
 * Weeks, the 1st on Months) → { from, to } ('YYYY-MM-DD', `to` included).
 */
export function rangeOf(spans, now, scale = 'weeks') {
  const days = [now, ...spans.flatMap((s) => (s ? [s.start, s.end] : []))];
  const min = days.reduce((a, b) => (b < a ? b : a));
  const max = days.reduce((a, b) => (b > a ? b : a));
  const margin = { days: 3, weeks: 14, months: 45 }[scale] ?? 14;
  const [unit] = UNITS[scale] || UNITS.weeks;
  return { from: unitStart(fromNum(dayNum(min) - margin), unit), to: fromNum(dayNum(max) + margin) };
}

/**
 * `range` with its end pushed on until it covers at least `minDays` days, so a zoomed-out timeline still fills the width
 * it has (its start stays where it is). A range already that long, or longer, is returned as it is.
 */
export function fillRange(range, minDays) {
  const days = dayNum(range.to) - dayNum(range.from) + 1;
  return days >= minDays ? range : { from: range.from, to: fromNum(dayNum(range.from) + Math.ceil(minDays) - 1) };
}

/**
 * The header's two lines over `range`: `bands` (months, or years on Months) and `ticks` (days, weeks or months), each
 * { day, days, label } — where it starts and how many days it covers, cut to the range.
 */
export function ticksOf(range, scale = 'weeks') {
  const [tick, band] = UNITS[scale] || UNITS.weeks;
  const label = (day, unit) => (unit === 'day' ? String(Number(day.slice(8)))
    : unit === 'week' ? `W${isoWeekOf(day).slice(6)}`
      : unit === 'month' ? (band === 'year' ? MONTHS[Number(day.slice(5, 7)) - 1] : `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`)
        : day.slice(0, 4));
  const cut = (unit) => {
    const out = [];
    const end = dayNum(range.to) + 1;
    for (let d = unitStart(range.from, unit); dayNum(d) < end; d = nextUnit(d, unit)) {
      const a = Math.max(dayNum(d), dayNum(range.from));
      const b = Math.min(dayNum(nextUnit(d, unit)), end);
      out.push({ day: fromNum(a), days: b - a, label: label(d, unit), ...(unit === 'day' ? { weekend: [0, 6].includes(new Date(a * DAY).getUTCDay()) } : {}) });
    }
    return out;
  };
  return { bands: cut(band), ticks: cut(tick) };
}

/** A day's left edge in pixels from the range's start, and back (the day a pixel falls in). */
export const xOf = (day, from, ppd) => (dayNum(day) - dayNum(from)) * ppd;
export const dayAt = (x, from, ppd) => fromNum(dayNum(from) + Math.floor(x / ppd));

/**
 * A span after dragging `edge` ('start', 'end', or 'move' for both) by `delta` days: { start, end }, never ending before
 * it starts (an end dragged past its start stops there).
 */
export function dragSpan({ start, end }, edge, delta) {
  const s = dayNum(start);
  const e = dayNum(end);
  if (edge === 'move') return { start: fromNum(s + delta), end: fromNum(e + delta) };
  if (edge === 'start') return { start: fromNum(Math.min(s + delta, e)), end };
  return { start, end: fromNum(Math.max(e + delta, s)) };
}

// ── rows ─────────────────────────────────────────────────────────────────────
/**
 * Where an item hangs among `shown` (a Map of id → item): its parent (`related_to`: a story's initiative), else its
 * project (an initiative's, by key), else its goal; null at the top. A project never hangs from a project.
 */
export function parentAmong(item, shown, projects = new Map()) {
  const f = item.fields || {};
  const byKey = item.type !== 'project' && f.project ? projects.get(f.project) : null;
  for (const p of [shown.get(f.related_to), byKey && shown.get(byKey.id), shown.get(f.goal)]) {
    if (p && p.id !== item.id) return p;
  }
  return null;
}

/**
 * The rows, in the order `items` come, each under its parent among them: [{ item, depth, kids, folded }], a folded
 * one's descendants left out (`folded` a Set of ids). `kids`: how many rows hang from it.
 */
export function rowsOf(items, { folded = new Set() } = {}) {
  const shown = new Map(items.filter((i) => i.id != null).map((i) => [i.id, i]));
  const projects = new Map(items.filter((i) => i.type === 'project' && i.fields?.project_key).map((i) => [i.fields.project_key, i]));
  const kids = new Map();
  const roots = [];
  for (const it of items) {
    let p = parentAmong(it, shown, projects);
    // A loop (A under B under A) is cut where it closes: the item goes to the top.
    for (let up = p, seen = new Set([it.id]); up; up = parentAmong(up, shown, projects)) {
      if (seen.has(up.id)) { p = null; break; }
      seen.add(up.id);
    }
    if (p) { if (!kids.has(p.id)) kids.set(p.id, []); kids.get(p.id).push(it); } else roots.push(it);
  }
  const out = [];
  const walk = (it, depth) => {
    const mine = kids.get(it.id) || [];
    const isFolded = folded.has(it.id);
    out.push({ item: it, depth, kids: mine.length, folded: isFolded && mine.length > 0 });
    if (!isFolded) for (const k of mine) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out;
}

/** What a type's timeline can show under its items: a project its initiatives and their stories, an initiative its stories. */
export const KIDS = { goal: ['project', 'initiative', 'story'], project: ['initiative', 'story'], initiative: ['story'] };

/**
 * `items` and, after them, those of `candidates` that hang from them — directly or through another candidate (a story
 * under an initiative of a shown project) — in the candidates' order. The rest of the candidates are left out.
 */
export function withKids(items, candidates) {
  const shown = new Map(items.filter((i) => i.id != null).map((i) => [i.id, i]));
  const projects = new Map([...items, ...candidates].filter((i) => i.type === 'project' && i.fields?.project_key).map((i) => [i.fields.project_key, i]));
  const kept = new Set();
  for (let grew = true; grew;) {
    grew = false;
    for (const c of candidates) {
      if (kept.has(c) || shown.has(c.id) || !parentAmong(c, shown, projects)) continue;
      kept.add(c);
      shown.set(c.id, c);
      grew = true;
    }
  }
  return [...items, ...candidates.filter((c) => kept.has(c))];
}
