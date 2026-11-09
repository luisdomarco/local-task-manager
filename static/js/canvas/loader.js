// Excalidraw (0.18.0, MIT) and the React it runs on (18.3.1): one ES module vendored under static/vendor/excalidraw/
// (BUILD.md says how it was made), imported the first time a canvas opens, with its stylesheet. EXCALIDRAW_ASSET_PATH
// points its fonts at the vendored folder: nothing comes from a CDN.
const BASE = new URL('../../vendor/excalidraw/', import.meta.url).href;
let libs = null;

/** → the module: Excalidraw's exports, plus React and createRoot. Loaded once (a failed load is tried again next time). */
export function loadExcalidraw() {
  if (libs) return libs;
  window.EXCALIDRAW_ASSET_PATH = BASE;
  if (!document.querySelector('link[data-excalidraw]')) {
    const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `${BASE}excalidraw.css` });
    css.setAttribute('data-excalidraw', '');
    document.head.append(css);
  }
  libs = import(`${BASE}excalidraw.js`);
  libs.catch(() => { libs = null; });
  return libs;
}
