import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { isShortId, leavesProject, parentChoices, parentLabel, parentPick, parentValue, projectFree, setStructure } from '../../static/js/rules.js';
import { FOLDER_PER_TYPE, PROJECTS } from '../../static/js/structure.js';

// One Parent field for where an item lives: its project and what it hangs from (`project`, `related_to` in its file).
const items = [
  { type: 'project', title: 'Acme Web', fields: { project_key: 'ACME' } },
  { type: 'project', title: 'Office Move', fields: { project_key: 'MOVE' } },
  { type: 'initiative', id: 'ACME-INI-001', title: 'Checkout', fields: { project: 'ACME', status: 'Backlog' } },
  { type: 'initiative', id: 'MOVE-INI-001', title: 'New office', fields: { project: 'MOVE', status: 'Backlog' } },
  { type: 'initiative', id: 'MOVE-INI-002', title: 'Old office', fields: { project: 'MOVE', status: 'Done' } },
  { type: 'meeting', id: 'MTG-001', title: 'Kick-off', fields: {} },
];
const values = (type, opts) => parentChoices(type, opts, items).map((c) => c.value);

describe('parent field', () => {
  after(() => setStructure(FOLDER_PER_TYPE));

  it('offers a task the projects, then what it may hang from, open ones only', () => {
    setStructure(PROJECTS);
    const v = values('task', {});
    assert.deepEqual(v.slice(0, 2), ['project:ACME', 'project:MOVE']);
    assert.ok(v.includes('ACME-INI-001') && v.includes('MOVE-INI-001'));
    assert.ok(!v.includes('MOVE-INI-002')); // done
    assert.ok(values('task', { current: 'MOVE-INI-002' }).includes('MOVE-INI-002')); // unless it is the one it has
    assert.ok(!values('task', { exclude: new Set(['ACME-INI-001']) }).includes('ACME-INI-001'));
  });

  it('offers a ticket no project (its own is fixed) and only what is in its project; a new one, the projects too', () => {
    setStructure(PROJECTS);
    assert.deepEqual(values('story', { project: 'ACME' }), ['ACME-INI-001']);
    assert.deepEqual(values('error', { creating: true }), ['project:ACME', 'project:MOVE', 'ACME-INI-001', 'MOVE-INI-001']);
  });

  it('never offers a project to one that always hangs from an item (a plan); a story, a PRD, a hotfix may hang from none', () => {
    setStructure(PROJECTS);
    assert.ok(!values('plan', { creating: true }).some((v) => v.startsWith('project:')));
    assert.deepEqual(parentPick('plan', null, items, { related_to: 'ACME-INI-001', project: 'ACME' }), {}); // changed, never let go
    for (const t of ['story', 'prd', 'hotfix']) assert.ok(values(t, { creating: true }).includes('project:ACME'), t);
    assert.deepEqual(parentPick('story', null, items, { related_to: 'ACME-INI-001', project: 'ACME' }), { related_to: null }); // its project stays
  });

  it('says which tickets may leave their project, and when their project can change', () => {
    setStructure(PROJECTS);
    for (const t of ['initiative', 'story', 'spec', 'support', 'hotfix', 'prd']) assert.ok(leavesProject(t), t);
    for (const t of ['plan', 'analysis', 'error', 'learning', 'task', 'project']) assert.ok(!leavesProject(t), t);
    assert.ok(isShortId('482') && isShortId(7) && !isShortId('ACME-INI-001') && !isShortId('') && !isShortId(null));
    assert.ok(projectFree('initiative', { id: '12' }));
    assert.ok(!projectFree('initiative', { id: 'ACME-INI-001' })); // a long id carries its project's key
    assert.ok(!projectFree('plan', { id: '12' }) && !projectFree('analysis', { id: '12' })); // a sub-document follows its item
    assert.ok(projectFree('analysis', { creating: true }) && projectFree('task'));
  });

  it('writes a project alone, or an item with its project, and lets go one step at a time', () => {
    setStructure(PROJECTS);
    assert.deepEqual(parentPick('task', 'project:MOVE', items, { related_to: 'ACME-INI-001', project: 'ACME' }), { related_to: null, project: 'MOVE' });
    assert.deepEqual(parentPick('task', 'MOVE-INI-001', items, { project: 'ACME' }), { related_to: 'MOVE-INI-001', project: 'MOVE' });
    assert.deepEqual(parentPick('task', 'ACME-INI-001', items, { project: 'ACME' }), { related_to: 'ACME-INI-001' });
    assert.deepEqual(parentPick('task', null, items, { related_to: 'ACME-INI-001', project: 'ACME' }), { related_to: null });
    assert.deepEqual(parentPick('task', null, items, { project: 'ACME' }), { project: null });
    assert.deepEqual(parentPick('story', 'ACME-INI-001', items, { project: 'ACME' }), { related_to: 'ACME-INI-001' }); // its project stays
    assert.deepEqual(parentPick('story', null, items, { project: 'ACME' }), {}); // nothing to let go of: the project is its own
    assert.deepEqual(parentPick('story', 'MOVE-INI-001', items, {}, { creating: true }), { related_to: 'MOVE-INI-001', project: 'MOVE' });
  });

  // With short ids a ticket may hang from an item of any project, or of none, and changes project with it.
  const short = [
    { type: 'project', title: 'Acme Web', fields: { project_key: 'ACME' } },
    { type: 'project', title: 'Office Move', fields: { project_key: 'MOVE' } },
    { type: 'initiative', id: '1', title: 'Checkout', fields: { project: 'ACME', status: 'Backlog' } },
    { type: 'initiative', id: '2', title: 'New office', fields: { project: 'MOVE', status: 'Backlog' } },
    { type: 'initiative', id: '3', title: 'Someday', fields: { project: null, status: 'Backlog' } },
    { type: 'story', id: '4', title: 'One page', fields: { project: 'ACME', related_to: '1', status: 'Backlog' } },
    { type: 'plan', id: '5', title: 'Steps', fields: { project: 'ACME', related_to: '4' } },
    { type: 'project', title: 'Office', fields: { project_key: 'OFF', project_kind: 'simple' } }, // its initiatives read simple
    { type: 'initiative', id: '6', title: 'Desks', fields: { project: 'OFF', status: 'Backlog' } },
  ];
  const shortValues = (type, opts) => parentChoices(type, opts, short).map((c) => c.value);

  it('offers a ticket with a short id the projects and what it may hang from in any project or none', () => {
    setStructure(PROJECTS);
    assert.deepEqual(shortValues('story', { project: 'ACME', id: '4', current: '1' }), ['project:ACME', 'project:MOVE', 'project:OFF', '1', '2', '3']);
    assert.deepEqual(shortValues('initiative', { project: 'ACME', id: '1' }), ['project:ACME', 'project:MOVE', 'project:OFF']);
    assert.ok(!shortValues('story', { id: '4' }).includes('6')); // never from a simple initiative
    assert.ok(!shortValues('support', { id: '7' }).includes('project:OFF')); // nor to a project that has no support tickets
    // A long id: only what is in its own project, and no project to pick.
    assert.deepEqual(values('story', { project: 'ACME', id: 'ACME-STY-001' }), ['ACME-INI-001']);
    // A sub-document: only what is in its item's project (none included), never a project.
    assert.deepEqual(shortValues('plan', { project: 'ACME', id: '5' }), ['1', '4']);
    assert.deepEqual(shortValues('plan', { project: null, id: '5' }), ['3']);
  });

  it('brings the project of the item picked along, none included; lets go keeping its own', () => {
    setStructure(PROJECTS);
    const f = { related_to: '1', project: 'ACME' };
    assert.deepEqual(parentPick('story', '2', short, f, { id: '4' }), { related_to: '2', project: 'MOVE' });
    assert.deepEqual(parentPick('story', '3', short, f, { id: '4' }), { related_to: '3', project: null });
    assert.deepEqual(parentPick('story', '1', short, { project: 'ACME' }, { id: '4' }), { related_to: '1' });
    assert.deepEqual(parentPick('story', null, short, f, { id: '4' }), { related_to: null }); // ✕ on its item: its project stays
    assert.deepEqual(parentPick('initiative', null, short, { project: 'ACME' }, { id: '1' }), { project: null }); // ✕ on its project
    assert.deepEqual(parentPick('initiative', 'project:MOVE', short, { project: 'ACME' }, { id: '1' }), { related_to: null, project: 'MOVE' });
    assert.deepEqual(parentPick('initiative', null, items, { project: 'ACME' }, { id: 'ACME-INI-001' }), {}); // a long id stays
    assert.deepEqual(parentPick('story', '2', items, f, { id: 'ACME-STY-001' }), { related_to: '2' }); // nor brings one
    assert.deepEqual(parentPick('plan', '3', short, { related_to: '4', project: 'ACME' }, { id: '5' }), { related_to: '3' }); // follows its item: the store moves nothing
  });

  it('shows the parent, else the project, as one value; names the field', () => {
    setStructure(PROJECTS);
    assert.equal(parentValue({ related_to: 'ACME-INI-001', project: 'ACME' }), 'ACME-INI-001');
    assert.equal(parentValue({ project: 'ACME' }), 'project:ACME');
    assert.equal(parentValue({}), null);
    assert.equal(parentLabel('task'), 'Parent');
    assert.equal(parentLabel('story'), 'Parent');
    setStructure(FOLDER_PER_TYPE);
    assert.equal(parentLabel('transcription'), 'Meeting');
  });
});
