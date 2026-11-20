// static/js/reminders.js: what the Reminders row and Settings say of an item's reminders, its own or the vault's
// default (followed live). The server's side is tests/test_reminders.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, effective, hasMoment, offsetsText, sortOffsets, summary } from '../../static/js/reminders.js';

const d = { ...DEFAULTS, offsets: ['1h', '10m'], urgent: false };

test('an item with none of its own follows the default; [] is none', () => {
  assert.deepEqual(effective({}, d), { offsets: ['10m', '1h'], urgent: false, inherited: true });
  assert.deepEqual(effective({}, { ...d, on: false }).offsets, []);
  assert.deepEqual(effective({ reminders: [] }, d), { offsets: [], urgent: false, inherited: false });
  assert.deepEqual(effective({ reminders: ['1d', 'at'], reminder_urgent: true }, d), { offsets: ['at', '1d'], urgent: true, inherited: false });
  assert.equal(effective({ reminder_urgent: false }, { ...d, urgent: true }).urgent, false);
});

test('what the row says', () => {
  assert.equal(summary({}, d), 'Default · 10 min, 1 h before');
  assert.equal(summary({ reminders: ['at', '1d'] }, d), 'At the time, 1 day before');
  assert.equal(summary({ reminders: ['at'], reminder_urgent: true }, d), 'At the time · Urgent');
  assert.equal(summary({ reminders: [] }, d), 'None');
  assert.equal(summary({}, { ...d, on: false }), 'Default · none');
  assert.equal(offsetsText([]), 'None');
});

test('offsets in their order, known ones once', () => {
  assert.deepEqual(sortOffsets(['1d', 'at', 'nope', 'at']), ['at', '1d']);
});

test('a moment is a planned day with its time, or a meeting with its time', () => {
  assert.equal(hasMoment({ plan_day: '2026-11-19', plan_time: '13:30' }), true);
  assert.equal(hasMoment({ plan_day: '2026-11-19' }), false);
  assert.equal(hasMoment({ date: '2026-11-19', time: '09:00' }), true);
});
