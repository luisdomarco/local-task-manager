import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyOrder, mergeOrder, moveKey, reorderColumns } from '../../static/js/colorder.js';

const DEFAULT = ['Backlog', 'ToDo', 'In progress', 'On hold', 'Done'];

describe('applyOrder', () => {
  it('no saved order: the default one, as a copy', () => {
    const out = applyOrder(DEFAULT, undefined);
    assert.deepEqual(out, DEFAULT);
    assert.notEqual(out, DEFAULT);
    assert.deepEqual(applyOrder(DEFAULT, []), DEFAULT);
    assert.deepEqual(applyOrder(DEFAULT, 'garbage'), DEFAULT);
  });

  it('the saved order wins over the default one', () => {
    assert.deepEqual(applyOrder(DEFAULT, ['Done', 'In progress', 'Backlog', 'ToDo', 'On hold']),
      ['Done', 'In progress', 'Backlog', 'ToDo', 'On hold']);
  });

  it('a column the saved order does not know goes after the saved ones, in its default order', () => {
    assert.deepEqual(applyOrder(['A', 'New', 'B', 'C', 'Later'], ['C', 'A', 'B']), ['C', 'A', 'B', 'New', 'Later']);
  });

  it('a saved key with no column now is skipped, and a repeated one counts once', () => {
    assert.deepEqual(applyOrder(['a', 'b'], ['gone', 'b', 'b', 'a']), ['b', 'a']);
  });

  it('the no-value group (an empty key) is a key like any other', () => {
    assert.deepEqual(applyOrder(['acme', 'web', ''], ['', 'web']), ['', 'web', 'acme']);
  });
});

describe('moveKey', () => {
  it('moves a key to where it ends up, either way', () => {
    assert.deepEqual(moveKey(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
    assert.deepEqual(moveKey(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c']);
    assert.deepEqual(moveKey(['a', 'b', 'c', 'd'], 1, 1), ['a', 'b', 'c', 'd']);
  });

  it('an index out of range (or not a number) changes nothing', () => {
    const keys = ['a', 'b'];
    assert.deepEqual(moveKey(keys, -1, 0), keys);
    assert.deepEqual(moveKey(keys, 0, 2), keys);
    assert.deepEqual(moveKey(keys, NaN, 0), keys);
    assert.deepEqual(keys, ['a', 'b']); // never in place
  });
});

describe('mergeOrder', () => {
  it('without an old order: what is shown', () => {
    assert.deepEqual(mergeOrder(undefined, ['b', 'a']), ['b', 'a']);
  });

  it('a column not on the board now keeps its place after the one it followed', () => {
    // "On hold" hidden (Empty columns: Hide): it stays between In progress and Done.
    assert.deepEqual(mergeOrder(['Done', 'In progress', 'On hold', 'ToDo'], ['ToDo', 'Done', 'In progress']),
      ['ToDo', 'Done', 'In progress', 'On hold']);
    // First in the old order: first again.
    assert.deepEqual(mergeOrder(['x', 'a', 'b'], ['b', 'a']), ['x', 'b', 'a']);
    // Two absent in a row stay together.
    assert.deepEqual(mergeOrder(['a', 'x', 'y', 'b'], ['b', 'a']), ['b', 'a', 'x', 'y']);
  });
});

describe('reorderColumns', () => {
  it('a drag saves the whole order shown, the hidden columns kept', () => {
    const saved = ['Done', 'Backlog', 'On hold', 'ToDo'];
    const shown = applyOrder(['Backlog', 'ToDo', 'Done'], saved); // On hold hidden
    assert.deepEqual(shown, ['Done', 'Backlog', 'ToDo']);
    const next = reorderColumns(saved, shown, 2, 0); // ToDo to the front
    assert.deepEqual(next, ['ToDo', 'Done', 'Backlog', 'On hold']);
    assert.deepEqual(applyOrder(DEFAULT, next), ['ToDo', 'Done', 'Backlog', 'On hold', 'In progress']);
  });

  it('a first drag on a board with no order saves the default one moved', () => {
    assert.deepEqual(reorderColumns(undefined, DEFAULT, 4, 1), ['Backlog', 'Done', 'ToDo', 'In progress', 'On hold']);
  });
});
