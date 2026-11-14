// INB-012a: Settings' sections in groups, a column on the left (views/settings.js settingsNav, settingsnav.js).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { NAV_GROUPS, groupSections } from '../../static/js/settingsnav.js';

const settings = readFileSync(new URL('../../static/js/views/settings.js', import.meta.url), 'utf8');
const ALL = [...settings.match(/const ALL_TABS = \[([^\n]+)\];/)[1].matchAll(/\['(\w+)', '[^']+'\]/g)].map((m) => m[1]);

test('every section of Settings is in exactly one group', () => {
  assert.ok(ALL.length >= 10, 'read ALL_TABS');
  const named = NAV_GROUPS.flatMap(([, keys]) => keys);
  assert.deepEqual([...named].sort(), [...ALL].sort());
  assert.equal(new Set(named).size, named.length);
});

test('groups keep their order, drop what the page does not show, and put an unknown key under More', () => {
  assert.deepEqual(groupSections(ALL).map(([name]) => name), ['Workspace', 'Appearance', 'Claude & agents', 'The app']);
  // A phone has no Keyboard; a vault without the terminal and agents features, no Claude group at all.
  const shown = ALL.filter((k) => !['keyboard', 'claude', 'agents'].includes(k));
  const groups = groupSections(shown);
  assert.deepEqual(groups.find(([n]) => n === 'Appearance'), ['Appearance', ['themes']]);
  assert.ok(!groups.some(([n]) => n === 'Claude & agents'));
  assert.deepEqual(groupSections(['general', 'later'])[1], ['More', ['later']]);
});

test('the address still names the section, and the panels keep data-tab (their CSS)', () => {
  assert.match(settings, /href: `#\/settings\/\$\{k\}`/);
  assert.match(settings, /class: 'tab-panel', role: 'region', 'aria-label': t\.label, 'data-tab': t\.key/);
  assert.match(settings, /window\.removeEventListener\('hashchange', onHash\)/, 'the Back listener goes with the page');
});
