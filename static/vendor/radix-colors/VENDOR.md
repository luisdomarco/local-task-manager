# Radix Colors 3.0.0 (MIT)

12-step colour scales with fixed roles (1–2 backgrounds, 3–5 component fills, 6–8 borders, 9–10 solid, 11–12 text),
each with a dark pair (https://www.radix-ui.com/colors). The `<hue>.css` and `<hue>-dark.css` files of the npm
package `@radix-ui/colors@3.0.0`, all hues, **without the alpha scales**.

`<hue>.css` sets `--<hue>-1…12` on `:root, .light, .light-theme`; `<hue>-dark.css` on `.dark, .dark-theme`. Each also
carries a Display P3 version under `@media (color-gamut: p3)`.

**Design-system spike only** (`#/lab`): nothing outside the lab loads them yet.

To update: `npm pack @radix-ui/colors@<version>` in an empty folder outside the repo and copy every `*.css` that is not
`*-alpha.css`, and `LICENSE`.
