import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { daySummary, minutesLabel } from '../../static/js/dayline.js';

describe('daySummary', () => {
  it('says how much is done, what was logged and the next meeting', () => {
    assert.deepEqual(daySummary({
      planned: [{ done: true }, { done: false }, { done: true }], minutes: 90,
      meetings: [{ time: '09:00', title: 'Standup' }, { time: '16:30', title: 'Review' }, { time: '11:00', title: 'Pricing kick-off' }],
      now: '10:15',
    }), ['2 of 3 done', '1h 30m logged', 'next: Pricing kick-off at 11:00']);
  });

  it('leaves out what has nothing to say', () => {
    assert.deepEqual(daySummary({ planned: [], minutes: 0, meetings: [{ time: '', title: 'All day' }, { time: '08:00', title: 'Done' }], now: '12:00' }), []);
  });

  it('writes minutes as hours and minutes', () => {
    assert.equal(minutesLabel(45), '45m');
    assert.equal(minutesLabel(120), '2h');
    assert.equal(minutesLabel(135), '2h 15m');
    assert.equal(minutesLabel(0), '0m');
  });
});
