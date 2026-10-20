import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyHits, groupByType, matches, norm, rank, typeOrder } from '../../static/js/search.js';

const item = (id, title, type = 'task', extra = {}) => ({ id, key: id, title, type, path: `Tasks/${id} ${title}.md`, fields: {}, ...extra });

test('accents and case do not matter', () => {
  assert.equal(norm('Configuración'), 'configuracion');
  assert.ok(matches('CONFIGURACION menu', 'Iteración categorización menú — configuración'));
  assert.ok(!matches('menu desktop', 'Iteración menú'));
});

test('an id beats a title that starts with the query, which beats a word, which beats anywhere', () => {
  assert.equal(rank('tsk-044', item('TSK-044', 'Terminal')), 0);
  assert.equal(rank('tsk-04', item('TSK-044', 'Terminal')), 1);
  assert.equal(rank('termi', item('TSK-044', 'Terminal raro')), 2);
  assert.equal(rank('raro term', item('TSK-044', 'Terminal raro')), 3);
  assert.equal(rank('rmin', item('TSK-044', 'Terminal raro')), 4);
  assert.equal(rank('docs', item('TSK-044', 'Terminal raro')), null);
  assert.equal(rank('   ', item('TSK-044', 'Terminal raro')), null);
});

test('types go in the sidebar order: capture, types, tools, then those with no link', () => {
  const types = [
    { name: 'prompt', nav: { group: 'tools', order: 1 } }, { name: 'plan' },
    { name: 'task', nav: { group: 'types', order: 3 } }, { name: 'inbox', nav: { group: 'capture', order: 1 } },
    { name: 'initiative', nav: { group: 'types', order: 1 } },
  ];
  assert.deepEqual(typeOrder(types), ['inbox', 'initiative', 'task', 'prompt', 'plan']);
});

test('items are grouped by type, best first, closed last, a few of each unless the type is expanded', () => {
  const items = [
    item('TSK-001', 'Menú desktop'), item('TSK-002', 'Otro menú', 'task', { fields: { updated_at: '2026-10-19' } }),
    item('TSK-003', 'Menú viejo', 'task', { closed: true }), item('INI-001', 'Menú global', 'initiative'),
    item('NOTE-1', 'Sin nada', 'note'),
  ];
  const opts = { order: ['initiative', 'task'], isClosed: (i) => !!i.closed, per: 2 };
  const groups = groupByType('menu', items, opts);
  assert.deepEqual(groups.map((g) => [g.type, g.items.map((i) => i.id), g.total]),
    [['initiative', ['INI-001'], 1], ['task', ['TSK-001', 'TSK-002'], 3]]);
  const all = groupByType('menu', items, { ...opts, expanded: new Set(['task']) });
  assert.deepEqual(all[1].items.map((i) => i.id), ['TSK-001', 'TSK-002', 'TSK-003']); // the closed one at the end
});

test('a line found in the text points at its item, once, and not at one already shown', () => {
  const a = item('TSK-001', 'Uno');
  const b = item('TSK-002', 'Dos');
  const results = [
    { path: a.path, line: 4, text: 'el buscador global' }, { path: a.path, line: 9, text: 'otra vez buscador' },
    { path: 'Docs/suelto.md', line: 1, text: 'buscador' }, { path: b.path, line: 2, text: 'buscador' },
  ];
  assert.deepEqual(bodyHits('buscador', results, [a, b]).map((x) => [x.item.id, x.line]), [['TSK-001', 4], ['TSK-002', 2]]);
  assert.deepEqual(bodyHits('buscador', results, [a, b], new Set(['TSK-001'])).map((x) => x.item.id), ['TSK-002']);
  assert.deepEqual(bodyHits('x', undefined, [a]), []);
});

test('a frontmatter line counts by its value, not by its key', () => {
  const a = item('TSK-001', 'Uno');
  const b = item('TSK-002', 'Dos');
  const c = item('TSK-003', 'Tres');
  const results = [{ path: a.path, line: 3, text: 'related_to: "[[INI-001]]"' }, { path: b.path, line: 2, text: 'title: Revisión de reglas' },
    { path: c.path, line: 12, text: 'Nota: hay que revisar' }];
  assert.deepEqual(bodyHits('re', results, [a, b, c]).map((x) => x.item.id), ['TSK-002', 'TSK-003']);
  const commented = [{ path: a.path, line: 5, text: 'premise_max_age_days: 14     # gate Backlog→ToDo fails' }, { path: b.path, line: 9, text: 'El gate falla' }];
  assert.deepEqual(bodyHits('gate', commented, [a, b]).map((x) => x.item.id), ['TSK-002']);
});
