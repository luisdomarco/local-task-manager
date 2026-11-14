import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { setFeatures } from '../../static/js/features.js';
import { EDITOR_KEYS, GLOBAL_KEYS, closesCard, is, keyText, keymap } from '../../static/js/keymap.js';
import { GO_KEYS, ITEM_KEYS } from '../../static/js/shortcuts.js';

const source = (path) => readFileSync(new URL(`../../static/js/${path}`, import.meta.url), 'utf8');
const key = (k, mods = {}) => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

// Settings → Keyboard and ? print keymap(): a key the app answers and the list leaves out is a key nobody finds.
describe('keymap', () => {
  it('lists every key main.js answers, and main.js answers every key it lists', () => {
    const main = source('main.js');
    const handler = main.slice(main.indexOf("document.addEventListener('keydown'"), main.indexOf("const addBtn"));
    const used = new Set([...handler.matchAll(/is\(e, '([a-z]+)'\)/g)].map((m) => m[1]));
    assert.deepEqual([...used].sort(), Object.keys(GLOBAL_KEYS).sort());
    // No key spelled out beside them, but Esc (Panels: Esc) and the letter after g (GO_KEYS, "Go to").
    const raw = [...handler.matchAll(/e\.key(?:\.toLowerCase\(\))? === '([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(raw, ['Escape']);
  });

  it('lists the editor toolbar\'s keys', () => {
    const drawn = new Set(EDITOR_KEYS.map(([k]) => k));
    for (const [, kbd] of source('mdeditor.js').matchAll(/kbd: '([^']+)'/g)) assert.ok(drawn.has(kbd), `${kbd} is not listed`);
  });

  it('shows each page\'s g-key and each item key, in groups', () => {
    const map = keymap();
    assert.deepEqual(map.map((g) => g.group), ['Navigate', 'Go to', 'Create', 'Item', 'Editor', 'Panels']);
    const rows = (group) => map.find((g) => g.group === group).rows;
    for (const [k, , label] of GO_KEYS) assert.ok(rows('Go to').some(([keys, l]) => keys === `g ${k}` && l === label), `g ${k}`);
    for (const [k] of ITEM_KEYS) assert.ok(rows('Item').some(([keys]) => keys === k), k);
    assert.ok(rows('Navigate').some(([keys]) => keys === '⌘K'));
    assert.ok(rows('Panels').some(([keys]) => keys === '⌘⇧E'));
  });

  it('leaves out a key whose feature the vault has off', () => {
    const quick = () => keymap().find((g) => g.group === 'Create').rows.some(([keys]) => keys === 'q');
    try {
      setFeatures({ vaults: [{ id: 'v', features_off: ['inbox'] }] }, 'v');
      assert.equal(quick(), false);
      setFeatures({ vaults: [{ id: 'v', features_off: [] }] }, 'v');
      assert.equal(quick(), true);
    } finally { setFeatures(null); }
  });

  it('matches a keydown as main.js did', () => {
    assert.equal(is(key('k', { metaKey: true }), 'palette'), true);
    assert.equal(is(key('K', { ctrlKey: true }), 'palette'), true); // Ctrl off a Mac; caps lock
    assert.equal(is(key('k', { metaKey: true, shiftKey: true }), 'palette'), false);
    assert.equal(is(key('E', { metaKey: true, shiftKey: true }), 'sidemode'), true);
    assert.equal(is(key('e', { metaKey: true }), 'sidemode'), false);
    assert.equal(is(key('?', { shiftKey: true }), 'help'), true); // ? is a shifted /
    assert.equal(is(key('q'), 'quick'), true);
    assert.equal(is(key('q', { metaKey: true }), 'quick'), false); // ⌘Q is the system's
    assert.equal(is(key('Q', { shiftKey: true }), 'quick'), false);
    assert.equal(is(key('k', { metaKey: true, altKey: true }), 'palette'), false);
    assert.equal(is(key('k'), 'nope'), false);
  });

  it('draws a key as the app writes it', () => {
    assert.equal(keyText(GLOBAL_KEYS.sidemode), '⌘⇧E');
    assert.equal(keyText(GLOBAL_KEYS.sidebar), '⌘\\');
    assert.equal(keyText(GLOBAL_KEYS.quick), 'q');
  });
});

// INB-009: Esc while writing a description must not close the card under the editor (it is Done: save, then leave).
describe('Esc and the open card', () => {
  const inside = (sel) => ({ closest: (q) => (q.split(',').map((x) => x.trim()).includes(sel) ? {} : null) });
  const esc = (mods = {}) => ({ key: 'Escape', defaultPrevented: false, isComposing: false, keyCode: 27, target: inside('body'), ...mods });
  it('a plain Esc closes it', () => assert.equal(closesCard(esc()), true));
  it('not one a menu or a field already took', () => assert.equal(closesCard(esc({ defaultPrevented: true })), false));
  it('not one that ends an accent being composed', () => {
    assert.equal(closesCard(esc({ isComposing: true })), false);
    assert.equal(closesCard(esc({ keyCode: 229 })), false);
  });
  it('not one from inside a Markdown editor (Source or Live)', () => assert.equal(closesCard(esc({ target: inside('.mde') })), false));
  it('another key never', () => assert.equal(closesCard(esc({ key: 'Enter' })), false));
  it('the page asks it before closing the card', () => assert.match(source('main.js'), /if \(!closesCard\(e\)\) return;[^\n]*\n\s*if \(menuIsOpen\(\)/));
});

