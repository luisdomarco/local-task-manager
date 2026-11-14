// What a note says in Markdown beyond what marked reads, as Obsidian writes it. ui.js renderMarkdown adds it to marked
// once (`useExtras`); tests/js/mdextras.test.mjs runs it on the vendored marked.
// - A callout: a quote whose first line is `[!type] Title` — a box in its type's colour, its icon and title (the
//   type's name when there is none) over its body. `[!type]-` starts folded, `[!type]+` foldable and open.
// - ==highlighted== text (<mark>) and a #tag (a quiet chip), as Obsidian shows them.
// - Every blank line past the first keeps its gap (keepBlankLines), as in the editor.
// - Every table in a box of its own (.md-table) that scrolls sideways: a wide table keeps its words whole instead of
//   squeezing its columns to a letter each, and a cell of prose keeps room to read (cellClass).

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

/** Adds the extras to `marked` (once: marked.use adds up). `iconSvg(name)` draws a callout's icon. */
export function useExtras(marked, { iconSvg } = {}) {
  marked.use({
    hooks: { preprocess: keepBlankLines },
    extensions: [
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
