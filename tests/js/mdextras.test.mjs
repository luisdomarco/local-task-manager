// Obsidian's callouts, ==highlights==, #tags and tables that scroll, on the vendored marked (as ui.js renderMarkdown
// uses it: breaks on).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calloutHtml, calloutType, cellClass, hideBlockIds, keepBlankLines, stripComments, toggleTask, useExtras } from '../../static/js/mdextras.js';

// marked is a UMD script the page loads as is (no module): run it with an `exports` to fill (package.json is "module").
const exports = {};
new Function('exports', 'module', readFileSync(new URL('../../static/vendor/marked.min.js', import.meta.url), 'utf8'))(exports, { exports });
const { Marked } = exports;
const md = new Marked();
useExtras(md, { iconSvg: (name) => `<i data-icon="${name}"></i>` });
const render = (text) => md.parse(text, { breaks: true });

test('a callout: its type\'s colour and icon, its title over its body', () => {
  const html = render('> [!info] Origin\n> Imported from **Todoist**.\n> Second line.');
  assert.match(html, /^<div class="callout callout-info" data-callout="info"><div class="callout-title"><i data-icon="info"><\/i><span class="callout-label">Origin<\/span><\/div>/);
  assert.match(html, /<div class="callout-body"><p>Imported from <strong>Todoist<\/strong>.<br>Second line.<\/p>\s*<\/div><\/div>/);
  assert.doesNotMatch(html, /\[!info\]|<blockquote/);
});

test('no title: the type\'s name; no body: the title alone; an unknown type reads as a note', () => {
  assert.match(render('> [!warning]'), /callout-warning.*<span class="callout-label">Warning<\/span><\/div><\/div>/s);
  assert.doesNotMatch(render('> [!question] No body'), /callout-body/);
  assert.match(render('> [!whatever] Mine\n> text'), /class="callout callout-note" data-callout="whatever"/);
  assert.deepEqual(calloutType('caution'), calloutType('warning'));
});

test('the body in its own paragraph after the title\'s', () => {
  const html = render('> [!tip] Title\n>\n> Body paragraph.');
  assert.match(html, /<span class="callout-label">Title<\/span><\/div><div class="callout-body"><p>Body paragraph.<\/p>/);
});

test('- folds it, + makes it foldable and open', () => {
  assert.match(render('> [!tip]- Hidden\n> inside'), /^<details class="callout callout-tip" data-callout="tip"><summary class="callout-title">.*Hidden<\/span><\/summary><div class="callout-body"><p>inside/s);
  assert.match(render('> [!tip]+ Shown\n> inside'), /^<details class="callout callout-tip" data-callout="tip" open>/);
});

test('a plain quote stays a quote; a [!type] not first is text', () => {
  assert.match(render('> just a quote'), /^<blockquote>\n<p>just a quote<\/p>\n<\/blockquote>/);
  assert.match(render('> text first\n> [!note] later'), /^<blockquote>/);
  assert.equal(calloutHtml('<p>no</p>'), null);
});

test('==highlight== and #tag; a heading, a number, an anchor in a link and code stay as they are', () => {
  assert.equal(render('a ==very **important**== thing'), '<p>a <mark>very <strong>important</strong></mark> thing</p>\n');
  assert.equal(render('a == b == c'), '<p>a == b == c</p>\n');
  assert.equal(render('see #product and #team/ops.'), '<p>see <span class="md-tag">#product</span> and <span class="md-tag">#team/ops</span>.</p>\n');
  assert.equal(render('#tag first'), '<p><span class="md-tag">#tag</span> first</p>\n');
  assert.equal(render('# Heading'), '<h1>Heading</h1>\n');
  assert.equal(render('issue #123, a#b, `#code`'), '<p>issue #123, a#b, <code>#code</code></p>\n');
  assert.match(render('[x](https://a.com/#frag)'), /href="https:\/\/a.com\/#frag"/);
});

test('a table in a box that scrolls; a cell of prose keeps room to read, a short one is as wide as it is', () => {
  const html = render('| Task | Due |\n|---|:-:|\n| Reconcile the supplier invoices for the quarter | 2026-05-20 |\n| Call the bank | x |');
  assert.match(html, /^<div class="md-table"><table>\n<thead>\n<tr>\n<th>Task<\/th>\n<th align="center">Due<\/th>/);
  assert.match(html, /<td><div class="md-cell-long">Reconcile the supplier invoices for the quarter<\/div><\/td>/);
  assert.match(html, /<td align="center">2026-05-20<\/td>/);
  assert.match(html, /<td>Call the bank<\/td>/);
  assert.match(html, /<\/table><\/div>\n$/);
  assert.equal(cellClass('Website redesign'), 'md-cell-mid');
  assert.equal(cellClass('<a href="https://example.com/very/long">ok</a>'), '');
  assert.equal(cellClass('x'.repeat(40)), 'md-cell-long');
});

test('every blank line past the first keeps its gap, never inside code', () => {
  const GAP = '<div class="md-gap"></div>';
  assert.equal(keepBlankLines('a\n\nb'), 'a\n\nb'); // one blank line: a new paragraph, as always
  assert.equal(keepBlankLines('a\n\n\nb'), `a\n\n${GAP}\n\nb`);
  assert.equal(keepBlankLines('a\n\n\n\nb'), `a\n\n${GAP}\n${GAP}\n\nb`);
  assert.equal(keepBlankLines('```\nx\n\n\n\ny\n```\n\n\nz'), `\`\`\`\nx\n\n\n\ny\n\`\`\`\n\n${GAP}\n\nz`);
  assert.equal(keepBlankLines('~~~~\n```\n\n\n~~~~\nq'), '~~~~\n```\n\n\n~~~~\nq'); // a ``` inside ~~~~ does not close it
  assert.equal(keepBlankLines('a\n\n\n'), 'a\n\n\n'); // trailing blank lines space nothing
  assert.equal(keepBlankLines('a\r\n\r\n\r\nb'), `a\r\n\n${GAP}\n\nb`); // a blank line of a CRLF text is blank
  // Through marked, a gap between the two paragraphs
  const html = render('one\n\n\ntwo');
  assert.match(html, /<p>one<\/p>\n<div class="md-gap"><\/div>\n+<p>two<\/p>/);
});

test('a task\'s box has no space after it, tight or loose; other items are marked\'s own', () => {
  assert.match(render('- [ ] `a` → b'), /<li><input disabled="" type="checkbox"><code>a<\/code> → b<\/li>/);
  assert.match(render('- [x] done'), /<li><input checked="" disabled="" type="checkbox">done<\/li>/);
  assert.match(render('- [ ] one\n\n- [ ] two'), /<li><p><input disabled="" type="checkbox">one<\/p>/);
  assert.match(render('- plain'), /<li>plain<\/li>/);
  assert.match(render('- [ ] outer\n  - [ ] inner'), /<li><input disabled="" type="checkbox">outer<ul>\n<li><input disabled="" type="checkbox">inner<\/li>/);
});

// TSK-363. The text of a task written on the line AFTER its `- [ ]` leaves an empty first line, which marked lexes
// as a `space` token. In a TIGHT list that token folds away; in a LOOSE one (a blank line between the items) it
// became a paragraph of its own, so the box took a whole line and the text fell under it — measured in the app on
// 2026-11-25 as the box's middle 19px ABOVE the top of its text (21px on a phone), against 11px below it for a task
// that reads right. The same markdown, two different layouts, decided by a blank line somewhere else in the list.
test('a task whose text starts on the next line keeps its box, loose as well as tight (TSK-363)', () => {
  const loose = render('- [ ] \n  texto\n\n- [ ] otra');
  assert.match(loose, /<li><p><input disabled="" type="checkbox">texto<\/p>/, 'the box was left alone in a paragraph of its own');
  assert.doesNotMatch(loose, /<p>\s*<input[^>]*>\s*<\/p>/, 'no paragraph holds nothing but the box');
  // The same markdown in a tight list already read right, and still does: one line, box first.
  assert.match(render('- [ ] \n  texto'), /<li><input disabled="" type="checkbox">texto<\/li>/);
  // A numbered one, and a ticked one, come the same way.
  assert.match(render('1. [ ] \n   texto\n\n2. [ ] otra'), /<li><p><input disabled="" type="checkbox">texto<\/p>/);
  assert.match(render('- [x] \n  texto\n\n- [ ] otra'), /<li><p><input checked="" disabled="" type="checkbox">texto<\/p>/);
});

// The join is only ever a box's empty paragraph with the paragraph after it. Everything else a task can hold is a
// block the writer meant, and is left where it is — this is what says the fix did not reach past its case.
test('nothing else about a task item moves (TSK-363)', () => {
  // A real second paragraph stays a second paragraph: its first line is not empty, so there is nothing to join.
  assert.match(render('- [ ] uno\n\n  dos\n\n- [ ] tres'), /<li><p><input disabled="" type="checkbox">uno<\/p>\n<p>dos<\/p>/);
  // A box with nothing after it stays an empty box — the shape a template line leaves, and common in a real vault.
  assert.match(render('- [ ] \n\n- [ ] otra'), /<li><p><input disabled="" type="checkbox"><\/p>\n<\/li>/);
  // A task whose next block is not a paragraph keeps it: a nested list, a quote, a fence.
  assert.match(render('- [ ] \n  - sub\n\n- [ ] otra'), /<li><p><input disabled="" type="checkbox"><\/p>\n<ul>/);
  assert.match(render('- [ ] \n  > cita\n\n- [ ] otra'), /<li><p><input disabled="" type="checkbox"><\/p>\n<blockquote>/);
  // A continuation on the next line was already one paragraph with a <br>, and is untouched.
  assert.match(render('- [ ] uno\n  dos\n\n- [ ] tres'), /<li><p><input disabled="" type="checkbox">uno<br>dos<\/p>/);
  // And a list with no tasks is marked's own.
  assert.match(render('- uno\n\n- dos'), /<li><p>uno<\/p>\n<\/li>/);
});

test('a click on the n-th box flips the n-th marker, tight or loose, and only that one', () => {
  assert.equal(toggleTask('- [ ] a\n- [ ] b\n- [x] c', 1), '- [ ] a\n- [x] b\n- [x] c');
  assert.equal(toggleTask('- [ ] a\n\n- [ ] b\n\n- [X] c', 2), '- [ ] a\n\n- [ ] b\n\n- [ ] c');
  assert.equal(toggleTask('intro\n* [ ] a\n  + [ ] nested', 1), 'intro\n* [ ] a\n  + [x] nested');
  // Each box rendered has its marker at the same index, loose or not.
  for (const text of ['- [ ] a\n- [x] b', '- [ ] a\n\n- [x] b\n\n- [ ] c']) {
    const boxes = render(text).match(/<input /g).length;
    assert.equal(boxes, text.match(/\[[ xX]\]/g).length);
  }
});

test('%%comments%% are not shown: inline, over lines, unclosed to the end; code keeps them', () => {
  assert.equal(stripComments('a %%hidden%% b'), 'a  b');
  assert.equal(stripComments('a\n%%\nblock\nof lines\n%%\nb'), 'a\n\nb');
  assert.equal(stripComments('a `%%kept%%` b'), 'a `%%kept%%` b');
  assert.equal(stripComments('```\n%%kept%%\n```\nx %%y%%'), '```\n%%kept%%\n```\nx ');
  assert.equal(stripComments('shown %%from here on\nnothing'), 'shown ');
  assert.equal(stripComments('100% sure'), '100% sure');
  assert.doesNotMatch(render('Before %%secret%% after'), /secret/);
});

test('a block\'s ^id is not shown, outside code', () => {
  assert.equal(hideBlockIds('para ^abc\n2^3\n```\nx ^keep\n```'), 'para\n2^3\n```\nx ^keep\n```');
  assert.equal(render('A line ^id-1'), '<p>A line</p>\n');
});

test('footnotes: numbered as they are read, listed under the note; one not written reads as text', () => {
  const html = render('One[^a] two[^b] again[^a] and [^gone].\nInline^[an **inline** one].\n\n[^b]: Bee\n    goes on.\n[^a]: First *note*.');
  const marks = [...html.matchAll(/data-fn="(\d)"/g)].map((m) => m[1]);
  assert.deepEqual(marks, ['1', '2', '1', '3']);
  assert.match(html, /and \[\^gone\]\./);
  assert.match(html, /<section class="footnotes"><ol><li data-fn-note="1">First <em>note<\/em>\. <a class="fn-back" data-fn-back="1"[^>]*>↩<\/a><\/li><li data-fn-note="2">Bee<br>goes on\./);
  assert.match(html, /<li data-fn-note="3">an <strong>inline<\/strong> one/);
  assert.doesNotMatch(html, /\[\^a\]:|href=/, 'the definitions are not drawn where they are; the marks have no href');
  assert.doesNotMatch(render('No notes.'), /footnotes/, 'a note without footnotes has no list (the last parse\'s are not kept)');
});

