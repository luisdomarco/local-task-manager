import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fieldsOf, inLabel, nextLabel, ruleFrom, scheduleState } from '../../static/js/schedmodel.js';

describe('schedmodel', () => {
  it('builds a rule with only what its kind uses', () => {
    assert.deepEqual(ruleFrom({ every: 'day', at: '09:00', days: [1], hours: 3 }), { every: 'day', at: '09:00' });
    assert.deepEqual(ruleFrom({ every: 'week', at: '08:30', days: ['4', 0, 4] }), { every: 'week', at: '08:30', days: [0, 4] });
    assert.deepEqual(ruleFrom({ every: 'hours', at: '00:00', hours: '6' }), { every: 'hours', at: '00:00', hours: 6 });
    assert.deepEqual(fieldsOf({ every: 'hours', at: '07:00', hours: 2 }), { every: 'hours', at: '07:00', days: [0, 1, 2, 3, 4], hours: 2 });
    assert.deepEqual(fieldsOf(), { every: 'day', at: '09:00', days: [0, 1, 2, 3, 4], hours: 6 });
  });

  it('says when it fires next, and how long until then', () => {
    const now = Date.UTC(2026, 10, 9, 10, 0); // Monday 9 Nov 2026, 10:00 (TZ=UTC)
    assert.equal(nextLabel(Date.UTC(2026, 10, 9, 18, 5), now), 'today 18:05');
    assert.equal(nextLabel(Date.UTC(2026, 10, 10, 9, 0), now), 'tomorrow 9:00');
    assert.equal(nextLabel(Date.UTC(2026, 10, 13, 9, 0), now), 'Fri 9:00');
    assert.equal(nextLabel(Date.UTC(2026, 10, 20, 9, 0), now), '20 Nov 9:00');
    assert.equal(nextLabel(0, now), '');
    assert.equal(nextLabel(Date.UTC(2026, 10, 8, 9, 0), now), 'yesterday 9:00'); // a last run
    assert.equal(nextLabel(Date.UTC(2026, 10, 5, 9, 0), now), 'Thu 9:00');
    assert.equal(inLabel(now + 5 * 60_000, now), 'in 5 min');
    assert.equal(inLabel(now + 3 * 3_600_000, now), 'in 3 h');
    assert.equal(inLabel(now + 3 * 86_400_000, now), 'in 3 d');
    assert.equal(inLabel(now - 1000, now), 'now');
  });

  it('tells a paused schedule and one that could not start', () => {
    assert.equal(scheduleState({ paused: true, error: 'x' }).key, 'paused');
    assert.equal(scheduleState({ error: 'claude missing' }).tone, 'error');
    assert.equal(scheduleState({}).label, 'On');
  });
});
