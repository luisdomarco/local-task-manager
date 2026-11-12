// Settings → Themes: first the mode (light, dark or the system's: the only place it is chosen), then the look (Classic
// or Modern) and Modern's appearance: density, a preset or each option on its own (themeprefs.js OPTIONS), beside a
// preview drawn with the app's own components. Each choice applies at once and is kept in this browser (theme.js,
// themeprefs.js): it is not config, so it has no Save.
import { setTheme, setThemes, themeNow } from '../theme.js';
import { OPTIONS, PRESETS, presetOf, presetValues, shuffled } from '../themeprefs.js';
import { h, icon, propRow, seg, statusChip } from '../ui.js';

const LOOKS = [
  ['classic', 'Classic', 'The app as it has always looked: compact, monochrome, 13.5px text.'],
  ['modern', 'Modern', 'Larger text and controls, Radix colours, and an appearance of your own: colours, shape, fonts.'],
];
const MODES = [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']];
const label = (s) => s[0].toUpperCase() + s.slice(1);
/** What a value is called where its plain name would not say it. */
const NAMES = {
  sidebar: { page: 'Like the page' },
  heading: { same: 'Same as text' },
  font: { system: 'System' },
};
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
    lead: extra.dot ? h('span', { class: 'swatch-dot', 'data-sw': value, 'aria-hidden': 'true' }) : null,
    attrs: extra.style ? { style: extra.style } : {},
  }]), picked, pick, { aria, small: false, disabled });
}

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
        dot: key === 'base',
        style: (key === 'font' || key === 'heading') && FACES[v] ? `font-family:${FACES[v]}` : null,
      }]);
      return choice(ROWS.find((r) => r[0] === key)[1], pairs, t[key], (v) => setTheme(key, v), off);
    };
    el.replaceChildren(
      h('section', { class: 'group' },
        h('header', {}, h('h3', {}, 'Mode')),
        h('div', { class: 'fields prop-rows' },
          row('Mode', 'System follows your computer’s or phone’s light and dark.', choice('Mode', MODES, t.mode, (v) => setTheme('mode', v))))),
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
    );
  };
  // Settings builds its tabs again on a reload: a panel no longer on the page stops listening.
  const onChange = () => { if (el.isConnected) render(); else window.removeEventListener('tm:themeprefs', onChange); };
  window.addEventListener('tm:themeprefs', onChange);
  render();
  return { el };
}
