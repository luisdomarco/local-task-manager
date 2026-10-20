import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docText, docsGroupOf, docsGroups } from '../../static/js/filetree.js';

const c = (project, title, path, extra = {}) => ({ project, title, path, exists: true, archived: false, roots: [], ...extra });

test('a section per project, the vault\'s own last as "No project"; dimmed until its folder is there', () => {
  const groups = docsGroups([
    c('ECD', 'Acme Web', 'Acme Web/Docs', { exists: false }),
    c('HB', 'Internal Tools', 'Internal Tools/Docs', { roots: ['Producto'] }),
    c(null, '', 'Docs'),
  ]);
  assert.deepEqual(groups.map((g) => [g.title, g.path, g.dim]), [
    ['Acme Web', 'Acme Web/Docs', true], ['Internal Tools', 'Internal Tools/Docs', false], ['No project', 'Docs', false]]);
});

test('an archived project shows only when it holds docs; a vault with no projects has one "Docs" section', () => {
  const groups = docsGroups([
    c('OLD', 'Old', 'Old/Docs', { archived: true, exists: false }), c('ARC', 'Archived', 'Archived/Docs', { archived: true, roots: ['Notas'] }),
    c(null, '', 'Docs', { exists: false }),
  ]);
  assert.deepEqual(groups.map((g) => g.title), ['Archived', 'No project']);
  assert.deepEqual(docsGroups([c(null, '', 'docs')]).map((g) => g.title), ['Docs']);
  assert.deepEqual(docsGroups(undefined), []);
});

test('the section of a path is the deepest Docs folder holding it', () => {
  const groups = docsGroups([c('HB', 'Internal Tools', 'Internal Tools/Docs'), c(null, '', 'Docs')]);
  assert.equal(docsGroupOf(groups, 'Internal Tools/Docs/Producto/Visión.md').project, 'HB');
  assert.equal(docsGroupOf(groups, 'Docs/General').project, null);
  assert.equal(docsGroupOf(groups, 'Internal Tools/Docs').project, 'HB');
  assert.equal(docsGroupOf(groups, 'Tasks/TSK-001 X.md'), null);
  assert.equal(docsGroupOf(groups, 'Docsy/x.md'), null); // a prefix of the name is not the folder
});

test('a new doc starts with the Doc frontmatter, its project linked by its folder', () => {
  assert.equal(docText('Visión', 'Internal Tools', '2026-10-19'), [
    '---', 'fileClass: Doc', 'project: "[[00 Internal Tools]]"', 'doc_status: draft', 'owner: ""', 'tags: []',
    'creation_date: 2026-10-19', 'updated_date: 2026-10-19', '---', '', '# Visión', ''].join('\n'));
  assert.match(docText('Glosario', '', '2026-10-19'), /^project: ""$/m);
});

test('a doc\'s address in Docs, encoded part by part like the Explorer\'s', async () => {
  const { docsHref } = await import('../../static/js/filetree.js');
  assert.equal(docsHref(''), '#/docs');
  assert.equal(docsHref('Internal Tools/Docs/Visión #1.md'), '#/docs/Internal%20Tools/Docs/Visi%C3%B3n%20%231.md');
});

test('a folder shows the names its order lists first, in that order, then the rest as usual', async () => {
  const { orderedChildren } = await import('../../static/js/filetree.js');
  const f = (name) => ({ name, kind: 'file' });
  const node = { children: [{ name: 'Sub', kind: 'dir' }, f('A.md'), f('B.md'), f('C.md'), f('D.md')], order: ['C.md', 'gone.md', 'A.md'] };
  assert.deepEqual(orderedChildren(node).map((c) => c.name), ['C.md', 'A.md', 'Sub', 'B.md', 'D.md']);
  assert.deepEqual(orderedChildren({ children: node.children }).map((c) => c.name), ['Sub', 'A.md', 'B.md', 'C.md', 'D.md']);
  assert.deepEqual(orderedChildren(null), []);
});

test('dropping a name before another, or at the end, from inside the folder or from elsewhere', async () => {
  const { dropOrder } = await import('../../static/js/filetree.js');
  assert.deepEqual(dropOrder(['A', 'B', 'C'], 'C', 'A'), ['C', 'A', 'B']);
  assert.deepEqual(dropOrder(['A', 'B', 'C'], 'A', null), ['B', 'C', 'A']);
  assert.deepEqual(dropOrder(['A', 'B', 'C'], 'X', 'B'), ['A', 'X', 'B', 'C']); // from another folder
  assert.deepEqual(dropOrder(['A', 'B'], 'X', 'gone'), ['A', 'B', 'X']);
});

test('what an item can link: the docs and folders inside the Docs folders, not the Docs folders themselves', async () => {
  const { buildTree, docChoices } = await import('../../static/js/filetree.js');
  const tree = buildTree([
    { path: 'Docs', kind: 'dir' }, { path: 'Docs/Producto', kind: 'dir' }, { path: 'Docs/Producto/Visión.md', kind: 'file' },
    { path: 'Docs/Producto/diagrama.png', kind: 'file' }, { path: 'Tasks', kind: 'dir' }, { path: 'Tasks/TSK-001 X.md', kind: 'file' },
  ]);
  assert.deepEqual(docChoices(tree, [{ path: 'Docs' }]).map((c) => [c.kind, c.value]),
    [['folder', 'Docs/Producto/'], ['doc', '[[Visión]]']]);
});

test('an item\'s links resolve to a path, or say they are not found; the items that link a doc are found back', async () => {
  const { buildTree, itemsLinking, resolveDocs } = await import('../../static/js/filetree.js');
  const tree = buildTree([
    { path: 'Docs', kind: 'dir' }, { path: 'Docs/Producto', kind: 'dir' }, { path: 'Docs/Producto/Visión.md', kind: 'file' },
    { path: 'Notes', kind: 'dir' }, { path: 'Notes/Visión.md', kind: 'file' },
  ]);
  const docs = ['[[Visión]]', 'Docs/Producto/', 'Docs/Gone/', '[[Nada]]'];
  assert.deepEqual(resolveDocs(docs, tree, [{ path: 'Docs' }]).map((d) => [d.kind, d.path]),
    [['doc', 'Docs/Producto/Visión.md'], ['folder', 'Docs/Producto'], ['folder', null], ['doc', null]]); // the one in Docs first
  const items = [{ id: 'A', fields: { docs: ['[[Visión]]'] } }, { id: 'B', fields: { docs: ['Docs/Producto/'] } },
    { id: 'C', fields: { docs: ['Docs/Productos/'] } }, { id: 'D', fields: {} }];
  assert.deepEqual(itemsLinking('Docs/Producto/Visión.md', items).map((i) => i.id), ['A', 'B']);
  assert.deepEqual(itemsLinking('Docs/Producto', items).map((i) => i.id), ['B']);
});
