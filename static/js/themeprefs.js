// What the theme preferences mean, with no page behind them (tests/js/themeprefs.test.mjs). Each choice is kept in
// localStorage (a per-browser convenience, never config): the look (Classic or Modern), the mode (light, dark or the
// system's), and, for Modern only, its appearance (OPTIONS: density, accent, base colour, radius, the bars' and the
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
};

export const KEYS = { mode: 'tm-theme', skin: 'tm-skin', ...Object.fromEntries([...Object.keys(OPTIONS), ...Object.keys(READING)].map((k) => [k, `tm-${k}`])) };
/** The root's attributes a theme change touches: what a drawing in the theme's colours watches (MutationObserver). */
export const THEME_ATTRS = ['data-theme', 'data-skin', ...[...Object.keys(OPTIONS), ...Object.keys(READING)].map((k) => `data-${k}`)];

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
    ...Object.fromEntries(Object.entries(READING).map(([k, list]) => [k, one(stored[k], list)])),
  };
}

const shownNow = (root) => [root.dataset.theme, root.dataset.skin, ...[...Object.keys(OPTIONS), ...Object.keys(READING)].map((k) => root.dataset[k]),
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
  for (const key of [...Object.keys(OPTIONS), ...Object.keys(READING)]) {
    if (t[key]) root.dataset[key] = t[key];
    else delete root.dataset[key];
  }
  return before !== shownNow(root);
}
