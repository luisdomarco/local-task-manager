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

  // What the editor draws behind its textarea must be the text itself, letter for letter, or the caret drifts off.
  const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

  it('colours a fenced block in the language it names, the rest as Markdown', async () => {
    const md = '# Notes\n\n```python\ndef f(x):\n    return "<b>"\n```\n\nand `inline` *text*\n';
    const html = await highlight(md, 'markdown');
    assert.match(html, /<span class="hljs-code">```python<\/span>\n<span class="hljs-keyword">def<\/span>/);
    assert.match(html, /<span class="hljs-code">```<\/span>\n/);
    assert.match(html, /hljs-section/);
    assert.match(html, /hljs-emphasis/);
    assert.equal(plain(html), md);
  });

  it('leaves an unknown, untagged or still open block to Markdown, and every text as it is', async () => {
    const cases = [
      '```mermaid\ngraph TD\n```\n',
      '```\nplain\n```\n',
      'typing\n```js\nconst a = 1\n',
      '---\nid: X_1\n---\n```sh\nls -la > out & echo "x"\n```\n~~~py\nimport os\n~~~\n',
      '```js\r\nlet a = 1\r\n```\r\nend\r\n',
      '```py\n```\n',
    ];
    for (const md of cases) assert.equal(plain(await highlight(md, 'markdown')), md, JSON.stringify(md));
    assert.doesNotMatch(await highlight('typing\n```js\nconst a = 1\n', 'markdown'), /hljs-keyword/);
    assert.match(await highlight(cases[3], 'markdown'), /<span class="hljs-built_in">import<\/span>|<span class="hljs-keyword">import<\/span>/);
  });
});
