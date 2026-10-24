import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { kindChange, kindLabel, kindOf, kinded } from '../../static/js/relkinds.js';
import { FOLDER_PER_TYPE } from '../../static/js/structure.js';

const RK = FOLDER_PER_TYPE.relation_kinds;
const item = (id, type, relations = [], kinds = {}) => ({ id, type, key: id, fields: { relations, relation_kinds: kinds } });

describe('relation kinds (Redmine): kept on one item, seen inverse from the other', () => {
  it('the structure carries Redmine kinds in its order, and which types have them', () => {
    assert.deepEqual(RK.kinds.map(([, l]) => l), ['Related to', 'Is duplicate of', 'Has duplicate', 'Blocks', 'Blocked by',
      'Precedes', 'Follows', 'Copied to', 'Copied from']);
    assert.ok(kinded(RK, 'task', 'story'));
    assert.ok(!kinded(RK, 'task', 'note'));
    assert.ok(!kinded(undefined, 'task', 'story'));
    assert.equal(kindLabel(RK, 'blocked'), 'Blocked by');
  });

  it('a kind is the keeper\'s, and its inverse from the other side; none is "relates"', () => {
    const t = item('TSK-0001', 'task', ['US-0001', 'NOTE-0001'], { 'US-0001': 'precedes' });
    const s = item('US-0001', 'story');
    assert.equal(kindOf(t, s, RK), 'precedes');
    assert.equal(kindOf(s, t, RK), 'follows');
    assert.equal(kindOf(t, item('NOTE-0001', 'note'), RK), 'relates');
  });

  it('a change is written on whichever keeps the relation, stored as that side sees it', () => {
    const t = item('TSK-0001', 'task', ['US-0001'], { 'US-0001': 'blocks' });
    const s = item('US-0001', 'story');
    const fromStory = kindChange(s, t, 'follows', RK); // the story follows the task: the task, which keeps it, precedes the story
    assert.equal(fromStory.holder, t);
    assert.deepEqual(fromStory.values, { relation_kinds: { 'US-0001': 'precedes' } });
    assert.deepEqual(fromStory.was, { relation_kinds: { 'US-0001': 'blocks' } });
    assert.deepEqual(kindChange(t, s, 'relates', RK).values, { relation_kinds: {} }); // the default is not kept
  });
});
