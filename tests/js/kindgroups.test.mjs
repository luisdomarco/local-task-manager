import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shownKinds } from '../../static/js/kindgroups.js';

const kind = (type, { all = [], archived = 0, qa = `Add ${type}…` } = {}) => ({ key: type, group: { type, all, archived, qa } });
const keys = (ts) => ts.map((t) => t.key);

// In a tab of an item's page, a kind that holds something is a group; an empty one waits on the "+ Add" line.
describe('shownKinds', () => {
  it('shows the kinds that hold items, in their order, and leaves the empty ones to add', () => {
    const { shown, empty } = shownKinds([kind('story', { all: [{}] }), kind('support'), kind('hotfix', { all: [{}, {}] })]);
    assert.deepEqual(keys(shown), ['story', 'hotfix']);
    assert.deepEqual(keys(empty), ['support']);
  });

  it('counts closed and archived items as something held', () => {
    const { shown } = shownKinds([kind('error', { all: [{ fields: { status: 'Done' } }] }), kind('learning', { archived: 2 })]);
    assert.deepEqual(keys(shown), ['error', 'learning']);
  });

  it('shows an empty kind while its quick add is open, so its first item is written in its group', () => {
    const { shown, empty } = shownKinds([kind('story'), kind('support')], (type) => type === 'support');
    assert.deepEqual(keys(shown), ['support']);
    assert.deepEqual(keys(empty), ['story']);
  });

  it('leaves out an empty kind that cannot be added here (no quick add), and anything that is not a kind table', () => {
    const { shown, empty } = shownKinds([kind('plan', { qa: null }), null, { key: 'x' }, kind('analysis')]);
    assert.deepEqual(keys(shown), []);
    assert.deepEqual(keys(empty), ['analysis']);
  });

  it('takes nothing as no kinds', () => {
    assert.deepEqual(shownKinds(undefined), { shown: [], empty: [] });
  });
});
