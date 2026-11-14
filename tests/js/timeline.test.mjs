import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayAt, dayNum, dragSpan, fromNum, parentAmong, withKids, pxPerDay, rangeOf, rowsOf, spanOf, ticksOf, unitStart, xOf } from '../../static/js/timeline.js';

const it = (id, type, fields = {}) => ({ id, key: `K-${id}`, type, title: `${type} ${id}`, fields });
const NOW = '2026-11-14';

test('days count across a clock change and back', () => {
  assert.equal(dayNum('2026-03-30') - dayNum('2026-03-28'), 2);
  assert.equal(fromNum(dayNum('2026-10-25') + 1), '2026-10-26');
  assert.equal(fromNum(dayNum('2024-02-28') + 1), '2024-02-29');
});

test('a span: start to due, else what the plan, the closing day or today say', () => {
  assert.deepEqual(spanOf(it(1, 'initiative', { start: '2026-11-02', due: '2026-12-01' }), { now: NOW }),
    { start: '2026-11-02', end: '2026-12-01', milestone: false, from: 'start', to: 'due' });
  assert.deepEqual(spanOf(it(2, 'initiative', { plan_week: '2026-W46' }), { now: NOW }),
    { start: '2026-11-09', end: '2026-11-15', milestone: false, from: 'plan', to: 'plan' });
  assert.deepEqual(spanOf(it(3, 'project', { plan_month: '2026-02' }), { now: NOW }).end, '2026-02-28');
  assert.deepEqual(spanOf(it(4, 'goal', { created_at: '2026-10-01T09:15' }), { now: NOW }),
    { start: '2026-10-01', end: NOW, milestone: false, from: 'created', to: 'today' });
  const done = it(5, 'goal', { start: '2026-09-01', completed_at: '2026-10-10T17:05' });
  assert.equal(spanOf(done, { now: NOW, closed: true }).end, '2026-10-10');
  assert.equal(spanOf(done, { now: NOW, closed: false }).end, NOW);
  assert.equal(spanOf(it(6, 'goal', {}), { now: NOW }), null);
});

test('a due date alone is a milestone; an end before its start is the start', () => {
  assert.deepEqual(spanOf(it(1, 'initiative', { due: '2026-12-24' }), { now: NOW }),
    { start: '2026-12-24', end: '2026-12-24', milestone: true, from: 'due', to: 'due' });
  const back = spanOf(it(2, 'initiative', { start: '2026-12-01', due: '2026-11-01' }), { now: NOW });
  assert.deepEqual([back.start, back.end], ['2026-12-01', '2026-12-01']);
});

test('scale and zoom: each step doubles, within its bounds', () => {
  assert.equal(pxPerDay('days'), 32);
  assert.equal(pxPerDay('weeks', 1), 20);
  assert.equal(pxPerDay('months', -1), 1.25);
  assert.equal(pxPerDay('weeks', 9), pxPerDay('weeks', 3));
});

test('the range holds every span and today, from the start of a tick', () => {
  const spans = [{ start: '2026-10-07', end: '2026-12-02' }, null];
  const r = rangeOf(spans, NOW, 'weeks');
  assert.equal(r.from, unitStart(r.from, 'week'));
  assert.ok(r.from <= '2026-09-23' && r.to >= '2026-12-16');
  assert.equal(rangeOf([], NOW, 'months').from.slice(8), '01');
  assert.equal(unitStart('2026-11-14', 'week'), '2026-11-09');
  assert.equal(unitStart('2026-11-14', 'year'), '2026-01-01');
});

test('ticks and bands cover the range, cut at its ends', () => {
  const range = { from: '2026-10-26', to: '2026-11-08' };
  const w = ticksOf(range, 'weeks');
  assert.deepEqual(w.ticks.map((t) => [t.label, t.days]), [['W44', 7], ['W45', 7]]);
  assert.deepEqual(w.bands.map((b) => [b.label, b.days]), [['Oct 2026', 6], ['Nov 2026', 8]]);
  const d = ticksOf({ from: '2026-11-13', to: '2026-11-16' }, 'days');
  assert.deepEqual(d.ticks.map((t) => [t.label, !!t.weekend]), [['13', false], ['14', true], ['15', true], ['16', false]]);
  const m = ticksOf({ from: '2026-12-01', to: '2027-01-31' }, 'months');
  assert.deepEqual(m.ticks.map((t) => t.label), ['Dec', 'Jan']);
  assert.deepEqual(m.bands.map((b) => b.label), ['2026', '2027']);
  for (const s of [w, d, m]) assert.equal(s.ticks.reduce((n, t) => n + t.days, 0), s.bands.reduce((n, b) => n + b.days, 0));
});

test('pixels and days', () => {
  assert.equal(xOf('2026-11-16', '2026-11-09', 10), 70);
  assert.equal(dayAt(75, '2026-11-09', 10), '2026-11-16');
  assert.equal(dayAt(69, '2026-11-09', 10), '2026-11-15');
});

test('dragging an end never crosses the other; a move keeps the length', () => {
  const s = { start: '2026-11-09', end: '2026-11-15' };
  assert.deepEqual(dragSpan(s, 'end', 3), { start: '2026-11-09', end: '2026-11-18' });
  assert.deepEqual(dragSpan(s, 'end', -10), { start: '2026-11-09', end: '2026-11-09' });
  assert.deepEqual(dragSpan(s, 'start', 10), { start: '2026-11-15', end: '2026-11-15' });
  assert.deepEqual(dragSpan(s, 'move', -2), { start: '2026-11-07', end: '2026-11-13' });
});

test('rows nest goal → project → initiative → story, in the order given', () => {
  const goal = it(1, 'goal');
  const proj = it(2, 'project', { project_key: 'ACME', goal: 1 });
  const ini = it(3, 'initiative', { project: 'ACME' });
  const sty = it(4, 'story', { related_to: 3, project: 'ACME' });
  const lone = it(5, 'initiative', { project: 'OTHER', goal: 1 });
  const rows = rowsOf([goal, proj, ini, sty, lone]);
  assert.deepEqual(rows.map((r) => [r.item.id, r.depth, r.kids]), [[1, 0, 2], [2, 1, 1], [3, 2, 1], [4, 3, 0], [5, 1, 0]]);
  // without the project shown, the initiative hangs from nothing; folded, a row hides what hangs from it
  assert.deepEqual(rowsOf([ini, sty]).map((r) => [r.item.id, r.depth]), [[3, 0], [4, 1]]);
  assert.deepEqual(rowsOf([goal, proj, ini, sty], { folded: new Set([2]) }).map((r) => [r.item.id, r.folded]), [[1, false], [2, true]]);
  assert.equal(parentAmong(proj, new Map([[2, proj]]), new Map([['ACME', proj]])), null);
});

test('a loop of parents is cut', () => {
  const a = it(1, 'initiative', { related_to: 2 });
  const b = it(2, 'initiative', { related_to: 1 });
  const rows = rowsOf([a, b]);
  assert.equal(rows.length, 2);
  assert.ok(rows.some((r) => r.depth === 0));
});

test('a list keeps the children of what it shows, and only those', () => {
  const proj = it(1, 'project', { project_key: 'ACME' });
  const ini = it(2, 'initiative', { project: 'ACME' });
  const other = it(3, 'initiative', { project: 'ZED' });
  const sty = it(4, 'story', { related_to: 2 });
  const stray = it(5, 'story', { related_to: 3 });
  assert.deepEqual(withKids([proj], [sty, stray, ini, other]).map((i) => i.id), [1, 4, 2]);
  assert.deepEqual(rowsOf(withKids([proj], [sty, stray, ini, other])).map((r) => [r.item.id, r.depth]), [[1, 0], [2, 1], [4, 2]]);
});
