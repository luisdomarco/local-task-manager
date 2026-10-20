import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fitChips } from '../../static/js/chipfit.js';

// gap 4, the text field needs 90, "+N" takes 36 (the defaults).
describe('a tag field on one line (fitChips)', () => {
  it('shows every chip and the text field when they fit', () => {
    assert.deepEqual(fitChips([50, 50], 300), { shown: 2, input: true }); // 54 + 54 + 90 = 198
    assert.deepEqual(fitChips([50, 50], 198), { shown: 2, input: true }); // exactly
  });

  it('shows the text field alone when there are no chips, whatever the room', () => {
    assert.deepEqual(fitChips([], 0), { shown: 0, input: true });
  });

  it('puts what does not fit behind "+N", without the text field', () => {
    // Three chips need 158 > 150, so one at least goes: two chips (108) + "+N" (36) = 144
    assert.deepEqual(fitChips([50, 50, 50], 150), { shown: 2, input: false });
    // Four need 212 > 200: three chips (162) + "+N" (36) = 198 ≤ 200
    assert.deepEqual(fitChips([50, 50, 50, 50], 200), { shown: 3, input: false });
  });

  it('drops only the text field when the chips fit without it', () => {
    // 50 + 4 + 50 = 104 ≤ 150, but not with the field (198): every chip, no "+N", no field
    assert.deepEqual(fitChips([50, 50], 150), { shown: 2, input: false });
    assert.deepEqual(fitChips([50, 50], 104), { shown: 2, input: false }); // exactly
    assert.deepEqual(fitChips([50, 50], 103), { shown: 1, input: false }); // then "+1"
  });

  it('keeps the order: a long chip stops the line, even if a later short one would fit', () => {
    assert.deepEqual(fitChips([40, 200, 20], 150), { shown: 1, input: false });
  });

  it('shows "+N" alone when not even the first chip fits beside it', () => {
    assert.deepEqual(fitChips([300, 20], 150), { shown: 0, input: false });
  });

  it('takes other measures', () => {
    const m = { gap: 0, input: 10, more: 20 };
    assert.deepEqual(fitChips([30, 30, 30], 100, m), { shown: 3, input: true }); // 90 + 10 = 100
    assert.deepEqual(fitChips([30, 30, 30], 90, m), { shown: 3, input: false }); // the chips alone
    assert.deepEqual(fitChips([30, 30, 30], 85, m), { shown: 2, input: false }); // 60 + 20 = 80
  });
});
