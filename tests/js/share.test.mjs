// Item 10: what another app shares, as the Inbox's capture text (static/js/share.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { pendingSharedFiles, sharedFile, sharedIn, shareText, takeShare } from '../../static/js/share.js';

test('title, then the address', () => {
  assert.equal(shareText({ title: 'Passkeys guide', url: 'https://example.com/p' }), 'Passkeys guide https://example.com/p');
  assert.equal(shareText({ url: 'https://example.com/p' }), 'https://example.com/p');
  assert.equal(shareText({}), '');
});

test('an address inside the text is used once, at the end', () => {
  assert.equal(shareText({ text: 'Read this https://example.com/a later' }), 'Read this later https://example.com/a');
  assert.equal(shareText({ title: 'A page', text: 'https://example.com/a' }), 'A page https://example.com/a');
  assert.equal(shareText({ title: 'A page', text: 'Worth a look', url: 'https://x.io' }), 'A page — Worth a look https://x.io');
});

test('only an address with share_ keys is a share; lines become one', () => {
  assert.equal(sharedIn('?vault=sample'), null);
  assert.equal(sharedIn('?share_title=Two%0Alines&share_url=https%3A%2F%2Fx.io'), 'Two lines https://x.io');
});

test('a picture shared by the iPhone app: a token, never a path, and a clean name', () => {
  assert.equal(sharedIn('?share_file=AB12-cd'), ''); // a share, with no text of its own
  assert.deepEqual(sharedFile('?share_file=AB12-cd&share_name=IMG_0042.jpg'), { token: 'AB12-cd', name: 'IMG_0042.jpg' });
  assert.deepEqual(sharedFile('?share_file=AB12'), { token: 'AB12', name: 'Shared picture.jpg' });
  assert.equal(sharedFile('?share_file=..%2Fapi%2Fitems'), null);
  assert.equal(sharedFile('?share_title=x'), null);
  assert.equal(sharedFile('?share_file=t&share_name=..%2F..%2Fa%3Cb%3E.png').name, 'ab.png');
  assert.equal(sharedFile('?share_file=t&share_name=..').name, 'Shared picture.jpg');
});

test('the shared picture is fetched from the app once; one that cannot be read is said', async () => {
  const real = globalThis.fetch;
  const asked = [];
  const errors = [];
  try {
    // takeShare reads a browser's address: give it one.
    globalThis.location = { search: '?share_file=T1&share_name=a.png', pathname: '/' };
    globalThis.history = { replaceState: (_s, _t, url) => asked.push(`replace ${url}`) };
    assert.equal(takeShare(), true);
    globalThis.fetch = async (url) => { asked.push(url); return new Response(new Blob(['png'], { type: 'image/png' })); };
    const files = await pendingSharedFiles();
    assert.equal(files.length, 1);
    assert.equal(files[0].name, 'a.png');
    assert.equal(files[0].type, 'image/png');
    assert.deepEqual(await pendingSharedFiles(), []); // once
    assert.deepEqual(asked, ['replace /#/inbox', '/__share/T1']);

    globalThis.location = { search: '?share_file=T2', pathname: '/' };
    takeShare();
    globalThis.fetch = async () => new Response('', { status: 404 }); // anywhere but the iPhone app
    assert.deepEqual(await pendingSharedFiles({ onError: (m) => errors.push(m) }), []);
    assert.equal(errors.length, 1);
  } finally {
    globalThis.fetch = real;
    delete globalThis.location;
    delete globalThis.history;
  }
});

test('TSK-128: what was shared, apart: its words for the Subject, its address for a chip', async () => {
  const { shareParts, sharedPartsIn } = await import('../../static/js/share.js');
  assert.deepEqual(shareParts({ url: 'https://x.com/a/status/1' }), { text: '', url: 'https://x.com/a/status/1' });
  assert.deepEqual(shareParts({ title: 'A page', url: 'https://x.io' }), { text: 'A page', url: 'https://x.io' });
  assert.deepEqual(shareParts({ text: 'Read this https://example.com/a later' }), { text: 'Read this later', url: 'https://example.com/a' });
  assert.equal(sharedPartsIn('?vault=sample'), null);
  assert.deepEqual(sharedPartsIn('?share_url=https%3A%2F%2Fx.com%2Fa'), { text: '', url: 'https://x.com/a' });
});

test('TSK-128: takeShare keeps the share apart for the Inbox', async () => {
  const { pendingShare } = await import('../../static/js/share.js');
  try {
    globalThis.location = { search: '?share_title=Thread&share_url=https%3A%2F%2Fx.com%2Fa', pathname: '/' };
    globalThis.history = { replaceState: () => {} };
    assert.equal(takeShare(), true);
    assert.deepEqual(pendingShare(), { text: 'Thread', url: 'https://x.com/a' });
    assert.equal(pendingShare(), null); // once
  } finally {
    delete globalThis.location;
    delete globalThis.history;
  }
});

// A text too long for a Subject (the server keeps 120 characters of a title) was cut, and what came after was lost: a
// log block shared from Claude, an article's paragraph. Now it comes whole as the description.
test('a long shared text: its first line in the Subject, all of it, lines kept, as the description', async () => {
  const { longText, shareParts, SUBJECT_MAX } = await import('../../static/js/share.js');
  assert.equal(longText('short'), null);
  assert.equal(longText('x'.repeat(SUBJECT_MAX)), null);
  const block = '```eng-log\n{"date":"2026-11-22","skills":["Speaking"],"minutes":30,"notes":"' + 'y'.repeat(150) + '"}\n```';
  const long = longText(block);
  assert.equal(long.subject, 'eng-log', 'markup aside');
  assert.equal(long.body, block, 'whole, its lines kept');
  const words = 'word '.repeat(40).trim();
  assert.equal(longText(words).subject, `${'word '.repeat(16).trim()}…`, 'cut at a word');
  const p = shareParts({ text: `Read this\n${'z '.repeat(80)}`, url: 'https://x.io/a' });
  assert.equal(p.text, 'Read this');
  assert.equal(p.url, 'https://x.io/a');
  assert.ok(p.body.startsWith('Read this\nz z'));
  assert.equal(shareParts({ title: 'A page', text: words }).text, 'A page', 'a title wins the Subject');
  assert.equal(shareParts({ text: 'Two\nlines' }).body, undefined, 'one that fits is one line, as before');
});

test('the capture box keeps a long paste or share as the description, and sends it', () => {
  const js = readFileSync(new URL('../../static/js/quickadd.js', import.meta.url), 'utf8');
  assert.match(js, /const long = longText\(e\.clipboardData\?\.getData\('text\/plain'\) \|\| ''\);/, 'a paste is checked first');
  assert.match(js, /createItem\(p\.type, p\.title, p\.values, desc \|\| null\)/, 'the description goes with the item');
  const inbox = readFileSync(new URL('../../static/js/views/inbox.js', import.meta.url), 'utf8');
  assert.match(inbox, /body: shared\?\.body \|\| ''/, 'a share\'s long text reaches the box');
});
