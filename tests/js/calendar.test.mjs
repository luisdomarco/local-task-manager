import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cellEntries, monthCalendar } from '../../static/js/calendar.js';

const task = (id, fields = {}) => ({ id, key: id, type: 'task', title: id, fields });
const meeting = (id, date, time = '') => ({ id, key: id, type: 'meeting', title: id, fields: { date, time } });
const plannable = (i) => i.type === 'task';
const isDone = (i) => i.fields.status === 'Done';

describe('monthCalendar', () => {
  const items = [
    task('T1', { plan_day: '2026-11-10', plan_week: '2026-W46' }),
    task('T2', { plan_week: '2026-W46' }),
    task('T3', { plan_month: '2026-11' }),
    task('T4', { due: '2026-11-12' }),
    task('T5', { due: '2026-11-12', status: 'Done' }),
    task('T6', { due: '2026-11-10', plan_day: '2026-11-10' }),
    meeting('M2', '2026-11-10', '15:00'),
    meeting('M1', '2026-11-10', '09:30'),
  ];
  const cal = monthCalendar(items, '2026-11', { plannable, isDone, now: '2026-11-09' });

  it('draws six weeks, Monday first, the days outside the month marked', () => {
    assert.equal(cal.weeks.length, 6);
    assert.equal(cal.weeks[0].days[0].day, '2026-10-26');
    assert.equal(cal.weeks[0].days[0].out, true);
    assert.equal(cal.weeks[0].days[6].day, '2026-11-01');
    assert.equal(cal.weeks[0].days[6].out, false);
  });

  it('marks today, the past and the current week', () => {
    const w46 = cal.weeks.find((w) => w.week === '2026-W46');
    assert.equal(w46.current, true);
    assert.equal(w46.days[0].today, true);
    assert.equal(cal.weeks[1].days[0].past, true);
  });

  it('puts a day its meetings by time, what is planned for it, then what is due and open', () => {
    const tue = cal.weeks[2].days[1];
    assert.equal(tue.day, '2026-11-10');
    assert.deepEqual(tue.entries.map((e) => [e.item.id, e.kind]), [['M1', 'meeting'], ['M2', 'meeting'], ['T1', 'plan'], ['T6', 'plan']]);
    const thu = cal.weeks[2].days[3];
    assert.deepEqual(thu.entries.map((e) => [e.item.id, e.kind]), [['T4', 'due']]); // T5 is done
  });

  it('keeps a week what has no day, and the month what has neither', () => {
    assert.deepEqual(cal.weeks[2].items.map((i) => i.id), ['T2']);
    assert.deepEqual(cal.monthOnly.map((i) => i.id), ['T3']);
  });
});

describe('cellEntries', () => {
  const e = (n) => Array.from({ length: n }, (_, i) => i);
  it('shows them all when they fit', () => assert.deepEqual(cellEntries(e(3)), { shown: [0, 1, 2], more: 0 }));
  it('keeps a line for "+N more" when they do not', () => assert.deepEqual(cellEntries(e(5)), { shown: [0, 1], more: 3 }));
  it('shows them all once opened', () => assert.equal(cellEntries(e(5), { opened: true }).shown.length, 5));
});
