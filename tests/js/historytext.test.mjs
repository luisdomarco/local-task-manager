import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { historyText } from '../../static/js/historytext.js';
import { freezeDate, unfreezeDate } from './helpers.mjs';

const EXT = { id_key: 'ticket_id', url_key: 'ticket_url', tracker_key: 'tracker', label: 'Ticket' };

describe('historyText', () => {
  beforeEach(freezeDate);
  afterEach(unfreezeDate);

  it('says a change from what to what, a day as the app writes it', () => {
    assert.equal(historyText({ field: 'due', from: '2026-10-20', to: '2026-10-25', by: 'owner' }, EXT), 'Due: Oct 20 → Oct 25');
    assert.equal(historyText({ field: 'status', from: 'ToDo', to: 'InProgress', by: 'owner' }, EXT), 'Status: To do → In progress');
    assert.equal(historyText({ field: 'planned', from: '2026-W43', to: '2026-10-21', by: 'owner' }, EXT), 'Planned: 2026-W43 → Oct 21');
  });

  it('says a value set and a value cleared', () => {
    assert.equal(historyText({ field: 'ticket_id', from: null, to: '4521', by: 'owner' }, EXT), 'Ticket ID set to 4521');
    assert.equal(historyText({ field: 'local_path', from: '~/work', to: null, by: 'owner' }, EXT), 'Local path cleared (was ~/work)');
  });

  it('names the outside ticket by the structure, cuts a long URL and says who when it was not you', () => {
    assert.equal(historyText({ field: 'ticket_url', from: null, to: 'https://redmine.example.com/issues/4521?tab=history', by: 'agent' },
      { ...EXT, label: 'Redmine' }), 'Redmine URL set to https://redmine.example.com/issues/4521… · by an agent');
    assert.equal(historyText({ field: 'status', from: 'Review', to: 'Done', by: 'rule' }, EXT), 'Status: Review → Done · by a rule');
    assert.equal(historyText({ field: 'tracker', from: 'Story', to: 'Epic' }, EXT), 'Tracker: Story → Epic');
  });
});
