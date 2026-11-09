import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { hides, inSomeProject, kindById, kindFor, projectHas, projectOf, setStructure } from '../../static/js/rules.js';
import { FOLDER_PER_TYPE } from '../../static/js/structure.js';

// The folder-per-type structure dressed as Ticketing's: project-scoped types and the three kinds as
// tm/structures/kinds.py publishes them (GET /api/structure `kinds`).
const KINDS = [
  { id: 'product', label: 'Product', types: ['initiative', 'story', 'support', 'hotfix', 'prd', 'analysis'],
    optional: ['hotfix', 'prd'], default_on: ['hotfix', 'prd'], hidden: {} },
  { id: 'system', label: 'Agentic system', types: ['initiative', 'story', 'support', 'analysis'],
    optional: [], default_on: [], hidden: { initiative: ['prd'] } },
  { id: 'simple', label: 'Simple', types: ['initiative', 'analysis'], optional: ['analysis'], default_on: [],
    hidden: { project: ['execution_mode'], initiative: ['size', 'prd'] } },
];
const WITH_KINDS = {
  ...FOLDER_PER_TYPE, kinds: KINDS, kind_key: 'project_kind',
  project_scoped: ['initiative', 'story', 'support', 'hotfix', 'prd', 'analysis'],
};
const project = (key, kind, enabled) => ({ type: 'project', fields: { project_key: key, project_kind: kind,
  ...(enabled ? { enabled_types: enabled } : {}) } });

describe('project kinds', () => {
  after(() => setStructure(FOLDER_PER_TYPE));

  it('a structure without kinds has none, and narrows only by enabled_types', () => {
    setStructure({ ...FOLDER_PER_TYPE, project_scoped: ['story', 'hotfix'], optional_types: ['hotfix'] });
    assert.equal(kindById('product'), null);
    assert.equal(projectHas(project('AC', undefined, ['story']), 'story'), true);
    assert.equal(projectHas(project('AC', undefined, ['story']), 'hotfix'), false);
    assert.equal(projectHas(project('AC', undefined, ['hotfix']), 'hotfix'), true);
  });

  it('reads a kind by its id, an unknown or missing one as the first', () => {
    setStructure(WITH_KINDS);
    assert.equal(kindById('simple').id, 'simple');
    assert.equal(kindById('nonsense').id, 'product');
    assert.equal(kindById(undefined).id, 'product');
  });

  it("finds an item's project and kind; a task with no project has none", () => {
    setStructure(WITH_KINDS);
    const move = project('MOVE', 'simple');
    const items = [project('ACME', 'product'), move];
    const ini = { type: 'initiative', fields: { project: 'MOVE' } };
    assert.equal(projectOf(ini, items), move);
    assert.equal(projectOf(move, items), move);
    assert.equal(kindFor(ini, items).id, 'simple');
    assert.equal(kindFor({ type: 'task', fields: {} }, items), null);
    assert.equal(kindFor({ type: 'task', fields: { project: 'GONE' } }, items), null);
  });

  it('a project holds its kind’s types, the optional ones as its enabled_types (or the kind’s default) says', () => {
    setStructure(WITH_KINDS);
    assert.equal(projectHas(project('AC', 'product'), 'hotfix'), true); // default on
    assert.equal(projectHas(project('AC', 'product', ['initiative']), 'hotfix'), false); // turned off
    assert.equal(projectHas(project('OP', 'system', ['hotfix']), 'hotfix'), false); // not in its kind, whatever it lists
    assert.equal(projectHas(project('MV', 'simple'), 'story'), false);
    assert.equal(projectHas(project('MV', 'simple'), 'analysis'), false); // optional, off by default
    assert.equal(projectHas(project('MV', 'simple', ['analysis']), 'analysis'), true);
    assert.equal(projectHas(project('MV', 'simple'), 'initiative'), true);
    assert.equal(projectHas(project('MV', 'simple'), 'task'), true); // a root type: every project
  });

  it('hides a field its kind leaves out', () => {
    setStructure(WITH_KINDS);
    assert.equal(hides(kindById('simple'), 'initiative', 'size'), true);
    assert.equal(hides(kindById('simple'), 'project', 'execution_mode'), true);
    assert.equal(hides(kindById('product'), 'initiative', 'size'), false);
    assert.equal(hides(null, 'initiative', 'size'), false);
  });

  it('a type has a place when some project may hold it; a vault with no project keeps them all', () => {
    setStructure(WITH_KINDS);
    const simple = [project('MV', 'simple'), { type: 'task', fields: {} }];
    assert.equal(inSomeProject('story', simple), false);
    assert.equal(inSomeProject('initiative', simple), true);
    assert.equal(inSomeProject('task', simple), true);
    assert.equal(inSomeProject('story', [...simple, project('AC', 'product')]), true);
    assert.equal(inSomeProject('story', []), true);
  });
});
