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
| `build/` | the entry and the Mermaid stub below |

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

Then copy `out/*` here, with `node_modules/@excalidraw/excalidraw/dist/prod/index.css` as `excalidraw.css` and its
`fonts/` without `Xiaolai/`.
