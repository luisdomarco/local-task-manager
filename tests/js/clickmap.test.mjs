import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sourceOffset } from '../../static/js/clickmap.js';

describe('a click on rendered Markdown, in its source (clickmap.js)', () => {
  const src = '- [x] List 5 competitors\n\nLorem **ipsum** dolor sit amet, consectetur.\n\nSee [the docs](https://x.test) for more.';

  it('finds plain text where it is', () => {
    const text = ' dolor sit amet, consectetur.';
    assert.equal(sourceOffset(src, text, 7, 0.5), src.indexOf('sit amet'));
  });

  it('gets through the marks around a word', () => {
    assert.equal(sourceOffset(src, 'ipsum', 2, 0.4), src.indexOf('ipsum') + 2);
    assert.equal(sourceOffset(src, 'the docs', 4, 0.9), src.indexOf('docs'));
  });

  it('takes a repeated phrase where the click was', () => {
    const rep = 'same words here\n\nother\n\nsame words here';
    assert.equal(sourceOffset(rep, 'same words here', 5, 0), 5);
    assert.equal(sourceOffset(rep, 'same words here', 5, 0.95), rep.lastIndexOf('same') + 5);
  });

  it('says so when the text is not in the source', () => {
    assert.equal(sourceOffset(src, 'nowhere at all', 3, 0), -1);
    assert.equal(sourceOffset('', 'x', 0, 0), -1);
  });
});
