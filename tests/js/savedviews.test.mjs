import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dropView, showing, upsertView } from '../../static/js/savedviews.js';

const v = (id, name, route = '#/tasks', prefs = {}) => ({ id, name, route, prefs });

describe('saved views', () => {
  it('a new name goes last; the same name on the same page replaces it in place, keeping its id', () => {
    const list = [v('a', 'Mine'), v('b', 'Late')];
    assert.deepEqual(upsertView(list, v('c', 'Bugs')).map((x) => x.id), ['a', 'b', 'c']);
    const again = upsertView(list, v('z', 'mine', '#/tasks', { 'list.task': { groupBy: 'status' } }));
    assert.deepEqual(again.map((x) => x.id), ['a', 'b']);
    assert.deepEqual(again[0].prefs, { 'list.task': { groupBy: 'status' } });
  });

  it('the same name on another page is another view', () => {
    assert.equal(upsertView([v('a', 'Mine')], v('b', 'Mine', '#/stories')).length, 2);
  });

  it('drops a view by its id', () => {
    assert.deepEqual(dropView([v('a', 'Mine'), v('b', 'Late')], 'a').map((x) => x.id), ['b']);
  });

  it('is showing while its page holds every preference it saved', () => {
    const saved = v('a', 'Mine', '#/tasks', { 'list.task': { groupBy: 'status', filters: [] } });
    const prefs = { 'list.task': { groupBy: 'status', filters: [] } };
    assert.equal(showing(saved, '#/tasks', (k) => prefs[k]), true);
    assert.equal(showing(saved, '#/stories', (k) => prefs[k]), false, 'another page');
    assert.equal(showing(saved, '#/tasks', () => ({ groupBy: 'priority', filters: [] })), false, 'changed since');
  });
});
