// Item 10: what another app shares, as the Inbox's capture text (static/js/share.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shareText, sharedIn } from '../../static/js/share.js';

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
