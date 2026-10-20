import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { GO, GO_KEYS, keyboardHelp } from '../../static/js/shortcuts.js';

const html = readFileSync(new URL('../../static/index.html', import.meta.url), 'utf8');

describe('shortcuts', () => {
  it('uses each key once', () => {
    const keys = GO_KEYS.map(([k]) => k);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.every((k) => /^[a-z]$/.test(k)));
    assert.ok(!keys.includes('g') && !keys.includes('q'), 'g and q are taken by the app');
  });

  it('only goes to views that the sidebar has', () => {
    const sidebar = new Set([...html.matchAll(/data-view="([a-z]+)"/g)].map((m) => m[1]));
    for (const [, view] of GO_KEYS) assert.ok(sidebar.has(view), `no sidebar link for "${view}"`);
  });

  it('keeps the help in step with the keys', () => {
    const help = keyboardHelp();
    for (const [key, , label] of GO_KEYS) {
      assert.ok(help.includes(label), `help does not mention ${label}`);
      assert.equal(GO[key] !== undefined, true);
    }
  });
});
