import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanTime, fromMinutes, sumTime, toMinutes } from '../../static/js/worktime.js';

describe('worktime', () => {
  it('reads and writes HH:MM', () => {
    assert.equal(toMinutes('01:30'), 90);
    assert.equal(toMinutes('26:05'), 26 * 60 + 5);
    assert.equal(toMinutes('nonsense'), 0);
    assert.equal(fromMinutes(90), '01:30');
    assert.equal(fromMinutes(26 * 60 + 5), '26:05');
  });

  it('forgives what a person types', () => {
    assert.equal(cleanTime(''), '00:00');
    assert.equal(cleanTime('1:30'), '01:30');
    assert.equal(cleanTime('130'), '01:30');
    assert.equal(cleanTime('0045'), '00:45');
    assert.equal(cleanTime('2'), '02:00');
  });

  it('refuses what is not a time', () => {
    assert.equal(cleanTime('1:75'), null);
    assert.equal(cleanTime('abc'), null);
    assert.equal(cleanTime('12:5'), null);
  });

  it('adds up entries, passing 24 hours', () => {
    assert.equal(sumTime([]), '00:00');
    assert.equal(sumTime([{ time: '01:30' }, { time: '00:45' }]), '02:15');
    assert.equal(sumTime([{ time: '20:00' }, { time: '10:30' }]), '30:30');
    assert.equal(sumTime([{ time: '01:00' }, {}]), '01:00'); // an entry without a time counts nothing
    assert.equal(sumTime([{ time: '01:00' }, { time: '02:00', status: 'tentative' }]), '01:00'); // proposed: not counted yet
  });
});
