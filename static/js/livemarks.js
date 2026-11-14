// What the Live editor (livemd.js) draws over the Markdown, as data: no DOM and no CodeMirror view, so it is tested on
// its own (tests/js/livemarks.test.mjs). It reads the Lezer Markdown tree of the text. Out of the lines the caret or
// the selection is on, it hides the marks (`**`, `# `, `[…](url)`, `> `) and puts widgets in place of a checklist box,
// a bullet or a rule. On those lines everything shows as typed, as in Obsidian's Live Preview. Nothing here changes the
// text: hiding is drawing.
import { wikiHeading } from './filetree.js';

const HEADING = /^ATXHeading([1-6])$/;
// Nodes whose text is not Markdown: no [[link]] and no ref is looked for inside them (nor in a [text](url) link).
const LITERAL = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'HTMLBlock', 'Image', 'Autolink', 'URL', 'Comment']);
// mdcolour.js writes these two (as Obsidian's Highlightr plugin does); any other inline HTML is left as it is.
const COLOUR_OPEN = /^<(span|mark) style="(color|background): ?(#[0-9a-fA-F]{3,8});?">$/;

/** `[[target]]`, `[[target|alias]]`, `[[target#heading]]` and `[[#heading]]` (this note's) in a line — the bar escaped
 *  (`\|`) in a table cell — : [{ from, to, target, heading, label }] (offsets in it; `heading` null when it names none,
 *  `target` '' for this note). */
export function wikilinksIn(line) {
  const out = [];
  const re = /\[\[([^\]|#\n]*?)((?:#[^\]|\n]*)?)(?:\\?\|([^\]\n]*))?\]\]/g;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const target = m[1].trim().replace(/\\$/, '').trim();
    const heading = wikiHeading(m[2].replace(/\\$/, '')); // `[[#Part\|alias]]` in a table: the escape is the bar's
    if (!target && !heading) continue;
    out.push({ from: m.index, to: m.index + m[0].length, target, heading, label: (m[3] || target || heading).trim() });
  }
  return out;
}

/** Refs in a line (`STY-482`, a long `ACME-STY-001` too) that `isRef` knows: [{ from, to, ref }] (offsets in it). */
export function refsIn(line, isRef) {
  const out = [];
  const re = /(^|[^\w/#-])([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d+)(?![\w-])/g;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const from = m.index + m[1].length;
    if (isRef(m[2])) out.push({ from, to: from + m[2].length, ref: m[2] });
  }
  return out;
}

/** The line numbers (1-based) that `ranges` ([{ from, to }]) touch, in `doc` (CodeMirror's Text: lineAt). */
export function activeLines(doc, ranges) {
  const out = new Set();
  for (const r of ranges) {
    const a = doc.lineAt(Math.min(r.from, r.to)).number;
    const b = doc.lineAt(Math.max(r.from, r.to)).number;
    for (let n = a; n <= b; n += 1) out.add(n);
  }
  return out;
}

/** Text from `pos` to the end of its line, at most `n` characters. */
const ahead = (doc, pos, n) => doc.sliceString(pos, Math.min(pos + n, doc.lineAt(pos).to));

/**
 * liveMarks(tree, doc, { ranges, focused, from, to, isRef }) → { lines, marks, hides, widgets }, for the part from…to.
 *   lines   [{ at, cls }]                   a class on the line that starts at `at` (heading, quote, code block, rule)
 *   marks   [{ from, to, cls, attrs? }]     a span drawn with a class (bold, a link…), on every line
 *   hides   [{ from, to }]                  text not drawn, on lines that are not active
 *   widgets [{ from, to, kind, checked? }]  text drawn as a widget ('check', 'bullet', 'rule'), on lines not active
 * `ranges` are the selection's ranges. With `focused` false no line is active, so the whole text reads formatted.
 * A [[wikilink]] is drawn as a link (marked `cm-wikilink`, its target in data-target), and a ref that `isRef(ref)`
 * knows as one (`cm-ref`, data-ref): outside code and links.
 */
export function liveMarks(tree, doc, { ranges = [], focused = true, from = 0, to = doc.length, isRef = () => false } = {}) {
  const active = focused ? activeLines(doc, ranges) : new Set();
  const isActive = (pos) => active.has(doc.lineAt(pos).number);
  const lines = []; const marks = []; const hides = []; const widgets = [];
  const lineCls = (pos, cls) => lines.push({ at: doc.lineAt(pos).from, cls });
  const hide = (a, b) => { if (b > a && !isActive(a)) hides.push({ from: a, to: b }); };
  // A mark and the space after it (`# `, `> `): hidden together, so the text starts where the mark did.
  const hideWithSpace = (a, b) => hide(a, b + (ahead(doc, b, 1) === ' ' ? 1 : 0));
  const eachLine = (a, b, fn) => { for (let n = doc.lineAt(a).number, end = doc.lineAt(b).number; n <= end; n += 1) fn(doc.line(n)); };
  const colours = []; // open colour tags waiting for their close: [{ tag, from, to, prop, value }]
  const literal = []; // [from, to] of code, links and HTML blocks

  tree.iterate({
    from, to,
    enter(node) {
      const { name, from: a, to: b } = node;
      if (LITERAL.has(name)) literal.push([a, b]);
      const heading = HEADING.exec(name);
      if (heading) { lineCls(a, `cm-h cm-h${heading[1]}`); return; }
      switch (name) {
        case 'HeaderMark': {
          // The `#`s of a heading (not the closing ones of `# Title #`, which sit at the end: hidden the same way).
          if (ahead(doc, b, 1) === ' ' || b === doc.lineAt(b).to) hideWithSpace(a, b);
          else hide(a, b);
          return;
        }
        case 'StrongEmphasis': marks.push({ from: a, to: b, cls: 'cm-strong' }); return;
        case 'Emphasis': marks.push({ from: a, to: b, cls: 'cm-em' }); return;
        case 'Strikethrough': marks.push({ from: a, to: b, cls: 'cm-strike' }); return;
        case 'EmphasisMark': case 'StrikethroughMark':
          marks.push({ from: a, to: b, cls: 'cm-mark' }); hide(a, b); return;
        case 'InlineCode': marks.push({ from: a, to: b, cls: 'cm-icode' }); return;
        case 'CodeMark': {
          if (node.node.parent?.name === 'InlineCode') { marks.push({ from: a, to: b, cls: 'cm-mark' }); hide(a, b); }
          return;
        }
        case 'Link': {
          // [text](url "title"): the text drawn as a link, the brackets and the (url) part hidden. Anything else in
          // brackets (a reference link, an Obsidian callout's [!note]) stays as typed.
          const marksIn = node.node.getChildren('LinkMark');
          const url = node.node.getChild('URL');
          if (marksIn.length < 4 || !url || doc.sliceString(marksIn[1].to, marksIn[2].from) !== '') return undefined;
          const [open, close] = marksIn;
          literal.push([a, b]);
          marks.push({ from: open.to, to: close.from, cls: 'cm-link', attrs: { 'data-href': doc.sliceString(url.from, url.to) } });
          hide(open.from, open.to);
          hide(close.from, marksIn[marksIn.length - 1].to);
          return false;
        }
        case 'Image': return false; // ![alt](src): shown as typed for now
        case 'Autolink': case 'URL':
          if (node.node.parent?.name !== 'Link') marks.push({ from: a, to: b, cls: 'cm-link', attrs: { 'data-href': doc.sliceString(a, b).replace(/^<|>$/g, '') } });
          return;
        case 'Blockquote': eachLine(a, b, (l) => lineCls(l.from, 'cm-quote')); return;
        case 'QuoteMark': hideWithSpace(a, b); return;
        case 'FencedCode': {
          eachLine(a, b, (l) => lineCls(l.from, 'cm-codeblock'));
          lineCls(a, 'cm-codeblock-first');
          lineCls(b, 'cm-codeblock-last');
          return false; // the code inside is not Markdown
        }
        case 'CodeBlock': eachLine(a, b, (l) => lineCls(l.from, 'cm-codeblock')); return false;
        case 'HorizontalRule':
          lineCls(a, 'cm-rule-line');
          if (!isActive(a)) widgets.push({ from: a, to: b, kind: 'rule' });
          return;
        case 'ListMark': {
          const item = node.node.parent;
          const task = item?.getChild('Task');
          const marker = task?.getChild('TaskMarker');
          if (marker && !isActive(a)) {
            // `- [ ] ` → one checkbox (a numbered task keeps its number: only the box is a widget).
            const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
            const bullet = item.parent?.name === 'BulletList';
            widgets.push({ from: bullet ? a : marker.from, to: marker.to + (ahead(doc, marker.to, 1) === ' ' ? 1 : 0), kind: 'check', checked, box: marker.from });
            if (checked) marks.push({ from: marker.to, to: task.to, cls: 'cm-done' });
            return;
          }
          if (marker && /x/i.test(doc.sliceString(marker.from, marker.to))) marks.push({ from: marker.to, to: task.to, cls: 'cm-done' });
          if (item?.parent?.name === 'BulletList' && !marker && !isActive(a)) widgets.push({ from: a, to: b, kind: 'bullet' });
          else marks.push({ from: a, to: b, cls: 'cm-listmark' });
          return;
        }
        case 'TaskMarker': return; // drawn with its ListMark, above
        case 'HTMLTag': {
          const tag = doc.sliceString(a, b);
          const open = COLOUR_OPEN.exec(tag);
          if (open) { colours.push({ tag: open[1], from: a, to: b, prop: open[2], value: open[3] }); return; }
          const close = /^<\/(span|mark)>$/.exec(tag);
          if (!close) return;
          let i = colours.length - 1;
          while (i >= 0 && colours[i].tag !== close[1]) i -= 1;
          if (i < 0) return;
          const o = colours.splice(i, 1)[0];
          if (doc.lineAt(o.from).number !== doc.lineAt(a).number) return; // a colour over several lines: left as typed
          const style = o.prop === 'color' ? `color: ${o.value}` : `background: ${o.value}; border-radius: 3px`;
          marks.push({ from: o.to, to: a, cls: 'cm-colour', attrs: { style } });
          marks.push({ from: o.from, to: o.to, cls: 'cm-mark' }); marks.push({ from: a, to: b, cls: 'cm-mark' });
          hide(o.from, o.to); hide(a, b);
          return;
        }
        default:
      }
      return undefined;
    },
  });
  // [[links]] and refs: found in the text of each line, as the Markdown parser knows neither.
  const outside = (a, b) => !literal.some(([x, y]) => a < y && b > x);
  for (let n = doc.lineAt(from).number, end = doc.lineAt(Math.min(to, doc.length)).number; n <= end; n += 1) {
    const line = doc.line(n);
    const text = line.text;
    for (const w of wikilinksIn(text)) {
      const a = line.from + w.from; const b = line.from + w.to;
      if (!outside(a, b)) continue;
      const raw = text.slice(w.from + 2, w.to - 2);
      const bar = raw.indexOf('|');
      const shownFrom = bar >= 0 ? a + 2 + bar + 1 : a + 2;
      const attrs = w.heading ? { 'data-target': w.target, 'data-heading': w.heading } : { 'data-target': w.target };
      marks.push({ from: shownFrom, to: b - 2, cls: 'cm-wikilink', attrs });
      marks.push({ from: a, to: shownFrom, cls: 'cm-mark' }); marks.push({ from: b - 2, to: b, cls: 'cm-mark' });
      hide(a, shownFrom); hide(b - 2, b);
      literal.push([a, b]); // a ref inside it is the link's
    }
    for (const r of refsIn(text, isRef)) {
      const a = line.from + r.from; const b = line.from + r.to;
      if (outside(a, b)) marks.push({ from: a, to: b, cls: 'cm-ref', attrs: { 'data-ref': r.ref } });
    }
  }
  return { lines, marks, hides, widgets };
}

// A quote that is an Obsidian callout: its first line starts `> [!type]` (mdextras.js draws it).
const CALLOUT = /^\s{0,3}>\s?\[![A-Za-z][\w-]*\]/;
// Blocks whose inside holds no table, callout or diagram: not walked into.
const LEAF_BLOCKS = new Set(['Paragraph', 'CodeBlock', 'FencedCode', 'HTMLBlock', 'HorizontalRule', 'LinkReference',
  'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6']);

/**
 * liveBlocks(tree, doc, { ranges, focused }) → [{ from, to, kind }]: the blocks the Live editor draws whole, as the
 * preview does, in place of their text — a GFM table ('table'), a callout ('callout') and a ```mermaid fence
 * ('diagram'). Each covers whole lines (from the first line's start to the last one's end). A block the selection
 * touches is left out, so its Markdown shows to edit; with `focused` false none is.
 */
export function liveBlocks(tree, doc, { ranges = [], focused = true } = {}) {
  const active = focused ? activeLines(doc, ranges) : new Set();
  const out = [];
  tree.iterate({
    enter(node) {
      const { name } = node;
      let kind = null;
      if (name === 'Table') kind = 'table';
      else if (name === 'Blockquote' && CALLOUT.test(doc.lineAt(node.from).text)) kind = 'callout';
      else if (name === 'FencedCode') {
        const info = node.node.getChild('CodeInfo');
        if (info && doc.sliceString(info.from, info.to).trim().toLowerCase() === 'mermaid') kind = 'diagram';
      }
      if (!kind) return LEAF_BLOCKS.has(name) ? false : undefined;
      const first = doc.lineAt(node.from);
      const last = doc.lineAt(Math.max(node.from, node.to - (node.to > node.from && doc.sliceString(node.to - 1, node.to) === '\n' ? 1 : 0)));
      let touched = false;
      for (let n = first.number; n <= last.number && !touched; n += 1) touched = active.has(n);
      if (!touched) out.push({ from: first.from, to: last.to, kind });
      return false;
    },
  });
  return out;
}

/**
 * How the text separates its lines: '\n', '\r\n', or null when it mixes them (or uses a lone '\r'). The Live editor
 * keeps the one it finds, so a file saved by Windows or another editor comes back byte for byte. A text that mixes
 * them is opened in Source instead, where nothing is redrawn.
 */
export function lineSepOf(text) {
  const s = String(text);
  const crlf = (s.match(/\r\n/g) || []).length;
  const cr = (s.match(/\r/g) || []).length;
  const lf = (s.match(/\n/g) || []).length;
  if (!crlf) return cr ? null : '\n';
  return crlf === cr && crlf === lf ? '\r\n' : null;
}
