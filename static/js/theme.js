// The page's theme (themeprefs.js says what the choices mean): applied at start, again when a choice changes
// (Settings → Themes, another tab of the app) or the system turns dark or light. Whoever draws
// with the theme's colours (the graph, a canvas) watches the root's THEME_ATTRS, or listens for `tm:themechange` on
// window.
import { KEYS, applyTheme, resolveTheme } from './themeprefs.js';

const system = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : { matches: false };
const memory = {}; // what was chosen when localStorage cannot keep it (private mode): it still holds for this page

const stored = () => Object.fromEntries(Object.entries(KEYS).map(([k, key]) => {
  let v = null;
  try { v = localStorage.getItem(key); } catch { /* unreadable: the default */ }
  return [k, memory[k] ?? v];
}));

let current = resolveTheme();
/** The theme the page shows now: { mode, theme (light | dark), skin, density, accent }. */
export const themeNow = () => current;

/** A theme other than Classic has a stylesheet of its own (css/themes/<id>.css, in the `themes` layer), on the page
 *  only once it is chosen; index.html writes it in before the first paint when it is already the one. */
function themeCss(skin) {
  if (skin === 'classic' || document.querySelector(`link[data-theme-css="${skin}"]`)) return;
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `css/themes/${skin}.css` });
  link.dataset.themeCss = skin;
  document.head.append(link);
}

function apply() {
  current = resolveTheme(stored(), system.matches);
  themeCss(current.skin);
  if (applyTheme(document.documentElement, current)) window.dispatchEvent(new CustomEvent('tm:themechange', { detail: current }));
}

/** Several choices ({ key: value }, keys of themeprefs.js KEYS) kept and applied at once: a preset, Shuffle. */
export function setThemes(values) {
  for (const [key, value] of Object.entries(values)) {
    memory[key] = value;
    try { localStorage.setItem(KEYS[key], value); delete memory[key]; } catch { /* kept in memory for this page */ }
  }
  apply();
  window.dispatchEvent(new CustomEvent('tm:themeprefs', { detail: current }));
}

/** One choice (mode, skin, or one of Modern's options) kept and applied; the page changes at once. */
export const setTheme = (key, value) => setThemes({ [key]: value });

export function initTheme() {
  apply();
  system.addEventListener?.('change', apply);
  // Another tab of the app chose: follow it.
  window.addEventListener('storage', (e) => {
    if (!Object.values(KEYS).includes(e.key)) return;
    apply();
    window.dispatchEvent(new CustomEvent('tm:themeprefs', { detail: current }));
  });
}
