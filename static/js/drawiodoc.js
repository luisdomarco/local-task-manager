// draw.io's frame, pure (drawioview.js mounts it): the document a sandboxed iframe gets to draw one diagram with
// draw.io's viewer, and the viewer's configuration. Tested in tests/js/drawiodoc.test.mjs.

/** JSON that can sit inside a <script> element: no `<` (so no `</script>`), no line separators. */
export const scriptJson = (value) => JSON.stringify(value)
  .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** Whether a file's text looks like a diagram draw.io can open: an <mxfile> or a bare <mxGraphModel>. */
export const isDrawioXml = (text) => /^\s*(<\?xml[^>]*>\s*)?<(mxfile|mxGraphModel)\b/.test(String(text || ''));

/** The viewer's configuration (GraphViewer's data-mxgraph) for a diagram's XML. Drawn as draw.io draws it, on its own
 * white paper in a dark page too, as a picture is: draw.io's dark mode leaves lines of the default colour black. */
export function viewerConfig(xml, { compact = false } = {}) {
  return {
    xml, 'dark-mode': false, highlight: '#3572b0', nav: true, resize: true, lightbox: false, responsive: true,
    'toolbar-nohide': !compact, toolbar: compact ? 'pages zoom layers' : 'pages zoom layers tags',
    'check-visible-state': false, 'show-link-icons': false, edit: null, editable: false,
  };
}

/**
 * The frame's whole document: its CSP (no network at all: scripts only inline or blob:, images and fonts data:/blob:),
 * every URL the viewer could fetch from emptied, and the diagram. It asks the page for the viewer's code (`ready`),
 * runs it from a blob: URL of its own, then draws and says how tall it is (`height`) or what went wrong (`error`).
 */
export function frameDoc(xml, { id, compact = false }) {
  const csp = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:";
  const urls = ['PROXY_URL', 'STYLE_PATH', 'SHAPES_PATH', 'STENCIL_PATH', 'DRAW_MATH_URL', 'GRAPH_IMAGE_PATH', 'DRAWIO_LIGHTBOX_URL',
    'IMAGE_PATH', 'CSS_PATH', 'RESOURCES_PATH', 'TEMPLATE_PATH', 'DRAWIO_LOG_URL', 'SAVE_URL', 'OPEN_URL', 'PLUGINS_BASE_PATH'];
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>html,body{margin:0;padding:0;background:#fff;color-scheme:light;overflow:hidden}
.mxgraph{max-width:100%}</style>
<script>${urls.map((u) => `window.${u}='data:,'`).join(';')};window.mxLoadResources=false;window.mxLoadStylesheets=false;</script>
</head><body><div id="d" class="mxgraph"></div>
<script type="application/json" id="cfg">${scriptJson(viewerConfig(xml, { compact }))}</script>
<script>
(function () {
  var id = ${scriptJson(id)}, started = false;
  function say(msg) { msg.tmDrawio = id; parent.postMessage(msg, '*'); }
  window.addEventListener('error', function (e) { say({ error: String(e.message || e) }); });
  function draw() {
    try {
      if (window.mxStencil) mxStencil.allowEval = false;
      var el = document.getElementById('d');
      el.setAttribute('data-mxgraph', document.getElementById('cfg').textContent);
      GraphViewer.createViewerForElement(el, function () {
        var send = function () { say({ height: Math.ceil(document.body.scrollHeight) }); };
        send();
        new ResizeObserver(send).observe(document.body);
      });
    } catch (e) { say({ error: String(e && e.message || e) }); }
  }
  window.addEventListener('message', function (e) {
    if (e.source !== parent || started || !e.data || typeof e.data.tmDrawioViewer !== 'string') return;
    started = true;
    var s = document.createElement('script');
    s.src = URL.createObjectURL(new Blob([e.data.tmDrawioViewer], { type: 'text/javascript' }));
    s.onload = draw;
    s.onerror = function () { say({ error: 'the viewer could not run' }); };
    document.head.appendChild(s);
  });
  say({ ready: true });
})();
</script></body></html>`;
}
