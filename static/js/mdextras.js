// What a note says in Markdown beyond what marked reads, as Obsidian writes it. ui.js renderMarkdown adds it to marked
// once (`useExtras`); tests/js/mdextras.test.mjs runs it on the vendored marked.
// - A callout: a quote whose first line is `[!type] Title` — a box in its type's colour, its icon and title (the
//   type's name when there is none) over its body. `[!type]-` starts folded, `[!type]+` foldable and open.
// - ==highlighted== text (<mark>) and a #tag (a quiet chip), as Obsidian shows them.
// - Every blank line past the first keeps its gap (keepBlankLines), as in the editor.
// - Every table in a box of its own (.md-table) that scrolls sideways: a wide table keeps its words whole instead of
//   squeezing its columns to a letter each, and a cell of prose keeps room to read (cellClass).
// - %%comments%% are not shown (stripComments), inline or over several lines, as in Obsidian's reading view; nor is a
//   block's id (` ^id` at the end of its line, what `![[Note#^id]]` names).
// - Footnotes: `[^1]` (or `[^name]`) with its `[^1]: text` anywhere in the note, and inline `^[text]`, numbered in the
//   order they are read and listed under the note (.footnotes). The marks carry no href (the page's routes are its
//   #/… address): ui.js scrolls to the note and back on a click.

/** A callout's type → [its icon (ui.js ICONS), its colour (.callout-<tone>)]; Obsidian's names and their aliases. */
const TYPES = {
  note: ['note', 'note'],
  abstract: ['list', 'abstract'], summary: ['list', 'abstract'], tldr: ['list', 'abstract'],
  info: ['info', 'info'], todo: ['check', 'info'],
  tip: ['flame', 'tip'], hint: ['flame', 'tip'], important: ['flame', 'tip'],
  success: ['check', 'success'], check: ['check', 'success'], done: ['check', 'success'],
  question: ['help', 'question'], help: ['help', 'question'], faq: ['help', 'question'],
  warning: ['alert', 'warning'], caution: ['alert', 'warning'], attention: ['alert', 'warning'],
  failure: ['x', 'danger'], fail: ['x', 'danger'], missing: ['x', 'danger'],
  danger: ['zap', 'danger'], error: ['zap', 'danger'], bug: ['alert', 'danger'],
  example: ['list', 'example'],
  quote: ['quote', 'quote'], cite: ['quote', 'quote'],
};
/** A type Obsidian does not know reads as a note, as there. */
export const calloutType = (type) => TYPES[type] || TYPES.note;

// The quote's first line, as marked renders it: `<p>[!type]± title` up to a line break or the paragraph's end.
const HEAD = /^\s*<p>\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*(.*?)(<br>\n?|\n|<\/p>\n?)/s;

/**
 * The HTML of a quote (`inner`: what marked rendered inside the <blockquote>) as a callout, or null when it is not one.
 * `iconSvg(name)` draws an icon. The title and body are marked's own output, sanitized later with the rest.
 */
export function calloutHtml(inner, iconSvg = () => '') {
  const m = HEAD.exec(inner);
  if (!m) return null;
  const type = m[1].toLowerCase();
  const [ico, tone] = calloutType(type);
  const title = m[3].trim() || type.charAt(0).toUpperCase() + type.slice(1);
  const rest = inner.slice(m[0].length);
  // The title ended the paragraph: the body is what follows. It ended a line: the paragraph goes on in the body.
  const body = (m[4].startsWith('</p>') ? rest : `<p>${rest}`).trim();
  const head = `${iconSvg(ico)}<span class="callout-label">${title}</span>`;
  const cls = `callout callout-${tone}`;
  const content = body && body !== '<p></p>' ? `<div class="callout-body">${body}</div>` : '';
  if (m[2]) {
    return `<details class="${cls}" data-callout="${type}"${m[2] === '+' ? ' open' : ''}><summary class="callout-title">${head}</summary>${content}</details>\n`;
  }
  return `<div class="${cls}" data-callout="${type}"><div class="callout-title">${head}</div>${content}</div>\n`;
}

// A #tag: after a space, a bracket or the line's start; letters, digits, _ - /, and not only digits (#123 is not one).
const TAG = /^#((?:[\p{L}\p{N}_/-])*[\p{L}_/-](?:[\p{L}\p{N}_/-])*)/u;
const TAG_AT = /(^|[\s(])#[\p{L}\p{N}_/-]/u;

/** The room a table cell's text needs, from its length: '' (short: its own width), 'md-cell-mid' or 'md-cell-long'. */
export function cellClass(html) {
  const n = html.replace(/<[^>]*>/g, '').replace(/&[#\w]+;/g, ' ').trim().length;
  return n >= 40 ? 'md-cell-long' : n >= 16 ? 'md-cell-mid' : '';
}

/**
 * Blank lines as the editor shows them: in Markdown any run of blank lines is one paragraph break; here each blank
 * line past the first leaves a line's gap (.md-gap), as the owner reads a note. Fenced code is left as it is.
 */
export function keepBlankLines(md) {
  const lines = String(md || '').split('\n');
  const out = [];
  let fence = null; // the fence that opened the code block we are in (``` or ~~~, at least 3), or null
  let blanks = 0;
  const flush = () => {
    if (blanks >= 2) out.push('', ...Array(blanks - 1).fill('<div class="md-gap"></div>'), '');
    else if (blanks === 1) out.push('');
    blanks = 0;
  };
  for (const line of lines) {
    if (fence) {
      out.push(line);
      if (line.trim().startsWith(fence) && /^\s*([`~])\1{2,}\s*$/.test(line)) fence = null;
      continue;
    }
    if (!line.trim()) { blanks += 1; continue; }
    flush();
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (open) fence = open[1];
    out.push(line);
  }
  if (blanks) out.push(...Array(blanks).fill('')); // trailing blank lines: nothing to space
  return out.join('\n');
}

/**
 * A note without its %%comments%%: `%%…%%` on a line or over several, and an unclosed `%%` hides the rest of the note,
 * as Obsidian reads it. Fenced code and `inline code` keep theirs.
 */
export function stripComments(md) {
  const text = String(md || '');
  if (!text.includes('%%')) return text;
  // Fenced blocks (odd parts) are left as they are; in the rest, an inline code span is kept and a comment dropped.
  const parts = text.split(/(^[ ]{0,3}(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ ]{0,3}(?:`{3,}|~{3,})[ \t]*$|(?![\s\S])))/m);
  let open = false; // a comment opened in an earlier part and not closed yet
  return parts.map((part, i) => {
    if (i % 2) return open ? '' : part;
    let out = '';
    let rest = part;
    if (open) {
      const end = rest.indexOf('%%');
      if (end < 0) return '';
      rest = rest.slice(end + 2);
      open = false;
    }
    out += rest.replace(/(`+)[^`]*?\1|%%[\s\S]*?(?:%%|$)/g, (m, tick) => {
      if (tick) return m;
      if (!/%%$/.test(m) || m.length < 4) open = true; // not closed in this part
      return '';
    });
    return out;
  }).join('');
}

/** The note without its blocks' ids (` ^id` ending a line, or alone on one), outside fenced code. */
export function hideBlockIds(md) {
  const text = String(md || '');
  if (!text.includes('^')) return text;
  return text.split(/(^[ ]{0,3}(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ ]{0,3}(?:`{3,}|~{3,})[ \t]*$|(?![\s\S])))/m)
    .map((part, i) => (i % 2 ? part : part.replace(/(^|[ \t])\^[A-Za-z0-9-]+[ \t]*$/gm, '')))
    .join('');
}

// The footnotes of the note being parsed: reset by the preprocess hook before each parse (marked parses synchronously).
let notes = null;
const resetNotes = () => { notes = { defs: new Map(), order: [], numbers: new Map(), html: new Map() }; };
resetNotes();
const footKey = (id) => String(id).trim().toLowerCase();
/** The number a footnote's mark shows (`key` the id, or a fresh one for an inline note): its first read gives it one. */
function footNumber(key) {
  if (!notes.numbers.has(key)) { notes.order.push(key); notes.numbers.set(key, notes.order.length); }
  return notes.numbers.get(key);
}
const footMark = (n) => `<sup class="fn-ref"><a class="fn-link" data-fn="${n}">${n}</a></sup>`;
/** The list of the note's footnotes, under its text (empty when it marks none). */
function footList() {
  if (!notes.order.length) return '';
  const rows = notes.order.map((key, i) => `<li data-fn-note="${i + 1}">${notes.html.get(key) ?? ''} <a class="fn-back" data-fn-back="${i + 1}" title="Back to the text">↩</a></li>`);
  return `<section class="footnotes"><ol>${rows.join('')}</ol></section>\n`;
}

// A click on the n-th checklist box of a rendered description: the n-th "- [ ]" / "- [x]" marker of its source, flipped
// (mdblock.js). Boxes and markers are counted the same way whether the list is tight or loose (a blank line between
// items only wraps their text in a <p>).
export function toggleTask(md, n) {
  let i = -1;
  return md.replace(/^(\s*[-*+]\s+)\[([ xX])\]/gm, (m, pre, mark) => (++i === n ? `${pre}[${mark === ' ' ? 'x' : ' '}]` : m));
}

/** Adds the extras to `marked` (once: marked.use adds up). `iconSvg(name)` draws a callout's icon. */
export function useExtras(marked, { iconSvg } = {}) {
  marked.use({
    hooks: {
      preprocess: (md) => { resetNotes(); return keepBlankLines(hideBlockIds(stripComments(md))); },
      postprocess: (html) => `${html}${footList()}`,
    },
    extensions: [
      {
        // `[^id]: text` (its next lines too, when indented): kept for the list under the note, not drawn where it is.
        name: 'footnoteDef', level: 'block',
        start(src) { const m = /^ {0,3}\[\^[^\]\s]+\]:/m.exec(src); return m ? m.index : undefined; },
        tokenizer(src) {
          const m = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?: {2,}|\t)[^\n]*)*)(?:\n|$)/.exec(src);
          if (!m) return undefined;
          const key = footKey(m[1]);
          const text = m[2].replace(/\n(?: {2,}|\t)/g, '\n').trim();
          const token = { type: 'footnoteDef', raw: m[0], key, tokens: this.lexer.inlineTokens(text) };
          if (!notes.defs.has(key)) notes.defs.set(key, token);
          return token;
        },
        renderer(token) {
          if (notes.defs.get(token.key) === token) notes.html.set(token.key, this.parser.parseInline(token.tokens));
          return '';
        },
      },
      {
        // `[^id]`: the mark of a footnote written in the note (one that is not reads as written); `^[text]` an inline one.
        name: 'footnoteRef', level: 'inline',
        start(src) { const m = /\[\^|\^\[/.exec(src); return m ? m.index : undefined; },
        tokenizer(src) {
          const ref = /^\[\^([^\]\s]+)\]/.exec(src);
          if (ref && notes.defs.has(footKey(ref[1]))) return { type: 'footnoteRef', raw: ref[0], key: footKey(ref[1]) };
          const inline = /^\^\[([^\]\n]+)\]/.exec(src);
          if (inline) return { type: 'footnoteRef', raw: inline[0], key: null, tokens: this.lexer.inlineTokens(inline[1]) };
          return undefined;
        },
        renderer(token) {
          if (token.key) return footMark(footNumber(token.key));
          const key = `^inline ${notes.order.length + 1}`; // no [^id] can be this: an id has no space
          notes.html.set(key, this.parser.parseInline(token.tokens));
          return footMark(footNumber(key));
        },
      },
      {
        name: 'highlight', level: 'inline',
        start(src) { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
        tokenizer(src) {
          const m = /^==(?=[^\s=])([^\n]*?[^\s=])==(?!=)/.exec(src);
          if (m) return { type: 'highlight', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
          return undefined;
        },
        renderer(token) { return `<mark>${this.parser.parseInline(token.tokens)}</mark>`; },
      },
      {
        name: 'tag', level: 'inline',
        start(src) { const m = TAG_AT.exec(src); return m ? m.index + m[1].length : undefined; },
        tokenizer(src) {
          const m = TAG.exec(src);
          if (m) return { type: 'tag', raw: m[0], text: m[1] };
          return undefined;
        },
        renderer(token) { return `<span class="md-tag">#${token.text}</span>`; },
      },
    ],
    renderer: {
      blockquote(quote) { return calloutHtml(quote, iconSvg) || false; }, // false: marked's own <blockquote>
      // A task's box with no space after it (marked writes one): the gap is the stylesheet's, so the first line starts
      // where its wrapped lines do (app.css `.md li > input`).
      // And a task whose text starts on the line AFTER its `- [ ]`: the empty first line is a `space` token, which in
      // a LOOSE list (a blank line between the items) marked renders as a paragraph of its own — so the box took a
      // whole line and the text fell under it (TSK-363). The same markdown in a tight list is one line; joining the
      // box's empty paragraph to the next one makes the loose list agree. Only when the next block is a paragraph:
      // a task followed by a real block (a nested list, a quote, a fence) keeps it, and a box with nothing after it
      // stays an empty box.
      listitem(text, task) {
        if (!task) return false;
        const joined = text.replace(/^<p>(<input [^>]*>)\s*<\/p>\s*<p>/, '<p>$1');
        return `<li>${joined.replace(/^(<p>)?(<input [^>]*>)\s+/, '$1$2')}</li>\n`;
      },
      // A cell with words to read keeps room for them (.md-cell-mid / -long: a least and a most width), so a table
      // wider than the screen scrolls instead of wrapping its prose a word per line; a short cell is as wide as it is.
      tablecell(content, flags) {
        const tag = flags.header ? 'th' : 'td';
        const cls = cellClass(content);
        return `<${tag}${flags.align ? ` align="${flags.align}"` : ''}>${cls ? `<div class="${cls}">${content}</div>` : content}</${tag}>\n`;
      },
      table(header, body) {
        return `<div class="md-table"><table>\n<thead>\n${header}</thead>\n${body ? `<tbody>${body}</tbody>` : ''}</table></div>\n`;
      },
    },
  });
}
