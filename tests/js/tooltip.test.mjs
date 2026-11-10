import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { placeTip, tipText } from '../../static/js/tooltip.js';

// Modern's tooltip (tooltip.js): where it goes, from the element's box, the tip's size and the window's.
const view = { width: 1000, height: 800 };
const box = (left, top, width = 30, height = 30) => ({ left, top, right: left + width, bottom: top + height });
const size = { width: 120, height: 24 };

describe('tooltip placement', () => {
  it('goes above the element, centred on it, 6px away', () => {
    assert.deepEqual(placeTip(box(400, 300), size, view), { left: 355, top: 270, side: 'top' });
  });

  it('flips below when there is no room above', () => {
    assert.deepEqual(placeTip(box(400, 10), size, view), { left: 355, top: 46, side: 'bottom' });
  });

  it('stays above at the bottom of the window', () => {
    assert.equal(placeTip(box(400, 770), size, view).side, 'top');
  });

  it('is moved along to stay 8px inside the window at either side', () => {
    assert.equal(placeTip(box(0, 300), size, view).left, 8);
    assert.equal(placeTip(box(985, 300, 15), size, view).left, 1000 - 8 - 120);
  });

  it('wider than the window: from its left margin', () => {
    assert.equal(placeTip(box(100, 300), { width: 2000, height: 24 }, view).left, 8);
  });

  it('with room on neither side: the side with more of it, kept inside the window', () => {
    const tall = { width: 120, height: 500 };
    assert.deepEqual(placeTip(box(400, 150, 30, 400), tall, view), { left: 355, top: 292, side: 'bottom' });
    assert.deepEqual(placeTip(box(400, 300, 30, 400), tall, view), { left: 355, top: 8, side: 'top' });
  });
});

describe('tooltip text', () => {
  it('keeps the lines of a title, without empty ones at the ends', () => {
    assert.equal(tipText('\nName\nRuns in ~/x\n'), 'Name\nRuns in ~/x');
    assert.equal(tipText('  Save  '), 'Save');
    assert.equal(tipText(''), '');
    assert.equal(tipText(null), '');
  });
});
