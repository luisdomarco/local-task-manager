import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as CM from '../../static/vendor/codemirror/codemirror.js';
import { activeLines, lineSepOf, liveBlocks, liveMarks, refsIn, wikilinksIn } from '../../static/js/livemarks.js';
import { lfOffset } from '../../static/js/livemd.js';

// The parser the Live editor uses (livemd.js markdownLanguage): GFM, no setext headings.
const parser = CM.markdownParser.configure([CM.GFM, { remove: ['SetextHeading'] }]);
const docOf = (text) => CM.EditorState.create({ doc: text }).doc;

/** liveMarks on `text` with the caret at `caret` (null: not focused), its ranges as the text they cover. */
function marks(text, caret = null, opts = {}) {
  const doc = docOf(text);
  const r = liveMarks(parser.parse(doc.toString()), doc, {
    ranges: caret === null ? [] : [{ from: caret, to: caret }], focused: caret !== null, ...opts,
  });
  const s = (x) => doc.sliceString(x.from, x.to);
  return {
    lines: r.lines.map((l) => [doc.lineAt(l.at).number, l.cls]),
    marks: r.marks.map((m) => [s(m), m.cls]),
    hides: r.hides.map(s),
    widgets: r.widgets.map((w) => [s(w), w.kind, w.checked]),
    raw: r,
  };
}

describe('Live: what is drawn over the Markdown (livemarks.js)', () => {
  it('hides the marks of bold, italic, strikethrough and code off the active line', () => {
    const m = marks('**b** _i_ ~~s~~ `c`');
    assert.deepEqual(m.hides, ['**', '**', '_', '_', '~~', '~~', '`', '`']);
    assert.deepEqual(m.marks.filter(([, c]) => c !== 'cm-mark'), [['**b**', 'cm-strong'], ['_i_', 'cm-em'], ['~~s~~', 'cm-strike'], ['`c`', 'cm-icode']]);
  });

  it('shows everything as typed on the line the caret is on, and only there', () => {
    const text = '# One\n**b**\n# Two';
    const on2 = marks(text, text.indexOf('b'));
    assert.deepEqual(on2.hides, ['# ', '# ']); // the headings' marks; line 2's ** stay
    assert.deepEqual(on2.lines, [[1, 'cm-h cm-h1'], [3, 'cm-h cm-h1']]);
    assert.deepEqual(marks(text, 0).hides, ['**', '**', '# ']);
  });

  it('a selection over several lines shows them all as typed', () => {
    const doc = docOf('a\nb\nc\nd');
    assert.deepEqual([...activeLines(doc, [{ from: 2, to: 5 }])], [2, 3]);
    assert.deepEqual([...activeLines(doc, [{ from: 5, to: 2 }])], [2, 3]);
  });

  it('not focused: the whole text reads formatted', () => {
    assert.deepEqual(marks('# T\n**b**', null).hides, ['# ', '**', '**']);
  });

  it('draws [text](url) as its text, and leaves other brackets as typed', () => {
    const m = marks('see [the site](https://x.y "t") and [!note] and [ref][1]');
    assert.deepEqual(m.hides, ['[', '](https://x.y "t")']);
    const link = m.raw.marks.find((x) => x.cls === 'cm-link');
    assert.deepEqual(link.attrs, { 'data-href': 'https://x.y' });
  });

  it('checklist boxes and bullets become widgets; a done item is struck through', () => {
    const m = marks('- [ ] todo\n- [x] done\n- plain\n1. one\n2. [ ] numbered');
    assert.deepEqual(m.widgets, [['- [ ] ', 'check', false], ['- [x] ', 'check', true], ['-', 'bullet', undefined], ['[ ] ', 'check', false]]);
    assert.ok(m.marks.some(([t, c]) => t === ' done' && c === 'cm-done'));
    assert.ok(m.marks.some(([t, c]) => t === '1.' && c === 'cm-listmark'));
  });

  it('a checklist line keeps its box as typed while the caret is on it', () => {
    const m = marks('- [ ] todo', 3);
    assert.deepEqual(m.widgets, []);
  });

  it('a heading, a quote, a code block and a rule mark their lines', () => {
    const m = marks('## H\n> q\n\n```js\nx\n```\n\n---');
    assert.deepEqual(m.lines, [[1, 'cm-h cm-h2'], [2, 'cm-quote'], [4, 'cm-codeblock'], [5, 'cm-codeblock'], [6, 'cm-codeblock'],
      [4, 'cm-codeblock-first'], [6, 'cm-codeblock-last'], [8, 'cm-rule-line']]);
    assert.deepEqual(m.hides, ['## ', '> ']);
    assert.deepEqual(m.widgets, [['---', 'rule', undefined]]);
  });

  it('a line underlined with --- is a paragraph and a rule, not a heading (as the page reads it)', () => {
    const m = marks('Title\n---');
    assert.deepEqual(m.lines, [[2, 'cm-rule-line']]);
  });

  it('draws mdcolour.js colours with their tags hidden; other HTML stays as typed', () => {
    const m = marks('a <span style="color: #d93025">red</span> and <mark style="background: #fff3a3a6">lit</mark> <b>x</b>');
    assert.deepEqual(m.hides, ['<span style="color: #d93025">', '</span>', '<mark style="background: #fff3a3a6">', '</mark>']);
    const colours = m.raw.marks.filter((x) => x.cls === 'cm-colour').map((x) => x.attrs.style);
    assert.deepEqual(colours, ['color: #d93025', 'background: #fff3a3a6; border-radius: 3px']);
  });

  it('draws [[links]] and the refs of items as links, outside code and links', () => {
    const isRef = (r) => ['STY-31', 'ACME-STY-001'].includes(r);
    const m = marks('[[Notes]] [[Plan|the plan]] STY-31 `STY-31` [STY-31](http://a) ACME-STY-001 STY-99 x-STY-31', null, { isRef });
    assert.deepEqual(m.marks.filter(([, c]) => c === 'cm-wikilink' || c === 'cm-ref'),
      [['Notes', 'cm-wikilink'], ['the plan', 'cm-wikilink'], ['STY-31', 'cm-ref'], ['ACME-STY-001', 'cm-ref']]);
    assert.deepEqual(m.hides.filter((t) => t.includes('[[') || t === ']]'), ['[[', ']]', '[[Plan|', ']]']);
    const wl = m.raw.marks.find((x) => x.cls === 'cm-wikilink');
    assert.deepEqual(wl.attrs, { 'data-target': 'Notes' });
  });

  it('a [[doc#heading]] carries its heading, for ⌘-click to open the doc there', () => {
    const m = marks('[[Plan#Risks]] [[Plan#Scope#Out|out]]');
    assert.deepEqual(m.raw.marks.filter((x) => x.cls === 'cm-wikilink').map((x) => x.attrs),
      [{ 'data-target': 'Plan', 'data-heading': 'Risks' }, { 'data-target': 'Plan', 'data-heading': 'Out' }]);
  });

  it('hides nothing on a part of the text it was not asked for', () => {
    const text = '**a**\n**b**';
    const doc = docOf(text);
    const r = liveMarks(parser.parse(text), doc, { focused: false, from: 6, to: text.length });
    assert.ok(r.hides.every((x) => x.from >= 6));
  });
});

describe('Live: text helpers (livemarks.js)', () => {
  it('finds [[links]] with an alias or a heading', () => {
    assert.deepEqual(wikilinksIn('a [[Doc]] b [[Doc#Part|shown]] [[ broken'), [
      { from: 2, to: 9, target: 'Doc', heading: null, label: 'Doc' },
      { from: 12, to: 30, target: 'Doc', heading: 'Part', label: 'shown' },
    ]);
    // This note's heading, and an alias after a bar escaped in a table cell
    assert.deepEqual(wikilinksIn('[[#Part|p]] | [[Doc\\|Alias]] |').map(({ target, heading, label }) => [target, heading, label]),
      [['', 'Part', 'p'], ['Doc', null, 'Alias']]);
    // A heading before an escaped bar keeps no backslash: the link jumps to it
    assert.deepEqual(wikilinksIn('| [[#AR-1 · Loop\\|Loop]] | [[Doc#Part\\|p]] |').map(({ heading, label }) => [heading, label]),
      [['AR-1 · Loop', 'Loop'], ['Part', 'p']]);
    assert.deepEqual(wikilinksIn('[[]] [[#]]'), []);
  });

  it('finds refs the vault knows, not inside a word, a path or an anchor', () => {
    const isRef = () => true;
    assert.deepEqual(refsIn('STY-1, (TSK-22) a/STY-3 #STY-4 STY-5x ACME-INI-001', isRef).map((r) => r.ref), ['STY-1', 'TSK-22', 'ACME-INI-001']);
    assert.deepEqual(refsIn('STY-1 STY-2', (r) => r === 'STY-2').map((r) => r.ref), ['STY-2']);
  });
});

describe('Live keeps the text byte for byte (livemarks.js lineSepOf, CodeMirror)', () => {
  const roundTrip = (text) => {
    const sep = lineSepOf(text);
    const state = CM.EditorState.create({ doc: text, extensions: [CM.EditorState.lineSeparator.of(sep)] });
    return state.sliceDoc();
  };

  it('knows the line breaks of a text, and refuses a mix', () => {
    assert.equal(lineSepOf('a\nb'), '\n');
    assert.equal(lineSepOf('one line'), '\n');
    assert.equal(lineSepOf('a\r\nb\r\n'), '\r\n');
    assert.equal(lineSepOf('a\r\nb\nc'), null);
    assert.equal(lineSepOf('a\rb'), null);
  });

  it('gives back what it was given: CRLF, tabs, trailing spaces, frontmatter, no final newline', () => {
    for (const text of ['---\ntitle: x\n---\n\n# T\n\tindented  \n- [ ] a', 'a\r\nb\r\n\r\n', '', 'no newline at the end', '\n\n']) {
      assert.equal(roundTrip(text), text);
    }
  });

  it('without the line separator CodeMirror would turn CRLF into LF (what lineSepOf is for)', () => {
    assert.equal(CM.EditorState.create({ doc: 'a\r\nb' }).sliceDoc(), 'a\nb');
  });

  it('an edit in a CRLF text keeps its CRLF', () => {
    const state = CM.EditorState.create({ doc: 'a\r\nb', extensions: [CM.EditorState.lineSeparator.of('\r\n')] });
    const next = state.update({ changes: { from: 1, insert: '\r\nnew' } }).state;
    assert.equal(next.sliceDoc(), 'a\r\nnew\r\nb');
  });

  it('turns an offset in the saved text into one that counts a line break as one character', () => {
    assert.equal(lfOffset('a\r\nb\r\nc', 6), 4); // the "c"
    assert.equal(lfOffset('a\nb', 2), 2);
  });
});

describe('Live: blocks drawn whole (livemarks.js liveBlocks)', () => {
  const TEXT = 'Intro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> [!note] Title\n> body\n\n> just a quote\n\n```mermaid\ngraph TD; A-->B\n```\n\n```js\nx\n```';
  const blocks = (caret) => {
    const doc = docOf(TEXT);
    return liveBlocks(parser.parse(TEXT), doc, { ranges: caret === null ? [] : [{ from: caret, to: caret }], focused: caret !== null })
      .map((b) => [b.kind, doc.sliceString(b.from, b.to)]);
  };

  it('draws a table, a callout and a mermaid fence whole, on whole lines; not a plain quote or other code', () => {
    assert.deepEqual(blocks(0), [
      ['table', '| a | b |\n|---|---|\n| 1 | 2 |'],
      ['callout', '> [!note] Title\n> body'],
      ['diagram', '```mermaid\ngraph TD; A-->B\n```'],
    ]);
  });

  it('leaves the block the caret is on as Markdown, and draws them all when not focused', () => {
    assert.deepEqual(blocks(TEXT.indexOf('| 1')).map(([k]) => k), ['callout', 'diagram']);
    assert.deepEqual(blocks(TEXT.indexOf('body')).map(([k]) => k), ['table', 'diagram']);
    assert.deepEqual(blocks(TEXT.indexOf('```mermaid') + 12).map(([k]) => k), ['table', 'callout']);
    assert.deepEqual(blocks(null).map(([k]) => k), ['table', 'callout', 'diagram']);
  });
});
