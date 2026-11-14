import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { hides, initiativeHas, initiativeKindOf, inSomeProject, kindById, kindFor, projectDelivers, projectHas, projectOf, propsOf,
  setStructure, widensTo } from '../../static/js/rules.js';
import { FOLDER_PER_TYPE } from '../../static/js/structure.js';

// The folder-per-type structure dressed as Ticketing's: project-scoped types and the three initiative kinds as
// tm/structures/kinds.py publishes them (GET /api/structure `kinds` and the extras the page reads with them).
const KINDS = [
  { id: 'product', label: 'Product', delivers: true, widens: ['system'], hidden: {} },
  { id: 'system', label: 'Agentic system', delivers: true, widens: ['product'], hidden: {} },
  { id: 'simple', label: 'Simple', delivers: false, widens: ['product', 'system'], hidden: { initiative: ['size', 'prd'] } },
];
const WITH_KINDS = {
  ...FOLDER_PER_TYPE, kinds: KINDS, kind_key: 'initiative_kind', legacy_kind_key: 'project_kind', legacy_kind_default: 'product',
  project_scoped: ['initiative', 'story', 'support', 'hotfix', 'prd', 'plan', 'analysis'],
  initiative_delivery_types: ['story', 'prd', 'plan'], project_delivery_types: ['support', 'hotfix'],
  delivery_settings: ['execution_mode', 'repo'],
  types: [...FOLDER_PER_TYPE.types.filter((t) => t.name !== 'project'),
    { name: 'project', parents: [], closed: [], props: [{ key: 'project_kind' }, { key: 'execution_mode' }, { key: 'repo' }, { key: 'goal' }] }],
};
const project = (key, legacy) => ({ type: 'project', fields: { project_key: key, ...(legacy ? { project_kind: legacy } : {}) } });
const ini = (project, kind, extra = {}) => ({ type: 'initiative', fields: { project, ...(kind ? { initiative_kind: kind } : {}), ...extra } });

describe('initiative kinds', () => {
  after(() => setStructure(FOLDER_PER_TYPE));

  it('a structure without kinds has none and holds every type', () => {
    setStructure({ ...FOLDER_PER_TYPE, project_scoped: ['story', 'hotfix'] });
    assert.equal(kindById('product'), null);
    assert.equal(initiativeKindOf({ initiative_kind: 'product' }), null);
    assert.equal(projectHas(project('AC'), 'hotfix'), true);
    assert.equal(kindFor(ini('AC', 'simple'), []), null);
  });

  it('an initiative reads its own kind, else its project’s from before, else a product', () => {
    setStructure(WITH_KINDS);
    assert.equal(kindById('simple').id, 'simple');
    assert.equal(kindById('nonsense'), null);
    assert.equal(initiativeKindOf({ initiative_kind: 'system' }, { project_kind: 'simple' }).id, 'system');
    assert.equal(initiativeKindOf({}, { project_kind: 'simple' }).id, 'simple');
    assert.equal(initiativeKindOf({}, {}).id, 'product');
    const move = project('MOVE', 'simple');
    const items = [project('ACME'), move];
    assert.equal(projectOf(ini('MOVE'), items), move);
    assert.equal(kindFor(ini('MOVE'), items).id, 'simple');
    assert.equal(kindFor(ini('ACME', 'system'), items).id, 'system');
    assert.equal(kindFor({ type: 'task', fields: {} }, items), null);
    assert.equal(kindFor({ type: 'story', fields: { project: 'MOVE' } }, items), null); // only an initiative's fields hide
  });

  it('a kind only widens', () => {
    setStructure(WITH_KINDS);
    assert.deepEqual(widensTo('simple'), ['simple', 'product', 'system']);
    assert.deepEqual(widensTo('product'), ['product', 'system']);
    assert.deepEqual(widensTo(undefined), []);
  });

  it('a project delivers while one of its initiatives does, of any status, or its note says so from before', () => {
    setStructure(WITH_KINDS);
    const acme = project('ACME');
    assert.equal(projectDelivers(acme.fields, [acme]), false);
    assert.equal(projectDelivers(acme.fields, [acme, ini('ACME', 'simple')]), false);
    assert.equal(projectDelivers(acme.fields, [acme, ini('ACME', 'simple'), ini('ACME', 'system', { status: 'Discarded' })]), true);
    assert.equal(projectDelivers(acme.fields, [ini('OPS', 'product')]), false); // another project's
    assert.equal(projectDelivers(project('OLD', 'product').fields, []), true);
    assert.equal(projectDelivers(project('MV', 'simple').fields, [ini('MV')]), false); // it reads simple
  });

  it('support tickets and hotfixes come with a delivering initiative; the ones a project holds take no more', () => {
    setStructure(WITH_KINDS);
    const mv = project('MV');
    const simple = [mv, ini('MV', 'simple')];
    for (const t of ['support', 'hotfix']) {
      assert.equal(projectHas(mv, t, simple), false, t);
      assert.equal(projectHas(mv, t, [...simple, ini('MV', 'product')]), true, t);
      assert.equal(projectHas(mv, t, [...simple, { type: t, fields: { project: 'MV' } }]), false, t); // listed, not added to
    }
    for (const t of ['initiative', 'story', 'prd', 'analysis', 'task']) assert.equal(projectHas(mv, t, simple), true, t);
    assert.equal(inSomeProject('support', simple), false);
    assert.equal(inSomeProject('support', [...simple, ini('MV', 'system')]), true);
    assert.equal(inSomeProject('support', []), true);
  });

  it('a story, a PRD and a plan hang only from a delivering initiative', () => {
    setStructure(WITH_KINDS);
    const items = [project('MV', 'simple')];
    for (const t of ['story', 'prd', 'plan']) {
      assert.equal(initiativeHas(t, ini('MV'), items), false, t); // it reads its project's: simple
      assert.equal(initiativeHas(t, ini('MV', 'product'), items), true, t);
    }
    assert.equal(initiativeHas('task', ini('MV'), items), true);
    const lab = project('LAB'); // on a project's page: while one of its initiatives delivers
    assert.equal(initiativeHas('story', lab, [lab, ini('LAB', 'simple')]), false);
    assert.equal(initiativeHas('story', lab, [lab, ini('LAB', 'simple'), ini('LAB', 'system')]), true);
    assert.equal(initiativeHas('task', lab, [lab]), true);
    assert.equal(initiativeHas('plan', { type: 'story', fields: {} }, items), true); // a plan of a story
  });

  it('hides what a kind leaves out, and a project’s delivery settings while it does not deliver', () => {
    setStructure(WITH_KINDS);
    assert.equal(hides(kindById('simple'), 'initiative', 'size'), true);
    assert.equal(hides(kindById('product'), 'initiative', 'size'), false);
    assert.equal(hides(null, 'initiative', 'size'), false);
    const acme = project('ACME');
    const keys = (p, items) => propsOf('project', kindFor(p, items)).map((x) => x.key);
    assert.deepEqual(keys(acme, [acme]), ['goal']);
    assert.deepEqual(keys(acme, [acme, ini('ACME', 'product')]), ['execution_mode', 'repo', 'goal']);
    const old = project('OLD', 'product'); // its note says the kind it had: shown, read-only, with its delivery settings
    assert.deepEqual(keys(old, [old]), ['project_kind', 'execution_mode', 'repo', 'goal']);
  });
});
