import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

let highlight;
before(async () => {
  globalThis.window = { DOMPurify: { sanitize: (html) => html } }; // the page's sanitizer; here, a pass-through
  ({ highlight } = await import('../../static/js/highlight.js'));
});

describe('highlight', () => {
  it('colours code in its language, the text escaped', async () => {
    const html = await highlight('const a = "<b>";', 'javascript');
    assert.match(html, /<span class="hljs-keyword">const<\/span>/);
    assert.match(html, /&lt;b&gt;/);
  });

  it('leaves plain text, an unknown language and a huge file to the caller', async () => {
    assert.equal(await highlight('just text', ''), null);
    assert.equal(await highlight('x', 'klingon'), null);
    assert.equal(await highlight('x'.repeat(400_001), 'javascript'), null);
  });

  it('colours a Markdown file\'s frontmatter as YAML, so a key with _ turns nothing italic', async () => {
    const html = await highlight('---\nrelated_to: INI-1\narchived: false\n---\n# Title\n\nsome *word*\n', 'markdown');
    assert.ok(html.startsWith('---\n<span class="hljs-attr">related_to:</span>'), html);
    assert.equal((html.match(/hljs-emphasis/g) || []).length, 1); // only the body's *word*
    assert.match(html, /hljs-section/);
  });
});
