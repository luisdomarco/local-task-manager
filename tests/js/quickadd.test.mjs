import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { parseQuick } from '../../static/js/quickadd.js';
import { state } from '../../static/js/state.js';
import { freezeDate, unfreezeDate } from './helpers.mjs';

describe('quick add parser', () => {
  beforeEach(() => {
    freezeDate();
    state.byId = new Map([
      ['INI-0001', { id: 'INI-0001', type: 'initiative' }],
      ['TSK-0001', { id: 'TSK-0001', type: 'task' }],
      ['MTG-0001', { id: 'MTG-0001', type: 'meeting' }],
    ]);
  });
  afterEach(unfreezeDate);

  it('reads a task with its tokens', () => {
    const p = parseQuick('Fix login !high @today due:fri +auth #INI-0001 session:s1');
    assert.equal(p.type, 'task');
    assert.equal(p.title, 'Fix login');
    assert.equal(p.values.priority, 'High');
    assert.equal(p.values.plan_day, '2026-10-15');
    assert.equal(p.values.plan_week, '2026-W42');
    assert.equal(p.values.due, '2026-10-16');
    assert.deepEqual(p.values.labels, ['auth']);
    assert.equal(p.values.related_to, 'INI-0001');
    assert.equal(p.values.session_name, 's1');
    assert.deepEqual(p.errors, []);
  });

  it('reads numeric priorities and the first link as the main one', () => {
    const p = parseQuick('Read this !1 https://a.io www.b.io');
    assert.equal(p.values.priority, 'Urgent');
    assert.equal(p.values.url, 'https://a.io');
    assert.deepEqual(p.values.links, [{ url: 'https://www.b.io' }]);
  });

  it('types an item with a slash word', () => {
    assert.equal(parseQuick('Call notes /note').type, 'note');
    assert.equal(parseQuick('Kickoff /meeting').type, 'meeting');
    assert.equal(parseQuick('Kickoff text /trn #MTG-0001').type, 'transcription');
    assert.equal(parseQuick('Kickoff text /transcription').type, 'transcription');
  });

  it('drops planning for types that cannot be planned', () => {
    const p = parseQuick('Remember this /note @today !high due:fri', { values: { today_list: 'morning' } });
    assert.equal(p.type, 'note');
    for (const k of ['plan_day', 'plan_week', 'priority', 'due', 'status', 'list', 'today_list']) assert.equal(p.values[k], undefined, k);
  });

  it('checks the relation it was asked for', () => {
    assert.match(parseQuick('x #INI-9999').errors[0], /not found/);
    assert.match(parseQuick('transcript /trn #TSK-0001').errors[0], /can't hang from a task/);
    assert.deepEqual(parseQuick('transcript /trn #MTG-0001').errors, []);
  });

  it('lets the defaults of the place it is typed in apply', () => {
    const p = parseQuick('Add a card', { type: 'task', values: { related_to: 'INI-0001', list: 'todo' } });
    assert.equal(p.values.related_to, 'INI-0001');
    assert.equal(p.values.list, 'todo');
  });
});
