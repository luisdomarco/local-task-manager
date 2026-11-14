// Settings → Themes: first the mode (light, dark or the system's: the only place it is chosen) and, in Modern, each
// mode's shade (themeprefs.js SHADES; the light's own colour checked against its text, `backgroundGuard`), then the
// look (Classic or Modern) and Modern's appearance: density, a preset or each option on its own (OPTIONS), beside a
// preview drawn with the app's own components; last, how Markdown reads (READING), in every look, over a sample. Each
// choice applies at once and is kept in this browser (theme.js, themeprefs.js): it is not config, so it has no Save.
import { setTheme, setThemes, themeNow } from '../theme.js';
import { OPTIONS, PRESETS, READING, backgroundGuard, hexColour, presetOf, presetValues, rgbOf, shuffled } from '../themeprefs.js';
import { h, icon, propRow, renderMarkdown, seg, statusChip } from '../ui.js';

const LOOKS = [
  ['modern', 'Modern', 'Larger text and controls, Radix colours, and an appearance of your own: colours, shape, fonts. The default.'],
  ['classic', 'Classic', 'The app as it first looked: compact, monochrome, 13.5px text.'],
];
const MODES = [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']];
const label = (s) => s[0].toUpperCase() + s.slice(1);
/** What a value is called where its plain name would not say it. */
const NAMES = {
  sidebar: { page: 'Like the page' },
  heading: { same: 'Same as text' },
  font: { system: 'System' },
};
/** Reading's rows, their values in the order they read (smaller to larger; READING keeps the default first).
 *  [key, row name, what it changes, values] */
const READ_ROWS = [
  ['textsize', 'Text size', 'The text of docs, descriptions and the editors, as a step of the page’s own.', ['small', 'default', 'large', 'larger']],
  ['leading', 'Line height', 'The space between a paragraph’s lines.', ['tight', 'default', 'loose']],
  ['paragraphs', 'Paragraphs', 'The space between one paragraph and the next.', ['compact', 'default', 'airy']],
  ['lists', 'Lists', 'The space around a list and between its items.', ['compact', 'default', 'airy']],
  ['width', 'Width', 'Fit keeps a doc in a centred column; Wide gives it the whole width.', ['fit', 'wide']],
];
const SAMPLE = `### A sample

Text reads as you set it here, in docs, an item's description and the editors.

A second paragraph, to show the space between two.

- A list item
- Another, with **bold** and \`code\`
  - and one under it`;
/** The light's colour first offered when none was picked: a warm paper. */
const PAPER = '#faf7f0';
/** What is drawn on the page, and its floor on a colour of one's own: [token, name, min]. */
const INKS = [
  ['--foreground', 'Text', 4.5],
  ['--muted-foreground', 'Secondary text', 4.5],
  ['--destructive', 'An error', 4.5],
  ['--input', 'A field’s outline', 3],
  ['--primary', 'The accent', 3],
];
/** A token's colour as [r, g, b] in sRGB, as the page paints it (a Radix display-p3 colour converted by a canvas). */
function painted(el, token) {
  const probe = h('span', { style: `color: var(${token})`, hidden: '' });
  el.append(probe);
  const css = getComputedStyle(probe).color;
  probe.remove();
  const direct = rgbOf(css);
  if (direct) return direct;
  const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
}
/** What would not read on `hex` with the theme the page shows now (light): [{ name, ratio, min }]. */
const unreadable = (el, hex) => backgroundGuard(rgbOf(hex), INKS.map(([token, name, min]) => ({ name, min, rgb: painted(el, token) })));
const sayUnreadable = (low) => `${low[0].name} would read at ${low[0].ratio.toFixed(1)}:1 on it (it needs ${low[0].min}:1)${low.length > 1 ? `, and ${low.length - 1} more` : ''}.`;
const nameOf = (key, value) => NAMES[key]?.[value] || label(value);
/** Modern's options as rows, in the order they read: colour, then shape and type. [key, row name, what it changes] */
const ROWS = [
  ['base', 'Base colour', 'The greys: every surface, line and secondary text.'],
  ['accent', 'Accent', 'Primary buttons, what is on or checked, focus.'],
  ['sidebar', 'Sidebar', 'The sidebar’s and the top bar’s background.'],
  ['canvas', 'Canvas', 'The background behind the lists, boards and pages.'],
  ['radius', 'Radius', 'The corners of buttons, fields, cards and menus.'],
  ['font', 'Font', 'The text’s typeface.'],
  ['heading', 'Headings', 'The titles’ typeface, an item’s title too.'],
  ['menu', 'Menus', 'Menus and ⌘K: solid, or see-through over what is under them.'],
  ['icons', 'Icons', 'The weight of the icons’ lines.'],
];
/** The font a font option's button shows its own name in. */
const FACES = {
  inter: '"Inter", sans-serif',
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'ui-serif, Charter, "Iowan Old Style", Georgia, serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
};

/** A row of buttons, one per [value, text, extra], the picked one pressed. */
function choice(aria, pairs, picked, pick, disabled = false) {
  return seg(pairs.map(([value, text, extra = {}]) => [value, text, {
    lead: extra.steps ? steps(value) : extra.dot ? h('span', { class: 'swatch-dot', 'data-sw': value, 'aria-hidden': 'true' }) : null,
    attrs: extra.style ? { style: extra.style } : {},
  }]), picked, pick, { aria, small: false, disabled });
}

/** A base's real steps (2, 4, 7, 9, 11 of its Radix scale, in the mode the page shows): a tint reads where one grey dot
 *  would look like the next. Its dot's colour where the scale is not on the page (Classic). */
const steps = (base) => h('span', { class: 'base-steps', 'data-sw': base, 'aria-hidden': 'true' },
  ...[2, 4, 7, 9, 11].map((n) => h('i', { style: `background: var(--${base}-${n}, var(--sw))` })));

/** The accents as round swatches: their name on hover and for a screen reader. */
function swatches(picked, pick, disabled) {
  return h('div', { class: 'swatches', role: 'group', 'aria-label': 'Accent' }, ...OPTIONS.accent.map((a) => h('button', {
    type: 'button', class: `swatch ${picked === a ? 'active' : ''}`, 'data-sw': a, title: label(a), 'aria-label': label(a),
    'aria-pressed': String(picked === a), disabled, onclick: () => pick(a),
  }, picked === a ? icon('check', 14) : null)));
}

/** The app's own components, drawn by whatever the page's theme is now: it changes with every choice. Not live. */
function preview() {
  const nav = (ico, text, on = false) => h('span', { class: `ap-nav ${on ? 'active' : ''}` }, icon(ico, 15), h('span', {}, text));
  const item = (ico, text) => h('span', { class: 'menu-item' }, icon(ico, 15), h('span', {}, text));
  return h('div', { class: 'ap-preview', 'aria-label': 'Preview', role: 'img', inert: '' },
    h('div', { class: 'ap-side' },
      h('span', { class: 'ap-brand' }, h('span', { class: 'logo' }, icon('check', 14)), 'Tasks'),
      nav('sun', 'Today', true), nav('kanban', 'Board'), nav('target', 'Goals'), nav('note', 'Docs')),
    h('div', { class: 'ap-canvas' },
      h('div', { class: 'ap-top' }, icon('pin', 13), h('span', { class: 'chip' }, 'Checkout redesign')),
      h('div', { class: 'ap-body' },
        h('h3', { class: 'ap-title' }, 'Checkout redesign'),
        h('p', { class: 'muted' }, 'A one-page checkout, due Friday.'),
        h('div', { class: 'progress' }, h('div', { style: 'width:60%' })),
        h('div', { class: 'ap-card' },
          h('div', { class: 'ap-row' }, h('span', { class: 'check on' }, icon('check', 12)), h('span', {}, 'Map the current steps')),
          h('div', { class: 'ap-chips' }, statusChip('In progress'), h('span', { class: 'chip on' }, 'Today'),
            h('span', { class: 'chip late' }, '2d late'), h('span', { class: 'chip' }, 'Design'))),
        h('div', { class: 'ap-row' }, h('button', { type: 'button', class: 'btn primary small' }, 'Save'),
          h('button', { type: 'button', class: 'btn small' }, 'Cancel'),
          h('button', { type: 'button', class: 'btn icon small', 'aria-label': 'More' }, icon('more', 15))),
        h('div', { class: 'menu ap-menu' }, item('pencil', 'Rename'), item('copy', 'Duplicate'), h('div', { class: 'menu-sep' }),
          h('span', { class: 'menu-item danger' }, icon('trash', 15), h('span', {}, 'Delete'))))));
}

/** Reading: its rows, then a sample drawn as Markdown reads now, and Reset. In every look. */
function readingSection(t, row) {
  const defaults = Object.fromEntries(Object.entries(READING).map(([k, list]) => [k, list[0]]));
  const changed = Object.keys(READING).some((k) => t[k] !== defaults[k]);
  const sample = h('div', { class: 'md' });
  sample.innerHTML = renderMarkdown(SAMPLE); // sanitized by renderMarkdown, a fixed text of this file
  return h('section', { class: 'group ap-reading' },
    h('header', { class: 'ap-head' }, h('h3', {}, 'Reading'),
      h('button', { type: 'button', class: 'btn small ghost', disabled: !changed, onclick: () => setThemes(defaults) }, icon('reset', 14), 'Reset')),
    h('p', { class: 'muted' }, 'How Markdown reads — docs, descriptions, the editors — in both looks. Kept in this browser.'),
    h('div', { class: 'ap-layout' },
      h('div', { class: 'fields prop-rows' },
        ...READ_ROWS.map(([key, name, about, values]) => row(name, about,
          choice(name, values.map((v) => [v, label(v)]), t[key], (v) => setTheme(key, v))))),
      h('div', { class: 'ap-sample', 'aria-label': 'Sample', role: 'img', inert: '' }, sample)));
}

/** → { el }: re-drawn whenever a choice changes, here or anywhere else (another tab of the app). */
export function themesPanel() {
  const el = h('div', { class: 'themes-panel' });

  const render = () => {
    const t = themeNow();
    const modern = t.skin === 'modern';
    const off = !modern;
    const row = (name, about, control) => propRow(name,
      h('div', { class: 'ap-control' }, control, about ? h('span', { class: 'muted small' }, about) : null), { tag: 'div' });
    const preset = presetOf(t);
    const control = (key) => {
      if (key === 'accent') return swatches(t.accent, (v) => setTheme('accent', v), off);
      const pairs = OPTIONS[key].map((v) => [v, nameOf(key, v), {
        steps: key === 'base',
        style: (key === 'font' || key === 'heading') && FACES[v] ? `font-family:${FACES[v]}` : null,
      }]);
      return choice(ROWS.find((r) => r[0] === key)[1], pairs, t[key], (v) => setTheme(key, v), off);
    };
    el.replaceChildren(
      h('section', { class: 'group' },
        h('header', {}, h('h3', {}, 'Mode')),
        h('div', { class: 'fields prop-rows' },
          row('Mode', 'System follows your computer’s or phone’s light and dark.', choice('Mode', MODES, t.mode, (v) => setTheme('mode', v))),
          row('Light', off ? 'Modern’s: Classic keeps its own light.' : 'Bright: a white page. Soft: a grey page, white cards on it. Custom: a colour of your own.',
            lightControl(t, off)),
          row('Dark', off ? 'Modern’s: Classic keeps its own dark.' : 'Deep: near black. Dim: a step lighter, softer on the eyes.',
            choice('Dark', [['deep', 'Deep'], ['dim', 'Dim']], t.dark, (v) => setTheme('dark', v), off)))),
      h('section', { class: 'group' },
        h('header', {}, h('h3', {}, 'Theme')),
        h('p', { class: 'muted' }, 'How the app looks in this browser. It changes at once and is kept here, not in the app’s settings.'),
        h('div', { class: 'theme-cards', role: 'group', 'aria-label': 'Theme' }, ...LOOKS.map(([skin, name, about]) => h('button', {
          type: 'button', class: `theme-card ${t.skin === skin ? 'active' : ''}`, 'aria-pressed': String(t.skin === skin),
          onclick: () => setTheme('skin', skin),
        },
        h('span', { class: 'tc-preview', 'data-look': skin, 'aria-hidden': 'true' },
          ...['light', 'dark'].map((m) => h('span', { class: `tc-half ${m}` }, h('i', { class: 'tc-side' }),
            h('span', { class: 'tc-lines' }, h('i', {}), h('i', {}), h('i', { class: 'tc-accent' }))))),
        h('span', { class: 'tc-name' }, name),
        h('span', { class: 'tc-about muted' }, about))))),
      h('section', { class: 'group' },
        h('header', {}, h('h3', {}, 'Appearance')),
        h('div', { class: 'fields prop-rows' },
          row('Density', null, choice('Density', OPTIONS.density.map((d) => [d, label(d)]), t.density, (v) => setTheme('density', v), off)))),
      h('section', { class: 'group ap-look' },
        h('header', {}, h('h3', {}, 'Look')),
        off ? h('p', { class: 'muted' }, 'The look is Modern’s: choose Modern above to change it. Classic keeps its own.') : null,
        h('div', { class: 'ap-layout' },
          h('div', { class: 'fields prop-rows' },
            row('Preset', preset || off ? null : 'Your own: no preset has these choices.', h('div', { class: 'ap-presets' },
              choice('Preset', Object.keys(PRESETS).map((p) => [p, label(p)]), preset, (p) => setThemes(presetValues(p)), off),
              h('div', { class: 'ap-preset-actions' },
                h('button', { type: 'button', class: 'btn small', disabled: off, onclick: () => setThemes(shuffled()) }, icon('sparkles', 14), 'Shuffle'),
                h('button', { type: 'button', class: 'btn small ghost', disabled: off || preset === 'modern', onclick: () => setThemes(presetValues('modern')) },
                  icon('reset', 14), 'Reset')))),
            ...ROWS.map(([key, name, about]) => row(name, about, control(key)))),
          off ? null : preview())), // in Classic it would draw Classic, not the look these choices make
      readingSection(t, row),
    );
  };

  /** The light's shade: Bright · Soft · Custom, and Custom's colour. A colour is checked against the light's text
   *  before it is used, so it is picked with the page light; one kept that a later base or accent no longer reads
   *  on is said under it. */
  const lightControl = (t, off) => {
    const note = h('span', { class: 'ap-guard', role: 'status' });
    const lightNow = t.theme === 'light';
    const use = (hex) => {
      const low = unreadable(el, hex);
      if (low.length) { note.textContent = `Not used: ${sayUnreadable(low)} Pick a lighter one.`; note.classList.add('bad'); return; }
      setThemes({ lightbg: hex, light: 'custom' });
    };
    const picker = h('input', {
      type: 'color', value: t.lightbg || PAPER, disabled: off || !lightNow, 'aria-label': 'Custom light colour',
      title: lightNow ? 'Your own page colour' : 'Switch the mode to Light to pick it: it is checked against the light’s text',
      onchange: (e) => { const hex = hexColour(e.target.value); if (hex) use(hex); },
    });
    const pick = (v) => {
      if (v !== 'custom') return setTheme('light', v);
      if (t.lightbg && lightNow) return use(t.lightbg);
      if (t.lightbg) return setTheme('light', 'custom'); // checked when it was picked
      if (lightNow) { try { picker.showPicker(); } catch { picker.click(); } } else {
        note.textContent = 'Switch the mode to Light first: a colour is checked against the light’s text.';
      }
      return null;
    };
    if (!off && lightNow && t.light === 'custom' && t.lightbg) {
      const low = unreadable(el, t.lightbg);
      if (low.length) { note.textContent = `${sayUnreadable(low)} Pick a lighter colour, or Bright.`; note.classList.add('bad'); }
    }
    return h('div', { class: 'ap-shade' },
      choice('Light', [['bright', 'Bright'], ['soft', 'Soft'], ['custom', 'Custom']], t.light, pick, off),
      h('label', { class: `ap-colour ${t.light === 'custom' ? 'on' : ''}` }, picker, h('span', {}, t.lightbg || 'Colour')),
      note);
  };
  // Settings builds its tabs again on a reload: a panel no longer on the page stops listening.
  const onChange = () => { if (el.isConnected) render(); else window.removeEventListener('tm:themeprefs', onChange); };
  window.addEventListener('tm:themeprefs', onChange);
  render();
  return { el };
}
