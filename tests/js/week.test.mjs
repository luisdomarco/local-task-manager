import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { pickDays, weekBuckets } from '../../static/js/rules.js';
import { freezeDate, unfreezeDate } from './helpers.mjs';

// Today is Thursday 2026-10-15, in 2026-W42 (helpers.mjs).
const task = (id, fields) => ({ id, key: id, type: 'task', fields: { status: 'ToDo', ...fields } });

describe('the Week view\'s buckets (list and board)', () => {
  beforeEach(freezeDate);
  afterEach(unfreezeDate);

  const items = [
    task('A', { plan_week: '2026-W42' }),                                   // this week, any day
    task('B', { plan_week: '2026-W42', plan_day: '2026-10-13' }),           // Tuesday
    task('C', { plan_day: '2026-10-18' }),                                  // Sunday, no week written
    task('D', { plan_week: '2026-W41' }),                                   // an earlier week, still open
    task('E', { plan_week: '2026-W41', status: 'Done' }),                   // an earlier week, done
    task('F', { plan_week: '2026-W42', plan_day: '2026-10-13', status: 'Done' }),
    task('G', { plan_week: '2026-W43' }),                                   // next week
  ];
  const ids = (list) => list.map((i) => i.id);

  it('splits this week into carried over, anytime and its seven days', () => {
    const b = weekBuckets(items, '2026-W42');
    assert.deepEqual(b.days, ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
    assert.deepEqual(ids(b.carried), ['D']);
    assert.deepEqual(ids(b.anytime), ['A']);
    assert.deepEqual(ids(b.byDay['2026-10-13']), ['B', 'F']);
    assert.deepEqual(ids(b.byDay['2026-10-18']), ['C']);
    assert.deepEqual(ids(b.byDay['2026-10-14']), []);
  });

  it('hides the closed ones on request, and carries nothing over into another week', () => {
    assert.deepEqual(ids(weekBuckets(items, '2026-W42', { hideDone: true }).byDay['2026-10-13']), ['B']);
    const next = weekBuckets(items, '2026-W43');
    assert.deepEqual([ids(next.carried), ids(next.anytime)], [[], ['G']]);
  });

  it('orders each bucket as asked', () => {
    const b = weekBuckets(items, '2026-W42', { sort: (x, y) => y.id.localeCompare(x.id) });
    assert.deepEqual(ids(b.byDay['2026-10-13']), ['F', 'B']);
  });

  it('keeps the board to the weekdays picked, all of them when none is', () => {
    const { days } = weekBuckets(items, '2026-W42');
    assert.deepEqual(pickDays(days, []), days);
    assert.deepEqual(pickDays(days, [6, 0, 2]), ['2026-10-12', '2026-10-14', '2026-10-18']); // Mon, Wed, Sun in order
  });
});
