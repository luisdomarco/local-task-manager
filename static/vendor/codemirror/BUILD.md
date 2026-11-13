# CodeMirror 6 (MIT): how this folder was made

The Live editor (`static/js/livemd.js`) runs on CodeMirror 6, the editor Obsidian is built on. CodeMirror ships as
many ES modules that import each other by bare name (`@codemirror/state`…), so they cannot be served as they are.
`codemirror.js` is a **one-off build** of the part the app uses. It was made outside the repo and vendored as files,
like the rest of `static/vendor/`. The app itself still has no npm and no bundler.

| File | What |
|---|---|
| `codemirror.js` | everything `build/entry.js` exports: one ES module, no imports. It loads in Node too, which the tests rely on |
| `build/entry.js` | the entry: what is taken from each package |
| `LICENSE` | MIT. Every bundled package is MIT and by Marijn Haverbeke and others |

Versions: `@codemirror/state` 6.7.6, `view` 6.43.15, `commands` 6.11.1, `language` 6.13.1, `autocomplete` 6.20.4,
`@lezer/markdown` 1.8.1, `@lezer/highlight` 1.2.5, `@lezer/common` 1.5.5. They pull in `@lezer/lr`,
`@codemirror/streamparser`, `style-mod`, `crelt`, `w3c-keyname` and `@marijn/find-cluster-break`, all MIT. The build
used esbuild 0.28.2.

`@codemirror/lang-markdown` is **left out**. It imports `lang-html`, and through that `lang-css` and
`lang-javascript`. The app builds its Markdown language from `@lezer/markdown` (`livemd.js`). It keeps its own
list-continuing Enter, the one the Markdown mode already uses (`mdeditor.js`), so both modes behave alike.

To make it again (or for another version), in an empty folder outside the repo:

```bash
npm init -y
npm install @codemirror/state@6.7.6 @codemirror/view@6.43.15 @codemirror/commands@6.11.1 @codemirror/language@6.13.1 \
  @codemirror/autocomplete@6.20.4 @lezer/markdown@1.8.1 @lezer/highlight@1.2.5 @lezer/common esbuild@0.28.2
cp <repo>/static/vendor/codemirror/build/entry.js .
npx esbuild entry.js --bundle --format=esm --minify --target=es2020 --legal-comments=external --outfile=out/codemirror.js
```

Then copy `out/codemirror.js` here. After an update:

- run `TZ=UTC node --test tests/js/livemd*.test.mjs`. It checks, among other things, that a text goes in and comes
  out byte for byte, CRLF included;
- open a description and a doc in Live, on a computer and on a phone.
