import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { addDays, isoWeek, nextDow, relDay, shiftWeek, thisWeek, today, weekDays } from '../../static/js/dates.js';
import { TODAY, freezeDate, unfreezeDate } from './helpers.mjs';

describe('dates', () => {
  beforeEach(freezeDate);
  afterEach(unfreezeDate);

  it('knows today', () => {
    assert.equal(today(), TODAY);
    assert.equal(thisWeek(), '2026-W42');
  });

  it('adds days across month and year ends', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29'); // leap year
  });

  it('numbers ISO weeks the way <input type=week> does', () => {
    assert.equal(isoWeek('2026-01-01'), '2026-W01');
    assert.equal(isoWeek('2020-12-31'), '2020-W53');
    assert.equal(isoWeek('2021-01-03'), '2020-W53'); // still last year's week
    assert.equal(isoWeek('2021-01-04'), '2021-W01');
    assert.equal(isoWeek('2026-10-15'), '2026-W42');
  });

  it('lists the seven days of a week, Monday first', () => {
    const days = weekDays('2026-W42');
    assert.equal(days.length, 7);
    assert.equal(days[0], '2026-10-12');
    assert.equal(days[6], '2026-10-18');
    assert.ok(days.every((d) => isoWeek(d) === '2026-W42'));
  });

  it('shifts weeks in both directions and over the year end', () => {
    assert.equal(shiftWeek('2026-W42', 1), '2026-W43');
    assert.equal(shiftWeek('2026-W42', -1), '2026-W41');
    assert.equal(shiftWeek('2020-W53', 1), '2021-W01');
  });

  it('names days relative to today', () => {
    assert.equal(relDay(TODAY), 'Today');
    assert.equal(relDay('2026-10-16'), 'Tomorrow');
    assert.equal(relDay('2026-10-14'), 'Yesterday');
    assert.equal(relDay('2026-10-20'), 'Oct 20');
    assert.equal(relDay('2025-12-24'), 'Dec 24 2025');
    assert.equal(relDay(''), '');
  });

  it('finds the next weekday, today included', () => {
    assert.equal(nextDow('thu'), TODAY);
    assert.equal(nextDow('fri'), '2026-10-16');
    assert.equal(nextDow('wed'), '2026-10-21');
    assert.equal(nextDow('nope'), null);
  });
});
