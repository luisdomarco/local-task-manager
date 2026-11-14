// Diagrams in rendered Markdown: a ```mermaid fence drawn as its diagram (Mermaid, static/vendor/mermaid/). Mermaid is
// about 3.5 MB, so it loads the first time a view holds one, never with the page. Called on what renderMarkdown filled
// (a doc's Preview, a description, the editor's View pane, a Live editor's block): each fence's <pre> becomes a
// .md-diagram holding the SVG, with a corner button to expand it (expand.js); one Mermaid cannot read keeps its code,
// with why under it.
import { expandButton } from './expand.js';

const SRC = new URL('../vendor/mermaid/mermaid.min.js', import.meta.url).href;
let loading = null;
let queue = Promise.resolve(); // Mermaid draws one diagram at a time (it measures text in a scratch element)
let seq = 0;
const drawn = new Map(); // `${theme}\n${source}` → its SVG: a redraw of the same text is instant
const DRAWN_MAX = 60;

/** Mermaid, once: a classic script that sets globalThis.mermaid. → it, or null when it cannot be loaded. */
function loadMermaid() {
  loading ||= new Promise((resolve) => {
    if (globalThis.mermaid) { resolve(globalThis.mermaid); return; }
    const el = document.createElement('script');
    el.src = SRC;
    el.onload = () => resolve(globalThis.mermaid || null);
    el.onerror = () => { loading = null; resolve(null); };
    document.head.append(el);
  });
  return loading;
}

const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};

/** The SVG of `source`, drawn in the page's theme (light or dark). Throws Mermaid's error when it cannot read it. */
function draw(mermaid, source) {
  const theme = isDark() ? 'dark' : 'default';
  const key = `${theme}\n${source}`;
  if (drawn.has(key)) return Promise.resolve(drawn.get(key));
  const job = queue.then(async () => {
    // strict: labels are text, no script or link in them; errors are thrown, not drawn into the page
    // The page's own font, by name: Mermaid measures each label with it, so the boxes fit the text drawn in them.
    const fontFamily = getComputedStyle(document.body).fontFamily;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, suppressErrorRendering: true, fontFamily, themeVariables: { fontFamily } });
    seq += 1;
    const { svg } = await mermaid.render(`tm-diagram-${seq}`, source);
    if (drawn.size >= DRAWN_MAX) drawn.delete(drawn.keys().next().value);
    drawn.set(key, svg);
    return svg;
  });
  queue = job.catch(() => {});
  return job;
}

/** Mermaid's SVG sanitized again, as all rendered Markdown is (DOMPurify): strict mode already keeps its labels text,
 *  this keeps out anything else. Its HTML labels live in <foreignObject>, which is let through for them. Without
 *  DOMPurify nothing is drawn (fails closed, as renderMarkdown). */
function clean(svg) {
  if (!window.DOMPurify) throw new Error('no sanitizer');
  return window.DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject'], HTML_INTEGRATION_POINTS: { foreignobject: true },
  });
}

/** The ```mermaid fences in `root` (rendered Markdown) drawn as diagrams. Nothing is loaded when there is none. */
export async function renderDiagrams(root) {
  const codes = [...(root?.querySelectorAll('pre > code.language-mermaid') || [])];
  if (!codes.length) return;
  const mermaid = await loadMermaid();
  if (!mermaid) return; // stays code: the script could not be loaded
  for (const code of codes) {
    const pre = code.parentElement;
    if (!pre?.isConnected) continue;
    const source = code.textContent;
    try {
      const svg = await draw(mermaid, source);
      if (!pre.isConnected) continue;
      const box = document.createElement('div');
      box.className = 'md-diagram';
      box.innerHTML = clean(svg);
      expandButton(box);
      pre.replaceWith(box);
    } catch (e) {
      if (!pre.isConnected || pre.nextElementSibling?.classList.contains('md-diagram-error')) continue;
      const why = document.createElement('p');
      why.className = 'md-diagram-error muted small';
      why.textContent = `This diagram could not be drawn: ${String(e?.message || e).split('\n')[0]}`;
      pre.after(why);
    }
  }
}
