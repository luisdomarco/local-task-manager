// Code colouring for the Explorer's file view (views/files.js) and the editor as you type (mdeditor.js): highlight.js,
// vendored as ES modules in static/vendor/highlight/ (no request leaves the app). Loaded only when needed, each language once.
import { fenceLanguage } from './filetree.js';

const BASE = '../vendor/highlight';
// A language whose grammar hands parts to others: HTML its <style> and <script>, Markdown its HTML.
const NEEDS = { xml: ['css', 'javascript'], markdown: ['xml'], php: ['xml'], vue: ['css', 'javascript'] };
const MAX_CHARS = 400_000; // past this, colouring would hold the page up for little: plain text
// A closed fenced block whose info string names a language: its opening line, the code, its closing line.
const FENCED = /^((`{3,}|~{3,})[ \t]*([\w+#.-]+)[^\n]*\n)([\s\S]*?)^(\2[`~]*[ \t]*\r?)$/gm;
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let core = null;
const loading = new Map();

async function language(hljs, name) {
  if (!loading.has(name)) {
    loading.set(name, import(`${BASE}/languages/${name}.js`).then((m) => hljs.registerLanguage(name, m.default)));
  }
  return loading.get(name);
}

/**
 * `text` coloured as `lang` (a highlight.js language: filetree.js codeLanguage), as sanitized HTML for a <code>; null
 * when there is nothing to colour (plain text, too long, or the highlighter failed to load), so the caller keeps the text.
 */
export async function highlight(text, lang) {
  if (!lang || text.length > MAX_CHARS) return null;
  try {
    core ||= import(`${BASE}/core.js`).then((m) => m.default);
    const hljs = await core;
    // A Markdown file's frontmatter is YAML: coloured as Markdown, the `_` of a key like related_to turns the rest italic.
    const fm = lang === 'markdown' && text.match(/^(---\r?\n)([\s\S]*?\r?\n)(---[ \t]*(?:\r?\n|$))/);
    const body = fm ? text.slice(fm[0].length) : text;
    // Markdown's grammar paints a fenced block in one colour: one that names its language (```py) is coloured in it,
    // as Cursor and Obsidian do. Unclosed (still being typed) or unknown, it stays as Markdown colours it.
    const fences = lang === 'markdown' ? [...body.matchAll(FENCED)].map((m) => ({ m, as: fenceLanguage(m[3]) })).filter((f) => f.as) : [];
    const names = [lang, ...(fm ? ['yaml'] : []), ...fences.map((f) => f.as)];
    await Promise.all([...new Set(names.flatMap((n) => [n, ...(NEEDS[n] || [])]))].map((name) => language(hljs, name)));
    const color = (part, as) => (part ? hljs.highlight(part, { language: as, ignoreIllegals: true }).value : '');
    let out = '';
    let at = 0;
    for (const { m, as } of fences) {
      const code = (line) => `<span class="hljs-code">${escape(line.replace(/\n$/, ''))}</span>${line.endsWith('\n') ? '\n' : ''}`;
      out += color(body.slice(at, m.index), lang) + code(m[1]) + color(m[4], as) + code(m[5]);
      at = m.index + m[0].length;
    }
    out += color(body.slice(at), lang);
    const html = fm ? `${fm[1]}${color(fm[2], 'yaml')}${fm[3]}${out}` : out; // the --- lines hold nothing to escape
    // highlight.js escapes the text it wraps; sanitized anyway, as everything this app puts in innerHTML.
    return window.DOMPurify ? window.DOMPurify.sanitize(html) : null;
  } catch {
    return null;
  }
}
