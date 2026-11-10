# Basecoat 1.1.0 (MIT)

shadcn/ui's components as plain HTML classes, CSS and vanilla JS (https://basecoatui.com,
https://github.com/hunvreus/basecoat). Copied as files from the npm package `basecoat-css@1.1.0` (published
2026-10-23); the app has no npm at runtime and no bundler.

**What the page loads is not these files but `basecoat-nova.app.css`**, which `tools/basecoat_css.py` derives from
`basecoat-nova.cdn.min.css` (`css/main.css` imports it into the `vendor` layer):

- no Tailwind preflight: in its place, the few resets the adopted components assume;
- of the components, only the families the app has adopted (the script's `FAMILIES`: buttons and badges so far, one
  more per phase-3 PR of plans/design-system.md), their `data-variant` / `data-size` selectors rewritten onto the app's
  classes (`.btn.primary`, `.btn.small`, `.chip.on`…);
- no rule that sizes the icons in a button or a badge, and no `!important`.

Do not edit it: rerun `python3 tools/basecoat_css.py` (`--check` says whether it is current;
`tests/test_basecoat_css.py` fails when it is not). The whole files below are for `#/lab` and `?basecoat=1`
(plans/design-system-spike.md), and are the source of the derived one.

| File | From the package |
|---|---|
| `basecoat-nova.app.css` | not in the package: written by `tools/basecoat_css.py` (above) |
| `basecoat-nova.cdn.min.css`, `basecoat-mira.cdn.min.css` | `dist/basecoat-<style>.cdn.min.css`: Tailwind v4 output with the tokens and every component, in one of shadcn's styles |
| `basecoat-base.cdn.min.css` | `dist/basecoat-base.cdn.min.css`: the components with no style of their own |
| `js/basecoat.min.js` | `dist/js/basecoat.min.js`: the registry (`window.basecoat`) and the MutationObserver that initialises components |
| `js/<component>.min.js` | `dist/js/`: select, combobox, dropdown-menu, popover, tabs, toast, command, drawer |
| `LICENSE.md` | the package's licence |

What to know before using them (measured in the spike):

- The CSS declares Tailwind's own layers (`theme, base, components, utilities`) and Tailwind's preflight (a reset of
  `*`, headings, lists, buttons, `img`/`svg` display). Its `:root { --background … }` and `.dark { … }` token blocks are
  **not** in a layer: load the file with `@import url(…) layer(vendor)` so the app's tokens always win.
- The scripts are classic scripts (not modules). `basecoat.min.js` must come first; the components register with it.
  It initialises on `DOMContentLoaded`: loaded later, call `basecoat.initAll()` and `basecoat.start()` by hand.

To update: `npm pack basecoat-css@<version>` in an empty folder outside the repo, unpack it and copy the files above.
Then rerun `python3 tools/basecoat_css.py`, and compare Classic before and after (docs/design.md §5).
Check the list of styles (`dist/basecoat-*.cdn.min.css`: vega, nova, maia, lyra, mira, luma, rhea, sera in 1.1.0).
