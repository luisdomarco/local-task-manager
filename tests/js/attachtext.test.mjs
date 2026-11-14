// INB-004: a picture or file brought into a doc — the name it is kept under and the text that shows it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachText, carriesFiles, keptName, placed } from '../../static/js/attachtext.js';

test('a nameless picture gets Obsidian\'s pasted name; a named file keeps its own', () => {
  const at = new Date(2026, 10, 14, 15, 30, 12);
  assert.equal(keptName('image.png', 'image/png', at), 'Pasted image 20261114153012.png');
  assert.equal(keptName('', 'image/jpeg', at), 'Pasted image 20261114153012.jpg');
  assert.equal(keptName('blob', 'image/webp', at), 'Pasted image 20261114153012.webp');
  assert.equal(keptName('Checkout flow.png', 'image/png', at), 'Checkout flow.png');
  assert.equal(keptName('spec.pdf', 'application/pdf', at), 'spec.pdf');
});

test('pictures embed at 300px, other files link; either can be asked for', () => {
  assert.equal(attachText('Acme Web/Docs/Pasted image 1.png'), '![[Pasted image 1.png|300]]');
  assert.equal(attachText('Acme Web/Docs/spec.pdf'), '[[spec.pdf]]');
  assert.equal(attachText('Acme Web/Docs/spec.pdf', { embed: true }), '![[spec.pdf]]');
  assert.equal(attachText('Acme Web/Docs/flow.png', { embed: false }), '[[flow.png]]');
});

test('a name a wikilink cannot hold becomes a Markdown link to its path', () => {
  assert.equal(attachText('Docs/Plan #2.png'), '![Plan #2.png](<Docs/Plan #2.png>)');
  assert.equal(attachText('Docs/a [draft].pdf'), '[a [draft].pdf](<Docs/a [draft].pdf>)');
});

test('only files from the computer count', () => {
  assert.equal(carriesFiles({ types: ['Files'] }), true);
  assert.equal(carriesFiles({ types: ['text/plain', 'text/uri-list'] }), false);
  assert.equal(carriesFiles(null), false);
});

test('an embed gets a line of its own; a link goes in as it is', () => {
  const v = '# Checkout\nSome text';
  assert.equal(placed(v, 0, 0, '![[a.png|300]]', true), '![[a.png|300]]\n');
  assert.equal(placed(v, 10, 10, '![[a.png|300]]', true), '\n![[a.png|300]]');
  assert.equal(placed(v, 11, 11, '![[a.png|300]]', true), '![[a.png|300]]\n');
  assert.equal(placed(v, 15, 15, '![[a.png|300]]', true), '\n![[a.png|300]]\n');
  assert.equal(placed(v, 15, 15, '[[spec.pdf]]', false), '[[spec.pdf]]');
  assert.equal(placed('', 0, 0, '![[a.png]]', true), '![[a.png]]');
});
