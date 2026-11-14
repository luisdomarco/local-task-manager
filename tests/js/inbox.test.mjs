// INB-010: the Inbox discards a row from the list itself — the trash as a row action, the normal delete (trash + Undo).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = (path) => readFileSync(new URL(`../../static/${path}`, import.meta.url), 'utf8');

test('a captured row ends in a trash that deletes it as Delete does', () => {
  const js = source('js/views/inbox.js');
  assert.match(js, /rowAction\('trash', `Discard \$\{item\.title\}`, \(\) => deleteItem\(item\.key\)/, 'the row action, not a button of its own');
  assert.match(js, /return \[related, transform, discard\]/, 'last in the row');
  assert.match(js, /cls: `hover-host /, 'the row hosts what its hover reveals');
});

test('a phone keeps the card\'s ⋯ for it', () => {
  const css = source('css/app.css');
  const phone = css.slice(css.indexOf('/* A phone: its controls share one row'));
  assert.match(phone.slice(0, 600), /\.inbox-discard \{ display: none; \}/);
});
