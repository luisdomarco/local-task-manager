// INB-052: a project can be a favourite too, listed under the sidebar's Favourites with the initiatives.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { favourites, isFavourite, projectProgress } from '../../static/js/favourites.js';

const it = (type, id, title, fields = {}) => ({ type, id, title, fields });

test('a project is a favourite only once starred; an initiative from before without the key still is', () => {
  assert.equal(isFavourite(it('project', 'ACME', 'Acme', {})), false, 'every project from before would turn into one');
  assert.equal(isFavourite(it('project', 'ACME', 'Acme', { sidebar: false })), false);
  assert.equal(isFavourite(it('project', 'ACME', 'Acme', { sidebar: true })), true);
  assert.equal(isFavourite(it('initiative', '1', 'Checkout', {})), true);
  assert.equal(isFavourite(it('initiative', '1', 'Checkout', { sidebar: false })), false);
  assert.equal(isFavourite(it('task', '2', 'A task', { sidebar: true })), false, 'only the types with the star');
  assert.equal(isFavourite(it('project', null, 'No id', { sidebar: true })), false);
});

test('in the order dragged, then projects before initiatives, by rank, then title', () => {
  const items = [
    it('initiative', '1', 'Checkout'), it('initiative', '2', 'Loyalty'), it('initiative', '3', 'Off', { sidebar: false }),
    it('project', 'OPS', 'Operations', { sidebar: true }), it('project', 'ACME', 'Acme', { sidebar: true }), it('project', 'X', 'Not starred'),
    it('task', '9', 'A task'),
  ];
  const rank = (i) => (i.id === '2' ? 0 : 1);
  assert.deepEqual(favourites(items, [], rank).map((i) => i.id), ['ACME', 'OPS', '2', '1']);
  assert.deepEqual(favourites(items, ['1', 'OPS'], rank).map((i) => i.id), ['1', 'OPS', 'ACME', '2']);
});

test('a project\'s ring counts its tasks', () => {
  const items = [it('task', '1', 'a', { project: 'ACME', status: 'Done' }), it('task', '2', 'b', { project: 'ACME' }),
    it('task', '3', 'c', { project: 'OPS' }), it('story', '4', 'd', { project: 'ACME' })];
  const done = (i) => i.fields.status === 'Done';
  assert.deepEqual(projectProgress(items, 'ACME', done), { done: 1, total: 2, pct: 50 });
  assert.deepEqual(projectProgress(items, 'NONE', done), { done: 0, total: 0, pct: 0 });
});
