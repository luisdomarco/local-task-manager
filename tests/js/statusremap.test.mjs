import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultTarget, remapTargets } from '../../static/js/statusremap.js';

const row = (name, group, extra = {}) => ({ name, group, from: name, count: 0, removed: false, to: null, ...extra });

describe('statusremap', () => {
  it('offers the statuses the type keeps, in group order, never the one going', () => {
    const blocked = row('Blocked', 'in_progress', { count: 3 });
    const rows = [row('Done', 'closed'), row('Backlog', 'not_started'), blocked, row('InProgress', 'in_progress')];
    assert.deepEqual(remapTargets(rows, blocked).map((t) => t.name), ['Backlog', 'InProgress', 'Done']);
  });

  it('leaves out other removed statuses and unnamed new rows', () => {
    const review = row('Review', 'in_progress', { count: 1 });
    const rows = [row('ToDo', 'not_started'), row('OnHold', 'in_progress', { removed: true }), row('', 'in_progress', { from: null }), review];
    assert.deepEqual(remapTargets(rows, review), [{ name: 'ToDo', group: 'not_started' }]);
  });

  it('names a status renamed in the draft as typed', () => {
    const blocked = row('Blocked', 'in_progress', { count: 2 });
    const rows = [row(' Waiting ', 'in_progress', { from: 'OnHold' }), blocked];
    assert.deepEqual(remapTargets(rows, blocked), [{ name: 'Waiting', group: 'in_progress' }]);
  });

  it('preselects the neighbour above in its group, else the one below', () => {
    const onHold = row('OnHold', 'in_progress');
    const blocked = row('Blocked', 'in_progress', { count: 1 });
    const rows = [row('ToDo', 'not_started'), onHold, blocked, row('InProgress', 'in_progress'), row('Done', 'closed')];
    assert.equal(defaultTarget(remapTargets(rows, blocked), blocked, rows), 'OnHold');
    assert.equal(defaultTarget(remapTargets(rows, onHold), onHold, rows), 'Blocked');
  });

  it('skips removed neighbours and offers none across groups', () => {
    const done = row('Done', 'closed', { count: 4 });
    const rows = [row('ToDo', 'not_started'), row('Discarded', 'closed', { removed: true }), done];
    assert.equal(defaultTarget(remapTargets(rows, done), done, rows), null);
  });
});
