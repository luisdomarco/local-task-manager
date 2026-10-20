// Code colouring for the Explorer's file view (views/files.js): highlight.js, vendored as ES modules in
// static/vendor/highlight/ (no request leaves the app). Loaded only when a code file is opened, each language once.
const BASE = '../vendor/highlight';
// A language whose grammar hands parts to others: HTML its <style> and <script>, Markdown its HTML.
const NEEDS = { xml: ['css', 'javascript'], markdown: ['xml'], php: ['xml'], vue: ['css', 'javascript'] };
const MAX_CHARS = 400_000; // past this, colouring would hold the page up for little: plain text

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
    await Promise.all([lang, ...(NEEDS[lang] || []), ...(fm ? ['yaml'] : [])].map((name) => language(hljs, name)));
    const color = (part, as) => hljs.highlight(part, { language: as, ignoreIllegals: true }).value;
    const html = fm
      ? `${fm[1]}${color(fm[2], 'yaml')}${fm[3]}${color(text.slice(fm[0].length), lang)}` // the --- lines hold nothing to escape
      : color(text, lang);
    // highlight.js escapes the text it wraps; sanitized anyway, as everything this app puts in innerHTML.
    return window.DOMPurify ? window.DOMPurify.sanitize(html) : null;
  } catch {
    return null;
  }
}
