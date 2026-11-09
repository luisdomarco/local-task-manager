import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ADD_MENU, addMenuGroups } from '../../static/js/rules.js';

// The sidebar's Add item (create.js addMenu): the Inbox capture, then these groups, each after a line.
describe('add item menu', () => {
  it('offers the chosen types in their groups and order, nothing else', () => {
    const all = ['support', 'initiative', 'story', 'task', 'spec', 'note', 'meeting', 'transcription', 'activity', 'prompt', 'project'];
    assert.deepEqual(addMenuGroups(all), [['activity'], ['note', 'task', 'meeting'], ['project', 'initiative', 'story']]);
    assert.deepEqual(addMenuGroups(all), ADD_MENU);
  });

  it('leaves out a type the vault does not create, and a group left empty (the first stays: the Inbox is in it)', () => {
    assert.deepEqual(addMenuGroups(['task', 'note', 'initiative', 'story']), [[], ['note', 'task'], ['initiative', 'story']]);
    assert.deepEqual(addMenuGroups(['activity', 'task']), [['activity'], ['task']]);
  });
});
