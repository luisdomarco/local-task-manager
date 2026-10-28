import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { IMAGE_TYPES, dropToken, imageFit, insertPick, matchCommands, matchFiles, matchItems, tokenAt } from '../../static/js/composer.js';

describe('the picker the caret is in (tokenAt)', () => {
  it('/ only at the start of the message', () => {
    assert.deepEqual(tokenAt('/com'), { kind: '/', query: 'com', start: 0 });
    assert.deepEqual(tokenAt('/'), { kind: '/', query: '', start: 0 });
    assert.equal(tokenAt('/compact now'), null);
    assert.equal(tokenAt('see /etc'), null);
  });

  it('@ after a space or at the start, up to the caret', () => {
    assert.deepEqual(tokenAt('look at @static/js'), { kind: '@', query: 'static/js', start: 8 });
    assert.deepEqual(tokenAt('@'), { kind: '@', query: '', start: 0 });
    assert.deepEqual(tokenAt('(@REA'), { kind: '@', query: 'REA', start: 1 });
    assert.deepEqual(tokenAt('fix @a.js and more', 9), { kind: '@', query: 'a.js', start: 4 });
    assert.equal(tokenAt('mail me@x.io'), null);
    assert.deepEqual(tokenAt('see #tsk-1'), { kind: '#', query: 'tsk-1', start: 4 });
    assert.equal(tokenAt('issue#4'), null);
    assert.equal(tokenAt('@a.js done'), null);
  });
});

describe('what each picker offers', () => {
  it('commands: those starting with the query first', () => {
    assert.deepEqual(matchCommands(['review', 'compact', 'dev:pr', 'pr-comments', 'compact'], 'pr'), ['pr-comments', 'dev:pr']);
    assert.deepEqual(matchCommands(['b', 'a', '__remote-workflow'], ''), ['a', 'b']);
  });

  it('files: every word, the name before the path, short before long', () => {
    const paths = ['README.md', 'static/', 'static/js/', 'static/js/chat.js', 'static/js/chat-model.js', 'tests/js/chat-model.test.mjs',
      'tm/chat.py', 'docs/chatting/notes.md'];
    assert.deepEqual(matchFiles(paths, 'chat'),
      ['tm/chat.py', 'static/js/chat.js', 'static/js/chat-model.js', 'tests/js/chat-model.test.mjs', 'docs/chatting/notes.md']);
    assert.deepEqual(matchFiles(paths, 'js chat'), ['static/js/chat.js', 'static/js/chat-model.js', 'tests/js/chat-model.test.mjs']);
    assert.deepEqual(matchFiles(paths, ''), ['README.md', 'static/']);
  });

  it('files: a folder just picked shows what is in it', () => {
    const paths = ['static/', 'static/js/', 'static/js/chat.js', 'static/js/views/', 'static/js/views/week.js', 'static/app.css'];
    assert.deepEqual(matchFiles(paths, 'static/'), ['static/js/', 'static/app.css']);
    assert.deepEqual(matchFiles(paths, 'Static/JS/'), ['static/js/chat.js', 'static/js/views/']);
    assert.deepEqual(matchFiles(paths, 'static/js/chat.js/'), ['static/js/chat.js']); // no such folder: matched as words
    assert.deepEqual(matchFiles(paths, 'nothing'), []);
  });
});

describe('putting the pick in the message (insertPick)', () => {
  it('a command, a file, a folder', () => {
    assert.deepEqual(insertPick('/com', { kind: '/', start: 0 }, 4, 'compact'), { text: '/compact ', caret: 9 });
    assert.deepEqual(insertPick('read @st please', { kind: '@', start: 5 }, 8, 'static/js/chat.js'),
      { text: 'read @static/js/chat.js please', caret: 24 });
    assert.deepEqual(insertPick('@st', { kind: '@', start: 0 }, 3, 'static/'), { text: '@static/', caret: 8 });
  });
});

describe('the vault items a # offers (matchItems) and the token it leaves (dropToken)', () => {
  const items = [
    { id: 'TSK-0010', title: 'Benchmark competitor pricing' }, { id: 'TSK-0001', title: 'Review analytics' },
    { id: 'INI-0002', title: 'Pricing revamp', done: true }, { id: '', title: 'Pricing notes' },
  ];
  it('the id first, then the title; closed ones last; none for no query', () => {
    assert.deepEqual(matchItems(items, 'tsk-001').map((i) => i.id), ['TSK-0010']);
    assert.deepEqual(matchItems(items, 'pricing', { isClosed: (i) => i.done }).map((i) => i.title),
      ['Pricing notes', 'Benchmark competitor pricing', 'Pricing revamp']);
    assert.deepEqual(matchItems(items, ''), []);
  });

  it('takes the # out of the text', () => {
    assert.deepEqual(dropToken('look at #ben', { kind: '#', start: 8 }, 12), { text: 'look at', caret: 7 });
    assert.deepEqual(dropToken('look #ben and that', { kind: '#', start: 5 }, 9), { text: 'look and that', caret: 4 });
    assert.deepEqual(dropToken('#ben', { kind: '#', start: 0 }, 4), { text: '', caret: 0 });
  });

  it('scales an image to fit its longer side, never up', () => {
    assert.deepEqual(imageFit(4000, 3000, 2000), [2000, 1500]);
    assert.deepEqual(imageFit(1000, 3000, 160), [53, 160]);
    assert.deepEqual(imageFit(800, 600, 2000), [800, 600]);
    assert.deepEqual(imageFit(5000, 1, 160), [160, 1]); // never 0
    assert.ok(IMAGE_TYPES.includes('image/webp') && !IMAGE_TYPES.includes('image/svg+xml'));
  });
});
