import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

// A minimal localStorage, as the browser gives it.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { pref, saveSort, savedSort, setPref, setPrefsVault } = await import('../../static/js/prefs.js');

describe('prefs', () => {
  beforeEach(() => store.clear());

  it('round-trips JSON under its namespace, and forgets on null', () => {
    setPref('list.task', { scope: 'all', status: ['Blocked'] });
    assert.deepEqual(pref('list.task'), { scope: 'all', status: ['Blocked'] });
    assert.ok(store.has('tm.ui.list.task'));
    setPref('list.task', null);
    assert.equal(pref('list.task', 'none'), 'none');
  });

  it('falls back on a broken value or a broken storage', () => {
    store.set('tm.ui.x', '{not json');
    assert.equal(pref('x', 7), 7);
    const saved = globalThis.localStorage.getItem;
    globalThis.localStorage.getItem = () => { throw new Error('denied'); };
    assert.equal(pref('x', 8), 8);
    globalThis.localStorage.getItem = saved;
  });

  it('only gives back a well-formed sort', () => {
    const fallback = { col: 'status', dir: -1 };
    assert.deepEqual(savedSort('t', fallback), fallback);
    saveSort('t', { col: 'priority', dir: 1 });
    assert.deepEqual(savedSort('t', fallback), { col: 'priority', dir: 1 });
    setPref('sort.t', { col: 'priority', dir: 3 });
    assert.deepEqual(savedSort('t', fallback), fallback);
  });
});

describe('prefs per vault', () => {
  beforeEach(() => { store.clear(); setPrefsVault(''); });

  it('keeps a vault\'s own things apart, and shares the rest', () => {
    setPrefsVault('a');
    setPref('list.task', { labels: ['only-in-a'] });
    setPref('minimized', [{ key: 'TSK-0001' }]);
    setPref('sort.tasks', { col: 'status', dir: 1 });
    assert.ok(store.has('tm.v.a.list.task') && store.has('tm.v.a.minimized'));
    setPrefsVault('b');
    assert.equal(pref('list.task'), null); // B never sees A's filter
    assert.equal(pref('minimized'), null); // nor A's minimized cards
    assert.deepEqual(pref('sort.tasks'), { col: 'status', dir: 1 }); // a sort is the same everywhere
    setPrefsVault('a');
    assert.deepEqual(pref('list.task'), { labels: ['only-in-a'] });
  });

  it('copies what was saved before vaults into the first vault used, and only into it', () => {
    store.set('tm.ui.list.task', JSON.stringify({ scope: 'all' }));
    store.set('tm.logDismissed', JSON.stringify(['TSK-0001|2026-10-15']));
    setPrefsVault('folders'); // the first vault this browser uses
    assert.deepEqual(pref('list.task'), { scope: 'all' });
    assert.deepEqual(pref('logDismissed'), ['TSK-0001|2026-10-15']);
    assert.ok(store.has('tm.ui.list.task'), 'copied, never moved');
    setPrefsVault('other');
    assert.equal(pref('list.task'), null);
    assert.equal(pref('logDismissed'), null);
  });
});
