import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TAB_LABEL_MAX, tabLabel } from '../../static/js/tablabel.js';

// A tab's name is at most TAB_LABEL_MAX characters: a longer one is cut with "…" and kept whole for its hover text.
describe('tabLabel', () => {
  it('leaves a name that fits as it is, with nothing to say on hover', () => {
    assert.deepEqual(tabLabel('Properties'), { text: 'Properties', full: null });
    assert.deepEqual(tabLabel('x'.repeat(TAB_LABEL_MAX)), { text: 'x'.repeat(TAB_LABEL_MAX), full: null });
  });

  it('cuts a longer one to the most it may have, "…" included, and keeps it whole', () => {
    const { text, full } = tabLabel('Area and objective');
    assert.equal(text, 'Area and obje…');
    assert.equal([...text].length, TAB_LABEL_MAX);
    assert.equal(full, 'Area and objective');
  });

  it('never ends on a space before the "…"', () => {
    assert.equal(tabLabel('Transcriptions list').text, 'Transcription…');
    assert.equal(tabLabel('Work log by week', 10).text, 'Work log…');
  });

  it('counts characters, not code units: an accent or an emoji is never split', () => {
    assert.equal(tabLabel('Análisis técnicos', 10).text, 'Análisis…');
    assert.equal(tabLabel('🚀🚀🚀🚀🚀', 3).text, '🚀🚀…');
  });

  it('leaves what is not a string (a node) alone', () => {
    const node = { nodeType: 1 };
    assert.deepEqual(tabLabel(node), { text: node, full: null });
  });
});
