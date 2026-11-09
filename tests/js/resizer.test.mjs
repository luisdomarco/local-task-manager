// resizer.js: the arithmetic of a grip that resizes a panel (the sidebar, Docs' trees, the terminal dock).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampSize, dragDelta, keyDelta } from '../../static/js/resizer.js';

test('a drag changes the size by how far it went; inverted, the other way (a dock that grows upward)', () => {
  assert.equal(dragDelta(100, 160), 60);
  assert.equal(dragDelta(100, 40), -60);
  assert.equal(dragDelta(500, 440, true), 60); // dragged up 60: the dock is 60 taller
});

test('arrow keys: → and ↓ grow by a step, ← and ↑ shrink; inverted, the other way; other keys do nothing', () => {
  assert.equal(keyDelta('ArrowRight', 'x', 16), 16);
  assert.equal(keyDelta('ArrowLeft', 'x', 16), -16);
  assert.equal(keyDelta('ArrowUp', 'x', 16), 0); // not this grip's axis
  assert.equal(keyDelta('ArrowDown', 'y', 40), 40);
  assert.equal(keyDelta('ArrowUp', 'y', 40, true), 40); // the terminal dock: ↑ makes it taller
  assert.equal(keyDelta('ArrowDown', 'y', 40, true), -40);
  assert.equal(keyDelta('Enter', 'x', 16), 0);
});

test('a size stays within its limits, rounded', () => {
  assert.equal(clampSize(150, 180, 420), 180);
  assert.equal(clampSize(999, 180, 420), 420);
  assert.equal(clampSize(250.6, 180, 420), 251);
});
