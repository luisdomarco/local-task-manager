# diagrams.net viewer v32.5.5 (Apache-2.0) — how this folder was made

`.drawio` files and `![[x.drawio]]` embeds are drawn by draw.io's own viewer (`static/js/drawioview.js`), offline. It is
vendored as it ships, one file, unchanged:

| File | What |
|---|---|
| `viewer-static.min.js` | `src/main/webapp/js/viewer-static.min.js` of github.com/jgraph/drawio at tag `v32.5.5` (4,474,121 bytes, sha256 `15777571ef7c042b2a4a6c6d29052f416fbaaaae5dcf868521c4a3a75f2147d8`): the viewer with its stencils inside, so it needs no server |
| `LICENSE` | the repository's licence (Apache-2.0) |

**It never reaches the network.** The viewer runs in a sandboxed iframe (`sandbox="allow-scripts"`, so a null origin:
no access to the page, its cookies or the app's API) whose Content-Security-Policy allows this script and inline code,
and nothing else to load — no `connect-src`, images and fonts only as `data:`/`blob:`. The URLs it would fetch from
(`PROXY_URL`, `STYLE_PATH`, `STENCIL_PATH`…) are set to nothing before it loads; `mxStencil.allowEval` stays off and the
CSP has no `unsafe-eval`. A diagram that needs a remote image or math typesetting draws without them.

To update: take `viewer-static.min.js` from a newer tag (at least two weeks old), replace the file, write its size and
sha256 here, and check a diagram and an embed on a sample server (light and dark).
