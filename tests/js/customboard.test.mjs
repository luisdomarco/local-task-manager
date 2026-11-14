import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNCATEGORIZED, byColumn, columnOf, emptyBoard, orderOf, placeCard, withoutColumn } from '../../static/js/customboard.js';

const it = (id, extra = {}) => ({ id, key: `K-${id}`, title: `Item ${id}`, fields: {}, ...extra });
const board = (cards = {}) => ({
  columns: [{ id: UNCATEGORIZED, name: 'Uncategorized' }, { id: 'waiting', name: 'Waiting' }, { id: 'deep', name: 'Deep work' }],
  cards,
});

test('a card sits in its column while the board has it, else in Uncategorized', () => {
  const b = board({ 1: ['waiting', 10], 2: ['gone', 5], 3: ['deep', null] });
  assert.equal(columnOf(b, it(1)), 'waiting');
  assert.equal(columnOf(b, it(2)), UNCATEGORIZED);
  assert.equal(columnOf(b, it(4)), UNCATEGORIZED);
  assert.equal(columnOf(emptyBoard(), it(1)), UNCATEGORIZED);
  assert.deepEqual([orderOf(b, it(1)), orderOf(b, it(3)), orderOf(b, it(4))], [10, null, null]);
});

test('byColumn: every column, placed cards first in their place, then the page order', () => {
  const b = board({ 1: ['waiting', 20], 2: ['waiting', 10], 3: ['waiting', null], 4: ['deep', null] });
  const items = [it(5), it(4), it(3), it(2), it(1)];
  const byId = (a, c) => a.id - c.id;
  const cols = byColumn(b, items, byId);
  assert.deepEqual([...cols.keys()], [UNCATEGORIZED, 'waiting', 'deep']);
  assert.deepEqual(cols.get('waiting').map((i) => i.id), [2, 1, 3]);
  assert.deepEqual(cols.get(UNCATEGORIZED).map((i) => i.id), [5]);
  assert.deepEqual(byColumn(b, items, byId, { manual: false }).get('waiting').map((i) => i.id), [1, 2, 3]);
});

test('placeCard: between two placed cards only the moved one is written', () => {
  const b = board({ 1: ['waiting', 10], 2: ['waiting', 20], 9: [UNCATEGORIZED, null] });
  const col = [it(1), it(2)];
  assert.deepEqual(placeCard(b, it(9), 'waiting', col, 1), { 9: ['waiting', 15] });
  assert.deepEqual(placeCard(b, it(9), 'waiting', col, 2), { 9: ['waiting', 30] });
  assert.deepEqual(placeCard(b, it(9), 'waiting', [], 0), { 9: ['waiting', 0] });
});

test('placeCard: next to a card never placed, the column is numbered as shown', () => {
  const b = board({ 1: ['waiting', null], 2: ['waiting', 20] });
  assert.deepEqual(placeCard(b, it(7), 'waiting', [it(1), it(2)], 1), { 1: ['waiting', 0], 7: ['waiting', 10] });
});

test('placeCard: a card moved inside its column, and the order of the page kept when not manual', () => {
  const b = board({ 1: ['waiting', 10], 2: ['waiting', 20], 3: ['waiting', 30] });
  const col = [it(1), it(2), it(3)];
  assert.deepEqual(placeCard(b, it(3), 'waiting', col, 0), { 3: ['waiting', 0] });
  assert.deepEqual(placeCard(b, it(1), 'deep', [], 0, { manual: false }), { 1: ['deep', 10] });
  assert.deepEqual(placeCard(b, it(1), 'waiting', col, 2, { manual: false }), {});
});

test('a column taken out, never Uncategorized', () => {
  const cols = board().columns;
  assert.deepEqual(withoutColumn(cols, 'waiting').map((c) => c.id), [UNCATEGORIZED, 'deep']);
  assert.equal(withoutColumn(cols, UNCATEGORIZED), cols);
});
