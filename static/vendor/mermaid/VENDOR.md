# Mermaid 11.17.2 (MIT)

Diagrams written as text in a ```` ```mermaid ```` fence — flowcharts, sequence, state, class, ER, Gantt… — drawn as
SVG (https://github.com/mermaid-js/mermaid). `mermaid.min.js` is `dist/mermaid.min.js` of the npm package
`mermaid@11.17.2` (tarball `sha512-V6K3C8EBdEsPFZXSKMJe6ppQOENxuHARr9GvHX4hh47lAbhMRD9qf4oEK7LoaRQxULMa80/qt5gHO73aCleBBg==`),
served as it is: one classic script that sets `globalThis.mermaid`.

About 3.5 MB, so it is loaded only when a Markdown view holds a diagram (`static/js/diagrams.js`), never with the page.

To update: `npm pack mermaid@<version>` in an empty folder outside the repo and copy `dist/mermaid.min.js` and
`LICENSE` here; update the version and the tarball's integrity above.
