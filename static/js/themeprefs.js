// What the theme preferences mean, with no page behind them (tests/js/themeprefs.test.mjs). Each choice is kept in
// localStorage (a per-browser convenience, never config): the look (Classic or Modern), the mode (light, dark or the
// system's), how Markdown reads (READING, in every look), and, for Modern only, each mode's shade (SHADES) and its appearance (OPTIONS: density, accent, base colour, radius, the bars' and the
// canvas' backgrounds, the fonts, the menus, the icons). theme.js applies them to the page; index.html's first script
// applies the same before the first paint, in a few lines of its own that the test runs against these.

export const MODES = ['light', 'dark', 'system'];
/** The looks, the first the default: Modern (comfortable, its first density), unless Classic was chosen. */
export const SKINS = ['modern', 'classic'];
export const DENSITIES = ['comfortable', 'compact'];
/** Radix scales that hold a filled control at 3:1 on every base, light and dark, with text on it at 4.5:1
 *  (tests/js/contrast.test.mjs; css/themes/modern.css picks the step), and `mono`: no colour, the base's ink. Red is
 *  left out: it says an error. */
export const ACCENTS = ['indigo', 'iris', 'violet', 'purple', 'plum', 'pink', 'crimson', 'ruby', 'tomato', 'orange',
  'amber', 'bronze', 'grass', 'green', 'jade', 'teal', 'cyan', 'blue', 'mono'];
/** Radix's greys: every surface, border and secondary text. */
export const BASES = ['gray', 'mauve', 'slate', 'sage', 'olive', 'sand'];

/** Modern's appearance, the first of each list its default. Each is a `data-<key>` on the root (css/themes/modern.css)
 *  and a `tm-<key>` in localStorage. */
export const OPTIONS = {
  density: DENSITIES,
  accent: ACCENTS,
  base: BASES,
  radius: ['default', 'none', 'small', 'large'],
  sidebar: ['grey', 'page', 'tinted'], // the sidebar's and the top bar's background
  canvas: ['plain', 'tinted', 'gradient'], // the main column's background
  font: ['inter', 'system', 'serif', 'mono'],
  heading: ['same', 'inter', 'system', 'serif', 'mono'], // the headings' font: `same` as the text's
  menu: ['solid', 'translucent'], // menus, the palette, popovers
  icons: ['regular', 'thin', 'bold'], // the icons' stroke
};

/** How Markdown reads (Docs, descriptions, the editors), in every look, Classic too: the first of each list its
 *  default. A `data-<key>` on the root (app.css) and a `tm-<key>` in localStorage, as OPTIONS. */
export const READING = {
  width: ['fit', 'wide'], // the text in a centred column (--read-max), or the whole width
  textsize: ['default', 'small', 'large', 'larger'], // --md-k: the text's size, times the place's own
  leading: ['default', 'tight', 'loose'], // --md-lh: the line height
  paragraphs: ['default', 'compact', 'airy'], // --md-gap: the space between paragraphs
  lists: ['default', 'compact', 'airy'], // --md-list-gap, --md-li: around a list and between its items
};

/** Modern's shade of each mode, the first its default: the light's page Bright, Soft (a grey page, white cards) or a
 *  colour of one's own (`lightbg`, a #rrggbb kept in tm-lightbg: refused by the panel when text would not read on it,
 *  `backgroundGuard`); the dark's Deep (near black) or Dim (a step lighter). A `data-<key>` on the root, as OPTIONS,
 *  but not part of a preset or Shuffle: like the density, how bright a page sits is not a look. */
export const SHADES = { light: ['bright', 'soft', 'custom'], dark: ['deep', 'dim'] };

/** Every key that is a list of values: Modern's (OPTIONS, SHADES) and the reading's (READING). */
const LISTED = [...Object.keys(OPTIONS), ...Object.keys(SHADES), ...Object.keys(READING)];
export const KEYS = { mode: 'tm-theme', skin: 'tm-skin', ...Object.fromEntries([...LISTED, 'lightbg'].map((k) => [k, `tm-${k}`])) };
/** The root's attributes a theme change touches: what a drawing in the theme's colours watches (MutationObserver). */
export const THEME_ATTRS = ['data-theme', 'data-skin', ...[...LISTED, 'lightbg'].map((k) => `data-${k}`)];

/** Named sets of Modern's appearance (Settings → Themes → Presets); what a preset leaves out stays its default. */
export const PRESETS = {
  modern: {},
  ink: { accent: 'mono', radius: 'small', font: 'system' },
  paper: { accent: 'bronze', base: 'sand', radius: 'small', sidebar: 'page', heading: 'serif', icons: 'thin' },
  ocean: { accent: 'cyan', base: 'slate', radius: 'large', sidebar: 'tinted', canvas: 'gradient', font: 'system', menu: 'translucent' },
  grape: { accent: 'violet', base: 'mauve', radius: 'large', sidebar: 'tinted', canvas: 'gradient', menu: 'translucent' },
  forest: { accent: 'grass', base: 'sage', sidebar: 'tinted', canvas: 'tinted', heading: 'serif' },
  terminal: { accent: 'green', base: 'olive', radius: 'none', sidebar: 'page', font: 'mono', icons: 'bold' },
};
/** What a preset sets: every option but the density (how much fits is not a look). */
const LOOK = Object.entries(OPTIONS).filter(([k]) => k !== 'density');
/** A preset's whole appearance: every option it sets, its own value or the default. */
export const presetValues = (name) => Object.fromEntries(LOOK.map(([k, list]) => [k, PRESETS[name]?.[k] ?? list[0]]));
/** The preset the appearance `t` is, or null: a choice of one's own. */
export const presetOf = (t) => Object.keys(PRESETS).find((p) => Object.entries(presetValues(p)).every(([k, v]) => t[k] === v)) || null;
/** A random appearance (Shuffle): one of each option but the density. `random` is Math.random's shape. */
export const shuffled = (random = Math.random) => Object.fromEntries(LOOK.map(([k, list]) => [k, list[Math.floor(random() * list.length)]]));

const one = (value, list, fallback = list[0]) => (list.includes(value) ? value : fallback);
/** A colour as the page keeps it, `#rrggbb` lower case, or null. */
export const hexColour = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : null);

/**
 * The stored values (raw strings, or null) and whether the system is dark → what the page shows: `theme` is always
 * light or dark ("system" resolved), and every option of OPTIONS is null in Classic, which has none of them.
 */
export function resolveTheme(stored = {}, systemDark = false) {
  const mode = one(stored.mode, MODES, 'system');
  const skin = one(stored.skin, SKINS);
  const modern = skin === 'modern';
  return {
    mode,
    theme: mode === 'system' ? (systemDark ? 'dark' : 'light') : mode,
    skin,
    ...Object.fromEntries(Object.entries(OPTIONS).map(([k, list]) => [k, modern ? one(stored[k], list) : null])),
    ...shades(stored, modern),
    ...Object.fromEntries(Object.entries(READING).map(([k, list]) => [k, one(stored[k], list)])),
  };
}

/** The shades (SHADES) and the light's own colour: none in Classic; Custom with no colour kept is Bright. */
function shades(stored, modern) {
  if (!modern) return { light: null, dark: null, lightbg: null };
  const lightbg = hexColour(stored.lightbg);
  const light = one(stored.light, SHADES.light);
  return { light: light === 'custom' && !lightbg ? 'bright' : light, dark: one(stored.dark, SHADES.dark), lightbg };
}

const shownNow = (root) => [root.dataset.theme, root.dataset.skin, ...[...LISTED, 'lightbg'].map((k) => root.dataset[k]),
  root.classList.contains('dark')].join();

/**
 * A resolved theme onto the page's root element: data-theme (light or dark), the `.dark` class (Basecoat's and the
 * Radix scales' dark switch), data-skin, and Modern's options as data-<option> (none in Classic). → whether anything
 * changed.
 */
export function applyTheme(root, t) {
  const before = shownNow(root);
  root.dataset.theme = t.theme;
  root.classList.toggle('dark', t.theme === 'dark');
  root.dataset.skin = t.skin;
  for (const key of [...LISTED, 'lightbg']) {
    if (t[key]) root.dataset[key] = t[key];
    else delete root.dataset[key];
  }
  // the light's own colour as a token (css/themes/modern.css reads it under data-light="custom")
  if (t.lightbg) root.style.setProperty('--custom-bg', t.lightbg);
  else root.style.removeProperty('--custom-bg');
  return before !== shownNow(root);
}

/** A colour as [r, g, b] (0–255): `#rgb`, `#rrggbb` or `rgb(r, g, b)`; null for anything else. */
export function rgbOf(v) {
  v = String(v || '').trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{6})$/);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = v.match(/^#([0-9a-f]{3})$/);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = v.match(/^rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/);
  return m ? m.slice(1, 4).map(Number) : null;
}
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG's contrast ratio of two [r, g, b], 1 to 21. */
export const contrastRatio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/**
 * Whether a page colour of one's own keeps the theme readable: `bg` a [r, g, b], `inks` [{ name, rgb, min }] what is
 * drawn on the page (text at 4.5:1, a field's outline and the accent at 3:1). → the inks that fall under their floor,
 * [{ name, ratio, min }], worst first: none means the colour can be used.
 */
export function backgroundGuard(bg, inks) {
  return inks.map(({ name, rgb, min }) => ({ name, ratio: contrastRatio(rgb, bg), min }))
    .filter((r) => r.ratio < r.min).sort((a, b) => a.ratio / a.min - b.ratio / b.min);
}
