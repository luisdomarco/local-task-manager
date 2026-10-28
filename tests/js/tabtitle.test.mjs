import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { APP_NAME, itemName, tabTitle } from '../../static/js/tabtitle.js';

describe('tab title', () => {
  it('names the open card, else the page, else the app', () => {
    assert.equal(tabTitle('Tasks', ''), 'Tasks');
    assert.equal(tabTitle('Tasks', 'Draft pricing tiers'), 'Draft pricing tiers');
    assert.equal(tabTitle('', null), APP_NAME);
    assert.equal(tabTitle('  ', ''), APP_NAME);
    assert.equal(tabTitle('  Pricing\n revamp ', ''), 'Pricing revamp'); // one line, single spaces
    assert.equal(tabTitle('Tasks', '', 'Fix login needs you'), '● Fix login needs you — Tasks'); // an alert from the dock, in front
    assert.equal(tabTitle('', '', ' \n'), APP_NAME);
  });

  it('calls an item by its title, else its id, else its type', () => {
    assert.equal(itemName({ title: 'Draft pricing tiers', id: 'TSK-0002', type: 'task' }), 'Draft pricing tiers');
    assert.equal(itemName({ title: '', id: 'TSK-0002', type: 'task' }), 'TSK-0002');
    assert.equal(itemName({ title: '', id: '', type: 'inbox' }), 'inbox');
    assert.equal(itemName(null), '');
  });
});
