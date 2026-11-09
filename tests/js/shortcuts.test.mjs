import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { STRUCTURE } from '../../static/js/rules.js';
import { PLANNING } from '../../static/js/sections.js';
import { GO, GO_KEYS, ITEM_KEYS, keyboardHelp } from '../../static/js/shortcuts.js';

const html = readFileSync(new URL('../../static/index.html', import.meta.url), 'utf8');

describe('shortcuts', () => {
  it('uses each key once', () => {
    const keys = GO_KEYS.map(([k]) => k);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.every((k) => /^[a-z]$/.test(k)));
    assert.ok(!keys.includes('g') && !keys.includes('q'), 'g and q are taken by the app');
  });

  it('only goes to views that the sidebar has', () => {
    // index.html's links, each type's, which main.js renderNav draws from the structure (`nav`; a type in a section is
    // its tab), and Planning's tabs (sections.js)
    const sidebar = new Set([...[...html.matchAll(/data-view="([a-z]+)"/g)].map((m) => m[1]),
      ...STRUCTURE.types.filter((t) => t.nav).map((t) => t.route), ...PLANNING.tabs.map(([route]) => route)]);
    for (const [, view] of GO_KEYS) assert.ok(sidebar.has(view), `no sidebar link for "${view}"`);
  });

  it('keeps the help in step with the keys', () => {
    const help = keyboardHelp();
    for (const [key, , label] of GO_KEYS) {
      assert.ok(help.includes(label), `help does not mention ${label}`);
      assert.equal(GO[key] !== undefined, true);
    }
  });
  it('gives each item action its own key, none of the app\'s', () => {
    const keys = ITEM_KEYS.map(([k]) => k);
    assert.equal(new Set(keys).size, keys.length);
    for (const k of keys) assert.ok(!['q', 'g', '/'].includes(k), `${k} is the app's`);
    for (const [k, , what] of ITEM_KEYS) assert.ok(keyboardHelp().includes(`${k} — ${what}`));
  });
});
