# Excalidraw 0.18.0 (MIT), with React 18.3.1 — how this folder was made

The canvases (`static/js/canvas/`) run on Excalidraw. Since 0.18 it ships only as an ES module that imports its
dependencies by bare name, so it cannot be served as it is. This folder is a **one-off build** of it, made outside the
repo and vendored as files, as the rest of `static/vendor/`. The app itself has no npm and no bundler.

| File | What |
|---|---|
| `excalidraw.js` | the entry: everything `@excalidraw/excalidraw` exports, plus `React` and `createRoot` (react-dom/client) |
| `chunks/` | what it loads when needed (languages, export, fonts' subsetting) |
| `excalidraw.css` | `@excalidraw/excalidraw/dist/prod/index.css` |
| `fonts/` | `dist/prod/fonts/`, **without Xiaolai** (12 MB, only for Chinese/Japanese/Korean text) |
| `*.LEGAL.txt` | the licences of what the build bundles (React's among them) |
| `build/` | the entry, the Mermaid stub below and `patch.py`, the patch made after the build (last section) |

**Mermaid is left out.** `@excalidraw/mermaid-to-excalidraw` is replaced by `build/stub-mermaid.js`, which throws.
Mermaid weighs ~3.5 MB and only serves *Mermaid to Excalidraw*; that dialog says it is not available.

To make it again (or for another version), in an empty folder outside the repo:

```bash
npm install @excalidraw/excalidraw@0.18.0 react@18.3.1 react-dom@18.3.1 esbuild@0.24.2
cp <repo>/static/vendor/excalidraw/build/*.js .
NODE_ENV=production npx esbuild entry.js --bundle --format=esm --splitting --minify --target=es2020 \
  --conditions=production --outdir=out --entry-names=excalidraw '--chunk-names=chunks/[name]-[hash]' \
  '--define:process.env.NODE_ENV="production"' '--define:process.env.IS_PREACT="false"' \
  --alias:@excalidraw/mermaid-to-excalidraw=./stub-mermaid.js --legal-comments=external
```

Then copy `out/*` here (and patch it: *After the build*, below), with `node_modules/@excalidraw/excalidraw/dist/prod/index.css` as `excalidraw.css` and its
`fonts/` without `Xiaolai/`.

## After the build: the app's patch

Four replacements in the renderer's chunk (the one with rough.js, `chunks/chunk-TLEGBNM4.js` in this build), made by
`build/patch.py` — run it on a fresh build, then check a canvas at 100% on a 1× screen (one row of black pixels per
1 px line) and an arrow's head:

```bash
python3 build/patch.py chunks/chunk-<hash>.js   # "4 patches applied"; again: "already patched"
```

Each replacement must match exactly once, or the script stops and says which: a new version needs its own look.

| # | Why | Before | After |
|---|---|---|---|
| 1 | Chrome strokes a line of ≤ 1 device pixel as a *hairline*, broken every few pixels: rough.js strokes at least a hair over 1 device pixel (the context's scale, devicePixelRatio × zoom) | `i.lineWidth=n.strokeWidth,` | `i.lineWidth=(t=>Math.max(n.strokeWidth,1.01/Math.hypot(t.a,t.b)))(i.getTransform()),` |
| 2 | An element's cache canvas draws it from a whole pixel, so a line an odd number of device pixels wide falls across two rows at half grey: it is drawn half a pixel in (not a text, an image or a freehand line) | `l.save(),l.translate(U*d,U*d),` | `l.save();let tmHalf=e.type==="text"\|\|e.type==="image"\|\|e.type==="freedraw"?0:Math.max(1,Math.round((e.strokeStyle!=="solid"?e.strokeWidth+.5:e.strokeWidth)*window.devicePixelRatio*d))%2/2;l.translate(U*d+tmHalf,U*d+tmHalf),` |
| 3 | …and that canvas is laid on the scene at a whole device pixel, not where the scroll puts it (resampled soft) | `t.drawImage(e.canvas,(o+n.scrollX)*window.devicePixelRatio-l*e.scale/e.scale,(s+n.scrollY)*window.devicePixelRatio-l*e.scale/e.scale,` | `t.drawImage(e.canvas,Math.round(((o+n.scrollX)*window.devicePixelRatio-l)*n.zoom.value)/n.zoom.value,Math.round(((s+n.scrollY)*window.devicePixelRatio-l)*n.zoom.value)/n.zoom.value,` |
| 4 | draw.io's *classic* head: the filled `triangle` gets a notch in its back, a quarter of its length deep (`triangle_outline` stays) | `i.polygon([[s,d],[c,h],[u,b],[s,d]],` (in `case"triangle":case"triangle_outline":`) | `i.polygon(n==="triangle"?[[s,d],[c,h],[s+((c+u)/2-s)*.75,d+((h+b)/2-d)*.75],[u,b],[s,d]]:[[s,d],[c,h],[u,b],[s,d]],` |

The table shows the part that changes; `build/patch.py` holds each whole string it matches. What it fixes is the app's
look (`docs/design.md` §Canvases); the export to draw.io maps `triangle` to draw.io's `classic` for it (`drawio.js`).
