import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Loaded with no DOM (its load-time effects skip themselves); h() reads `document` only when called.
import { removeButton } from '../../static/js/ui.js';

// Just enough of a DOM for h() and icon(): elements that keep their class and attributes.
class FakeNode {}
class FakeEl extends FakeNode {
  constructor(tag) { super(); this.tag = tag; this.className = ''; this.attrs = {}; this.children = []; this.style = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener() {}
  append(...c) { this.children.push(...c); }
  get textContent() { return this.children.map((c) => c.textContent || '').join(''); }
}
globalThis.Node = FakeNode;
globalThis.document = {
  createElement: (tag) => new FakeEl(tag),
  createElementNS: (_ns, tag) => new FakeEl(tag),
  createTextNode: (text) => Object.assign(new FakeNode(), { textContent: text }),
};

describe('removeButton', () => {
  it('is never a .chip or a .row itself, whatever its size', () => {
    // A tag input counts its chips with `.chip:not(.tag-more)`: a × classed `chip` was counted too (+N read "+-1").
    for (const size of ['chip', 'row']) {
      const classes = removeButton('Remove x', () => {}, { size }).className.split(/\s+/);
      assert.deepEqual(classes, ['x-btn', `x-${size}`]);
    }
  });

  it('keeps a caller class beside its own', () => {
    assert.equal(removeButton('Remove x', () => {}, { cls: 'vb-chip-x' }).className, 'x-btn x-row vb-chip-x');
  });
});
