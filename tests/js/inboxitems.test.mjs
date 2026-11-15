// INB-033: the Inbox says when each item last changed, with its time, and lists the last changed first.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { byLastUpdated, byNewestCapture, localStamp, updatedLabel } from '../../static/js/inboxitems.js';
import { freezeDate, unfreezeDate } from './helpers.mjs';

const item = (id, fields = {}, extra = {}) => ({ id, fields, ...extra });
const secs = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime() / 1000; // local time, as the page reads it

describe('the Inbox', () => {
  before(freezeDate); // 2026-10-15 12:00 local
  after(unfreezeDate);

  it('puts the newest capture first: by day, then by the id\'s number the same day', () => {
    const rows = [item('28', { created_at: '2026-10-14' }), item('30', { created_at: '2026-10-15' }),
      item('33', { created_at: '2026-10-15' }), item('9', { created_at: '2026-10-15' }), item('1', {})];
    assert.deepEqual(rows.sort(byNewestCapture).map((r) => r.id), ['33', '30', '9', '28', '1']);
  });

  it('orders a legacy vault by its time, and long ids by their number', () => {
    const rows = [item('ACME-INB-002', { created_at: '2026-10-15T09:00' }), item('ACME-INB-010', { created_at: '2026-10-15T08:00' }),
      item('ACME-INB-011', { created_at: '2026-10-15T08:00' })];
    assert.deepEqual(rows.sort(byNewestCapture).map((r) => r.id), ['ACME-INB-002', 'ACME-INB-011', 'ACME-INB-010']);
  });

  it('lists the last changed first, whenever it was captured', () => {
    const rows = [
      item('30', { created_at: '2026-10-15' }, { mtime: secs(2026, 10, 15, 9, 0) }),
      item('5', { created_at: '2026-10-01' }, { mtime: secs(2026, 10, 15, 11, 30) }), // old, edited today in Obsidian
      item('31', { created_at: '2026-10-15' }, { mtime: secs(2026, 10, 15, 10, 0) }),
      item('7', { created_at: '2026-10-02', updated_at: '2026-10-03' }), // no file time: its day
      item('32', { created_at: '2026-10-15' }, { mtime: secs(2026, 10, 15, 10, 0) }), // the same second: newer capture first
    ];
    assert.deepEqual(rows.sort(byLastUpdated).map((r) => r.id), ['5', '32', '31', '30', '7']);
  });

  it('says when it last changed, with its time, from its file', () => {
    assert.equal(localStamp(secs(2026, 10, 15, 9, 5)), '2026-10-15T09:05');
    assert.equal(updatedLabel(item('1', { updated_at: '2026-10-15' }, { mtime: secs(2026, 10, 15, 10, 42) })), 'Updated Today, 10:42');
    assert.equal(updatedLabel(item('1', {}, { mtime: secs(2026, 10, 14, 18, 5) })), 'Updated Yesterday, 18:05');
    assert.equal(updatedLabel(item('1', {}, { mtime: secs(2026, 10, 3, 9, 12) })), 'Updated Oct 3, 09:12');
  });

  it('falls back on updated_at, and says nothing when nothing is known', () => {
    assert.equal(updatedLabel(item('1', { updated_at: '2026-10-02' })), 'Updated Oct 2');
    assert.equal(updatedLabel(item('1', { updated_at: '2026-10-02T08:30' })), 'Updated Oct 2, 08:30');
    assert.equal(updatedLabel(item('1', {})), '');
  });
});
