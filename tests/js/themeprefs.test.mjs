import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEYS, OPTIONS, PRESETS, SKINS, applyTheme, presetOf, presetValues, resolveTheme, shuffled } from '../../static/js/themeprefs.js';

/** A stand-in for <html>: its dataset and classList, as applyTheme and index.html's script use them. */
function fakeRoot() {
  const classes = new Set();
  return {
    dataset: {},
    classList: {
      toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); },
      add: (c) => classes.add(c),
      contains: (c) => classes.has(c),
    },
    style: { setProperty() {} },
  };
}
const shown = (root) => ({ ...root.dataset, dark: root.classList.contains('dark') });

const none = Object.fromEntries(Object.keys(OPTIONS).map((k) => [k, null]));
const defaults = Object.fromEntries(Object.entries(OPTIONS).map(([k, list]) => [k, list[0]]));

test('defaults: Classic, the system decides light or dark, none of Modern\'s options', () => {
  assert.deepEqual(resolveTheme({}, false), { mode: 'system', theme: 'light', skin: 'classic', ...none });
  assert.equal(resolveTheme({}, true).theme, 'dark');
});

test('a chosen mode wins over the system', () => {
  assert.equal(resolveTheme({ mode: 'light' }, true).theme, 'light');
  assert.equal(resolveTheme({ mode: 'dark' }, false).theme, 'dark');
});

test('unknown stored values fall back to the defaults', () => {
  const t = resolveTheme({ mode: 'sepia', skin: 'retro', density: 'huge', accent: 'chartreuse' }, false);
  assert.deepEqual(t, { mode: 'system', theme: 'light', skin: 'classic', ...none });
  const nonsense = Object.fromEntries(Object.keys(OPTIONS).map((k) => [k, 'nonsense']));
  assert.deepEqual(resolveTheme({ skin: 'modern', ...nonsense }, false), { mode: 'system', theme: 'light', skin: 'modern', ...defaults });
});

test("Modern's options count only in Modern", () => {
  const picked = { density: 'compact', accent: 'teal', base: 'sand', radius: 'large', sidebar: 'tinted', canvas: 'gradient',
    font: 'serif', heading: 'mono', menu: 'translucent', icons: 'thin' };
  assert.deepEqual(Object.keys(picked).sort(), Object.keys(OPTIONS).sort(), 'one of each option');
  assert.deepEqual(resolveTheme({ skin: 'classic', ...picked }), { mode: 'system', theme: 'light', skin: 'classic', ...none });
  assert.deepEqual(resolveTheme({ skin: 'modern', ...picked }), { mode: 'system', theme: 'light', skin: 'modern', ...picked });
});

test('every option: its key, its root attribute, its default first', () => {
  for (const [k, list] of Object.entries(OPTIONS)) {
    assert.equal(KEYS[k], `tm-${k}`);
    assert.equal(new Set(list).size, list.length, k);
  }
});

test('presets: known values only, one found again from its values, the default one is Modern as it comes', () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    for (const [k, v] of Object.entries(preset)) assert.ok(OPTIONS[k]?.includes(v) && k !== 'density', `${name}: ${k}=${v}`);
    assert.equal(presetOf({ ...presetValues(name), density: 'compact' }), name, 'the density is not part of a preset');
  }
  const { density, ...look } = defaults;
  assert.deepEqual(presetValues('modern'), look);
  assert.equal(presetOf({ ...look, accent: 'teal' }), null, 'a choice of one\'s own');
  assert.equal(new Set(Object.values(PRESETS).map((p) => JSON.stringify(presetValues(Object.keys(PRESETS).find((n) => PRESETS[n] === p))))).size,
    Object.keys(PRESETS).length, 'no two presets alike');
});

test('shuffle: one known value of each option, the density left alone', () => {
  let i = 0;
  const seq = [0, 0.99, 0.5, 0.3, 0.7, 0.1, 0.9, 0.4, 0.6];
  const s = shuffled(() => seq[i++ % seq.length]);
  assert.ok(!('density' in s));
  for (const [k, v] of Object.entries(s)) assert.ok(OPTIONS[k].includes(v), `${k}=${v}`);
  assert.deepEqual(shuffled(() => 0), presetValues('modern'), 'the first of each: the defaults');
});

test('applyTheme sets the attributes and the .dark class, and says when something changed', () => {
  const root = fakeRoot();
  assert.equal(applyTheme(root, resolveTheme({ skin: 'modern', mode: 'dark', accent: 'blue' })), true);
  assert.deepEqual(shown(root), { theme: 'dark', skin: 'modern', ...defaults, accent: 'blue', dark: true });
  assert.equal(applyTheme(root, resolveTheme({ skin: 'modern', mode: 'dark', accent: 'blue' })), false);
  applyTheme(root, resolveTheme({ skin: 'classic', mode: 'light' }));
  assert.deepEqual(shown(root), { theme: 'light', skin: 'classic', dark: false });
});

// index.html applies the same choices before the first paint, in a few lines of its own: run them against the module.
const html = readFileSync(new URL('../../static/index.html', import.meta.url), 'utf8');
const firstScript = html.match(/<script>(try\{var d=document\.documentElement[\s\S]*?)<\/script>/)[1];

const run = new Function('document', 'localStorage', 'matchMedia', 'innerWidth', 'location', 'URLSearchParams', firstScript);
function runFirstScript(stored, systemDark) {
  const root = fakeRoot();
  const written = [];
  const document = { documentElement: root, write: (s) => written.push(s) };
  const localStorage = { getItem: (k) => stored[k] ?? null };
  const matchMedia = () => ({ matches: systemDark });
  run(document, localStorage, matchMedia, 1200, { search: '' }, URLSearchParams);
  return { root, written };
}

test("index.html's first script shows what theme.js would, for every choice", () => {
  const values = (list) => [null, ...list, 'nonsense'];
  const check = (choices, systemDark) => {
    const stored = Object.fromEntries(Object.entries(choices).map(([k, v]) => [KEYS[k], v]));
    const { root, written } = runFirstScript(stored, systemDark);
    const expected = fakeRoot();
    applyTheme(expected, resolveTheme(choices, systemDark));
    const say = JSON.stringify({ choices, systemDark });
    assert.deepEqual(shown(root), shown(expected), say);
    // Modern's stylesheet is written in before the first paint, and only for Modern.
    assert.equal(written.some((s) => s.includes('css/themes/modern.css')), expected.dataset.skin === 'modern', say);
  };
  for (const mode of values(['light', 'dark', 'system'])) {
    for (const skin of values(SKINS)) {
      for (const systemDark of [false, true]) {
        check({ mode, skin }, systemDark);
        // each of Modern's options, one at a time, every value
        for (const [k, list] of Object.entries(OPTIONS)) for (const v of values(list)) check({ mode, skin, [k]: v }, systemDark);
      }
    }
  }
  // and all of them at once
  check({ skin: 'modern', ...shuffled(() => 0.6), density: 'compact' }, true);
});
