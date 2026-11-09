import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { addDays, addMonths, agoLabel, isoWeek, lateBy, longDate, monthGrid, monthLabel, monthOf, nextDow, relDay, shiftMonth, stampLabel, shiftWeek, thisMonth, thisWeek, today, weekDays, weekMonth } from '../../static/js/dates.js';
import { TODAY, freezeDate, unfreezeDate } from './helpers.mjs';

describe('dates', () => {
  beforeEach(freezeDate);
  afterEach(unfreezeDate);

  it('reads a recorded moment: the day and its time, the year only when it is not this one', () => {
    assert.equal(stampLabel('2026-10-20T09:54'), 'Oct 20, 09:54');
    assert.equal(stampLabel('2026-10-20T09:54:12Z'), 'Oct 20, 09:54');
    assert.equal(stampLabel('2025-03-02T18:05'), 'Mar 2 2025, 18:05');
    assert.equal(stampLabel('2026-10-20'), 'Oct 20');
    assert.equal(stampLabel(''), '');
    assert.equal(stampLabel(undefined), '');
  });

  it('says how long ago a moment was, short, then its day', () => {
    assert.equal(agoLabel('2026-10-15T12:00'), 'just now');
    assert.equal(agoLabel('2026-10-15T12:30'), 'just now'); // ahead of this clock
    assert.equal(agoLabel('2026-10-15T11:55'), '5 min ago');
    assert.equal(agoLabel('2026-10-15T09:10'), '2 h ago');
    assert.equal(agoLabel('2026-10-14T13:00'), '23 h ago');
    assert.equal(agoLabel('2026-10-14T08:00'), 'Yesterday');
    assert.equal(agoLabel('2026-10-02T08:00'), 'Oct 2');
    assert.equal(agoLabel('2025-03-02T08:00'), 'Mar 2 2025');
    assert.equal(agoLabel('2026-10-14'), 'Yesterday'); // a day alone
    assert.equal(agoLabel(''), '');
    assert.equal(agoLabel(null), '');
  });

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

  it('gives a week the month of its Thursday', () => {
    assert.equal(thisMonth(), '2026-10');
    assert.equal(monthOf('2026-11-02'), '2026-11');
    assert.equal(weekMonth('2026-W44'), '2026-10'); // Oct 26 – Nov 1
    assert.equal(weekMonth('2026-W45'), '2026-11');
    assert.equal(weekMonth('2026-W53'), '2026-12'); // Dec 28 – Jan 3
    assert.equal(monthLabel('2026-11', true), 'Nov');
    assert.equal(monthLabel('2027-01', true), 'Jan 2027');
    assert.equal(monthLabel('2026-10'), 'October 2026');
  });

  it('names days relative to today', () => {
    assert.equal(relDay(TODAY), 'Today');
    assert.equal(relDay('2026-10-16'), 'Tomorrow');
    assert.equal(relDay('2026-10-14'), 'Yesterday');
    assert.equal(relDay('2026-10-20'), 'Oct 20');
    assert.equal(relDay('2025-12-24'), 'Dec 24 2025');
    assert.equal(relDay(''), '');
  });

  it('steps months, and a day by months', () => {
    assert.equal(shiftMonth('2026-11', 1), '2026-12');
    assert.equal(shiftMonth('2026-12', 1), '2027-01');
    assert.equal(shiftMonth('2026-01', -1), '2025-12');
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28'); // the 31st becomes the month's last day
    assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
    assert.equal(addMonths('2026-03-15', -3), '2025-12-15');
  });

  it('lays a month out in six weeks, Monday first', () => {
    const nov = monthGrid('2026-11'); // Nov 1 2026 is a Sunday
    assert.equal(nov.length, 42);
    assert.equal(nov[0], '2026-10-26');
    assert.equal(nov[6], '2026-11-01');
    assert.equal(nov[41], '2026-12-06');
    assert.equal(monthGrid('2027-02')[0], '2027-02-01'); // starts on a Monday: no days of January
  });

  it('writes a day in full', () => {
    assert.equal(longDate('2026-11-07'), 'Nov 7, 2026');
    assert.equal(longDate(''), '');
  });

  it('finds the next weekday, today included', () => {
    assert.equal(nextDow('thu'), TODAY);
    assert.equal(nextDow('fri'), '2026-10-16');
    assert.equal(nextDow('wed'), '2026-10-21');
    assert.equal(nextDow('nope'), null);
  });
  it('says how late a past plan is, by its day, else its week, else its month', () => {
    assert.deepEqual(lateBy({ plan_day: '2026-10-14' }), { since: 'Oct 14', text: 'Yesterday' });
    assert.deepEqual(lateBy({ plan_day: '2026-09-27', plan_week: '2026-W39' }), { since: 'Sep 27', text: '18 d late' });
    assert.deepEqual(lateBy({ plan_week: '2026-W40' }), { since: 'W40', text: '2 wk late' });
    assert.deepEqual(lateBy({ plan_month: '2026-08' }), { since: 'Aug', text: '2 mo late' });
    assert.equal(lateBy({ plan_day: '2026-10-15' }), null);
    assert.equal(lateBy({ plan_week: '2026-W42' }), null);
    assert.equal(lateBy({}), null);
  });
});
