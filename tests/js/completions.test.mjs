import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SLASH, docMatches, docStem, itemMatches, menuAt, slashMatches, slashText } from '../../static/js/completions.js';

describe('which menu the cursor is in (menuAt)', () => {
  it('/ only first on its line, after its indent', () => {
    assert.deepEqual(menuAt('/'), { kind: '/', query: '', start: 0 });
    assert.deepEqual(menuAt('  /tab'), { kind: '/', query: 'tab', start: 2 });
    assert.equal(menuAt('see /etc'), null);
    assert.equal(menuAt('a/b'), null);
    assert.equal(menuAt('/two words'), null);
  });

  it('[[ anywhere on the line, until it is closed', () => {
    assert.deepEqual(menuAt('see [[Road'), { kind: '[[', query: 'Road', start: 4 });
    assert.deepEqual(menuAt('[['), { kind: '[[', query: '', start: 0 });
    assert.equal(menuAt('[[Road]] and'), null);
  });

  it('@ at the start or after a space or a bracket, not in an address', () => {
    assert.deepEqual(menuAt('ask @an'), { kind: '@', query: 'an', start: 4 });
    assert.deepEqual(menuAt('(@'), { kind: '@', query: '', start: 1 });
    assert.equal(menuAt('mail a@b.c'), null);
  });
});

describe('the / menu', () => {
  it('matches by the start of the name, then by a word of it', () => {
    assert.deepEqual(slashMatches('').map((c) => c.key), SLASH.map((c) => c.key));
    assert.deepEqual(slashMatches('head').map((c) => c.key), ['h1', 'h2', 'h3']);
    assert.deepEqual(slashMatches('list').map((c) => c.key), ['ul', 'ol']); // "Bullet list", "Numbered list"
    assert.deepEqual(slashMatches('ta').map((c) => c.key), ['table']);
    assert.deepEqual(slashMatches('zzz'), []);
  });

  it('inserts its text with the cursor where you type next', () => {
    const by = (k) => SLASH.find((c) => c.key === k);
    assert.deepEqual(slashText(by('task')), { text: '- [ ] ', from: 6, to: 6 });
    assert.deepEqual(slashText(by('code')), { text: '```\n\n```', from: 4, to: 4 });
    const t = slashText(by('table'));
    assert.equal(t.text.slice(t.from, t.to), 'Column'); // the first header, selected
    assert.deepEqual(slashText(by('date'), new Date(2026, 10, 3)), { text: '2026-11-03', from: 10, to: 10 });
  });
});

describe('the [[ menu', () => {
  const paths = ['Docs/Team/How we ship.md', 'Docs/Roadmap.md', 'Notes/Road trip.md', 'Work log/2026/2026-11-05.md', 'Archive/Old roadmap notes.md'];

  it('names a doc as Obsidian does', () => {
    assert.equal(docStem('Docs/Team/How we ship.md'), 'How we ship');
    assert.equal(docStem('Top.MD'), 'Top');
  });

  it('docs whose name starts with the query first, then a word of the name, then the path', () => {
    assert.deepEqual(docMatches(paths, 'road'), ['Docs/Roadmap.md', 'Notes/Road trip.md', 'Archive/Old roadmap notes.md']);
    assert.deepEqual(docMatches(paths, 'ship'), ['Docs/Team/How we ship.md']);
    assert.deepEqual(docMatches(paths, 'team'), ['Docs/Team/How we ship.md']);
    assert.deepEqual(docMatches(paths, 'RÓAD').length, 3); // case and accents do not matter
  });

  it('no query: the first ones by name', () => {
    assert.deepEqual(docMatches(paths, '', 2), ['Work log/2026/2026-11-05.md', 'Docs/Team/How we ship.md']);
  });

  it('items by id or title, none for no query', () => {
    const items = [{ id: '31', ref: 'STY-31', title: 'Check out as a guest', type: 'story' }, { id: '5', ref: 'STY-5', title: 'One page', type: 'story' }];
    assert.deepEqual(itemMatches(items, 'guest').map((i) => i.ref), ['STY-31']);
    assert.deepEqual(itemMatches(items, ''), []);
  });
});
