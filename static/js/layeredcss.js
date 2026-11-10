// A third-party stylesheet loaded on demand (Excalidraw's, xterm's), into a cascade layer of the page (css/main.css):
// a plain <link> would land outside every layer, and so above the whole app whatever its rules' specificity.
//
// Excalidraw and xterm go in the `app` layer, after app.css: where they stood before the layers (loaded after app.css,
// both unlayered), so between them and app.css specificity and then order still decide, as app.css's overrides of
// them were written for. In `vendor`, under app.css, a bare `button { color }` of the app's would beat Excalidraw's own
// `.excalidraw .dropdown-menu-button` (measured: its toolbar's icons changed colour).

/** Adds `href` once (a URL, or a path from the page) into `layer` and → its <style>, whose `load` fires once the sheet is in. */
export function layeredCss(href, layer) {
  const found = [...document.querySelectorAll('style[data-layered-css]')].find((el) => el.dataset.layeredCss === href);
  if (found) return found;
  const el = document.createElement('style');
  el.dataset.layeredCss = href;
  el.textContent = `@import url(${JSON.stringify(href)}) layer(${layer});`;
  document.head.append(el);
  return el;
}
