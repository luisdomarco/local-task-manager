// Every theme's colour pairs, read from its token files as the browser would resolve them: text ≥ 4.5:1, what makes a
// control or an icon out ≥ 3:1 (WCAG 1.4.3, 1.4.11; docs/design.md §2). Classic is app.css's :root and its dark block;
// Modern is the Radix scales, then app.css (what Modern does not redefine stays Classic's), then css/themes/modern.css
// with every base, accent, sidebar and canvas of its appearance (themeprefs.js OPTIONS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCENTS, BASES, OPTIONS } from '../../static/js/themeprefs.js';

const read = (path) => readFileSync(new URL(`../../static/${path}`, import.meta.url), 'utf8');

/** The rule blocks of a stylesheet, flattened out of @layer / @media: [{ selector, decls: { --name: value } }]. */
function blocks(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const walk = (text) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const selector = text.slice(i, open).replace(/^[\s\S]*;/, '').trim();
      let depth = 1; let j = open + 1;
      for (; j < text.length && depth; j++) depth += text[j] === '{' ? 1 : text[j] === '}' ? -1 : 0;
      const inner = text.slice(open + 1, j - 1);
      // into @layer; not into @supports / @media (Radix's display-p3 copies of the same colours)
      if (selector.startsWith('@layer')) walk(inner);
      else if (selector.startsWith('@')) { /* skipped */ }
      else {
        const decls = {};
        // split on ; outside quotes and parentheses (data: URLs)
        let part = ''; let q = null; let paren = 0;
        for (const ch of `${inner};`) {
          if (q) { if (ch === q) q = null; } else if (ch === '"' || ch === "'") q = ch;
          else if (ch === '(') paren++; else if (ch === ')') paren--;
          if (ch === ';' && !q && !paren) {
            const m = part.match(/^\s*(--[\w-]+)\s*:\s*([\s\S]*?)\s*$/);
            if (m) decls[m[1]] = m[2];
            part = '';
          } else part += ch;
        }
        out.push({ selector, decls });
      }
      i = j;
    }
  };
  walk(css);
  return out;
}

/** The tokens of the blocks whose selector is one of `selectors`, later ones winning. */
function tokens(sheets, selectors) {
  const t = {};
  for (const css of sheets) for (const b of blocks(css)) if (selectors.includes(b.selector)) Object.assign(t, b.decls);
  return t;
}

const app = read('css/app.css');
const modern = read('css/themes/modern.css');
const radix = [...modern.matchAll(/@import url\("\.\.\/\.\.\/(vendor\/radix-colors\/[\w-]+\.css)"\)/g)].map((m) => read(m[1]));
const CLASSIC_ROOT = [':root'];
const CLASSIC_DARK = [':root[data-theme="dark"], #termdock:not(.td-light) .td-term'];
const RADIX_LIGHT = [':root, .light, .light-theme'];
const RADIX_DARK = ['.dark, .dark-theme'];
const MODERN = [':root[data-skin="modern"]'];
const MODERN_DARK = [':root[data-skin="modern"].dark'];
const opt = (key, value) => `:root[data-skin="modern"][data-${key}="${value}"]`;

const THEMES = {
  'Classic light': tokens([app], CLASSIC_ROOT),
  'Classic dark': tokens([app], [...CLASSIC_ROOT, ...CLASSIC_DARK]),
};
/** Modern with one appearance, `look` a value per option ({ base, accent, sidebar, canvas }), in light or dark. The
 *  rules are taken in the file's order, as the browser's cascade does for selectors of the same weight (the accent's
 *  dark rule weighs more and comes later). */
function modernTheme(look, dark) {
  const sels = [...MODERN, ...(dark ? MODERN_DARK : []), ...Object.entries(look).map(([k, v]) => opt(k, v))];
  if (dark) sels.push(`${opt('accent', look.accent)}.dark`);
  return {
    ...tokens(radix, RADIX_LIGHT), ...(dark ? tokens(radix, RADIX_DARK) : {}),
    ...tokens([app], dark ? [...CLASSIC_ROOT, ...CLASSIC_DARK] : CLASSIC_ROOT), ...tokens([modern], sels),
  };
}
/** Every Modern that is checked: per base and mode, each accent with each sidebar and canvas. */
const MODERNS = {};
for (const base of BASES) {
  for (const dark of [false, true]) {
    const group = MODERNS[`Modern ${dark ? 'dark' : 'light'}, ${base}`] = {};
    for (const accent of ACCENTS) {
      for (const sidebar of OPTIONS.sidebar) {
        for (const canvas of OPTIONS.canvas) group[`${accent}, sidebar ${sidebar}, canvas ${canvas}`] = modernTheme({ base, accent, sidebar, canvas }, dark);
      }
    }
  }
}

/** A token's colour as [r, g, b] (0–255), its var() chain followed; null when it is not a solid colour. */
function colour(t, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`${name}: a var() loop`);
  seen.add(name);
  let v = t[name];
  if (v === undefined) throw new Error(`${name}: not defined`);
  v = v.trim();
  const ref = v.match(/^var\((--[\w-]+)(?:,\s*([^)]+))?\)$/);
  if (ref) return t[ref[1]] !== undefined ? colour(t, ref[1], seen) : parse(ref[2]);
  // color-mix(in srgb, var(--a) p%, var(--b)): the two mixed channel by channel, as the browser does in srgb
  const mix = v.match(/^color-mix\(in srgb,\s*var\((--[\w-]+)\)\s+([\d.]+)%,\s*var\((--[\w-]+)\)\)$/);
  if (mix) {
    const a = colour(t, mix[1], new Set(seen)); const b = colour(t, mix[3], new Set(seen)); const p = Number(mix[2]) / 100;
    return a && b ? a.map((c, i) => Math.round(c * p + b[i] * (1 - p))) : null;
  }
  return parse(v);
}
function parse(v) {
  v = (v || '').trim().toLowerCase();
  if (v === '#fff' || v === 'white') return [255, 255, 255];
  let m = v.match(/^#([0-9a-f]{6})$/);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = v.match(/^#([0-9a-f]{3})$/);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = v.match(/^rgb\((\d+)[ ,]+(\d+)[ ,]+(\d+)\)$/);
  if (m) return m.slice(1, 4).map(Number);
  return null;
}
const lum = (rgb) => {
  const [r, g, b] = rgb.map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const STATUSES = ['backlog', 'todo', 'onhold', 'blocked', 'inprogress', 'review', 'done', 'discarded'];
const TYPES = Object.keys(THEMES['Classic light']).filter((k) => k.startsWith('--t-')).map((k) => k.slice(4));
const SURFACES = ['--background', '--card', '--popover'];
const pairs = (fgs, bgs, min, why) => fgs.flatMap((fg) => bgs.map((bg) => ({ fg, bg, min, why })));

/** [{ fg, bg, min, why }]: what is checked, in every theme. */
const CHECKS = [
  ...pairs(['--foreground'], [...SURFACES, '--muted', '--accent', '--sidebar', '--sidebar-hover', '--well'], 4.5, 'text'),
  ...pairs(['--muted-foreground'], [...SURFACES, '--muted', '--sidebar', '--well'], 4.5, 'secondary text'),
  { fg: '--primary-foreground', bg: '--primary', min: 4.5, why: 'a primary button' },
  ...pairs(['--destructive'], SURFACES, 4.5, 'an error, overdue, a danger button'),
  ...STATUSES.map((k) => ({ fg: `--st-${k}-fg`, bg: `--st-${k}-bg`, min: 4.5, why: 'a status pill' })),
  ...pairs(['--pr-ink-1', '--pr-ink-2', '--pr-ink-3', '--pr-ink-4'], SURFACES, 4.5, "a priority's name"),
  ...pairs(['--hl-keyword', '--hl-string', '--hl-number', '--hl-title', '--hl-comment', '--hl-type', '--hl-tag'], SURFACES, 4.5, 'highlighted code (Files, the Markdown editor)'),
  ...pairs(['--graph-label'], ['--background'], 4.5, "a graph node's name"),
  ...pairs(['--input', '--focus', '--field-ring'], SURFACES, 3, "a field's outline, focus"),
  ...pairs(TYPES.map((t) => `--t-${t}`), SURFACES, 3, "a type's icon"),
  ...pairs(['--graph-node', '--graph-accent'], ['--background'], 3, 'a graph node'),
];

/** Modern's own, on top of CHECKS: the accent as a filled control and as text, and the gradient canvas' tints. */
const MODERN_CHECKS = [
  ...CHECKS,
  ...pairs(['--primary'], SURFACES, 3, 'a filled control: a primary button, a checked box, an "on" chip'),
  ...pairs(['--brand-text'], SURFACES, 4.5, 'the accent as text (a tentative entry)'),
  ...pairs(['--foreground', '--muted-foreground'], ['--brand-4', '--brand-3'], 4.5, 'text on the gradient canvas'),
];

// Classic's pairs that were already under the floor before the themes, kept as they are (Classic does not change):
// each one listed, so a new one fails.
const KNOWN = new Set([
  'Classic dark: --input on --card', // 2.97:1, a field on a card in dark: a hair under, as it always was
]);

/** The pairs of `t` under their floor, as lines; `theme` names it for KNOWN. */
function under(theme, t, checks) {
  const low = [];
  for (const { fg, bg, min, why } of checks) {
    const a = colour(t, fg); const b = colour(t, bg);
    assert.ok(a && b, `${theme}: ${fg} on ${bg} is not a solid colour (${t[fg]} on ${t[bg]})`);
    const r = ratio(a, b);
    if (r < min && !KNOWN.has(`${theme}: ${fg} on ${bg}`)) low.push(`${theme}: ${fg} on ${bg}: ${r.toFixed(2)} < ${min} (${why})`);
  }
  return low;
}

for (const [theme, t] of Object.entries(THEMES)) {
  test(`${theme}: every pair reaches its contrast floor`, () => {
    const low = under(theme, t, CHECKS);
    assert.deepEqual(low, [], low.join('\n  '));
  });
}
for (const [group, looks] of Object.entries(MODERNS)) {
  test(`${group}: every accent, sidebar and canvas reaches its contrast floors`, () => {
    const low = Object.entries(looks).flatMap(([look, t]) => under(`${group}, ${look}`, t, MODERN_CHECKS));
    assert.deepEqual(low, [], `${low.length} pairs:\n  ${low.slice(0, 40).join('\n  ')}`);
  });
}

test('every known exception still exists (one fixed comes off the list)', () => {
  for (const key of KNOWN) {
    const [theme, pair] = key.split(': ');
    const [fg, bg] = pair.split(' on ');
    const { min } = CHECKS.find((c) => c.fg === fg && c.bg === bg);
    assert.ok(ratio(colour(THEMES[theme], fg), colour(THEMES[theme], bg)) < min, `${key} now passes: take it off KNOWN`);
  }
});

test('the reader resolves what it reads: every theme defines every checked token', () => {
  for (const [theme, t] of Object.entries(THEMES)) {
    for (const { fg, bg } of CHECKS) for (const name of [fg, bg]) assert.ok(t[name] !== undefined, `${theme}: ${name}`);
  }
  for (const [group, looks] of Object.entries(MODERNS)) {
    for (const [look, t] of Object.entries(looks)) {
      for (const { fg, bg } of MODERN_CHECKS) for (const name of [fg, bg]) assert.ok(t[name] !== undefined, `${group}, ${look}: ${name}`);
    }
  }
  // the appearance is read: an accent, a sidebar and a base each change what they should
  const one = MODERNS['Modern light, gray'];
  const at = (look, name, group = one) => colour(group[look], name).join();
  assert.notEqual(at('indigo, sidebar grey, canvas plain', '--primary'), at('teal, sidebar grey, canvas plain', '--primary'));
  assert.notEqual(at('indigo, sidebar grey, canvas plain', '--sidebar'), at('indigo, sidebar tinted, canvas plain', '--sidebar'));
  assert.notEqual(at('indigo, sidebar grey, canvas plain', '--border'),
    at('indigo, sidebar grey, canvas plain', '--border', MODERNS['Modern light, sand']));
  // sanity: the known pair
  assert.equal(ratio([255, 255, 255], [0, 0, 0]).toFixed(1), '21.0');
});
