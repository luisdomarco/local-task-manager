// draw.io diagrams: a .drawio file drawn by draw.io's own viewer (static/vendor/drawio/, offline), in the Explorer and
// Docs (its Diagram mode) and wherever rendered Markdown embeds one (`![[x.drawio]]`, a .md-drawio placeholder that
// filetree.js linkWikilinks writes).
//
// The viewer is 4.5 MB of someone else's code drawing what a file says (its labels are HTML), so it runs in a sandboxed
// iframe: `allow-scripts` alone gives it a null origin — no access to this page, its storage or the app's API — and the
// frame's Content-Security-Policy allows no network at all. The page fetches the viewer's code once and posts it to each
// frame, which runs it from a blob: URL of its own (a null-origin frame cannot load the app's files: the browser and the
// server's origin check both refuse it). The frame tells the page how tall the diagram is; the page sizes it. Nothing
// is loaded until a diagram is shown.
import { h, icon } from './ui.js';
import { fileUrl } from './api.js';
import { filesHref } from './filetree.js';
import { frameDoc, isDrawioXml } from './drawiodoc.js';

export { isDrawioXml };

const VIEWER = new URL('../vendor/drawio/viewer-static.min.js', import.meta.url).href;
const HEIGHT_MIN = 80;
const HEIGHT_MAX = 2000;
let seq = 0;

/** The viewer's code, fetched once by the page (same origin) and handed to each frame: a frame fetches nothing. */
let viewerText = null;
const viewerCode = () => (viewerText ||= fetch(VIEWER).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`the viewer: ${r.status}`))))
  .catch((e) => { viewerText = null; throw e; }));

// One listener for every frame: a message is taken only from the frame it names.
const frames = new Map(); // id → { frame, onError }
window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || typeof d.tmDrawio !== 'string') return;
  const f = frames.get(d.tmDrawio);
  if (!f || e.source !== f.frame.contentWindow) return;
  if (!f.frame.isConnected) { frames.delete(d.tmDrawio); return; }
  if (d.ready) {
    viewerCode().then((code) => f.frame.contentWindow?.postMessage({ tmDrawioViewer: code }, '*'), (err) => f.onError(err.message));
  }
  if (typeof d.height === 'number') f.frame.style.height = `${Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, d.height))}px`;
  if (d.error) f.onError(d.error);
});

/** A sandboxed frame drawing `xml`; `onError(text)` when the viewer says it could not. */
export function drawioFrame(xml, { title = 'Diagram', compact = false, onError = () => {} } = {}) {
  const id = `d${++seq}`;
  const frame = h('iframe', { class: 'drawio-frame', title, sandbox: 'allow-scripts', referrerpolicy: 'no-referrer' });
  frame.srcdoc = frameDoc(xml, { id, compact });
  frames.set(id, { frame, onError });
  return frame;
}

/** A .drawio file's text as its diagram (the Explorer's and Docs' Diagram mode). */
export function drawioView(text, { path }) {
  const notice = h('p', { class: 'drawio-notice muted small', hidden: true });
  if (!isDrawioXml(text)) {
    return h('div', { class: 'drawio-view' }, h('p', { class: 'muted' }, 'This file is not a draw.io diagram it can draw: Source has its text.'));
  }
  const frame = drawioFrame(text, { title: path.split('/').pop(), onError: (why) => { notice.hidden = false; notice.textContent = `draw.io says: ${why}`; } });
  return h('div', { class: 'drawio-view' }, frame, notice);
}

/** Each `![[x.drawio]]` placeholder in `root` (rendered Markdown) drawn as its diagram, framed, its name a link to it. */
export function renderDrawios(root, { href = filesHref } = {}) {
  for (const el of root?.querySelectorAll('.md-drawio[data-drawio]:not([data-drawn])') || []) {
    el.dataset.drawn = '1';
    const path = el.dataset.drawio;
    const name = path.split('/').pop().replace(/\.drawio$/i, '');
    const head = h('div', { class: 'drawio-embed-head' }, h('a', { href: href(path), class: 'drawio-embed-name' }, icon('diagram', 14), name));
    el.replaceChildren(head, h('p', { class: 'muted small' }, 'Loading diagram…'));
    fetch(fileUrl(path)).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`)))).then((text) => {
      if (!el.isConnected) return;
      el.replaceChildren(head, isDrawioXml(text)
        ? drawioFrame(text, { title: name, compact: true, onError: (why) => el.append(h('p', { class: 'muted small' }, `draw.io says: ${why}`)) })
        : h('p', { class: 'muted small' }, 'Not a draw.io diagram.'));
    }, (e) => { if (el.isConnected) el.replaceChildren(head, h('p', { class: 'muted small' }, `This diagram could not be read (${e.message}).`)); });
  }
}
