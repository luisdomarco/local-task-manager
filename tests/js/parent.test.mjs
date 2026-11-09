import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { parentChoices, parentLabel, parentPick, parentValue, setStructure } from '../../static/js/rules.js';
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

  it('never offers a project to one that always hangs from an item (a story, a PRD, a hotfix, a plan)', () => {
    setStructure(PROJECTS);
    for (const t of ['story', 'prd', 'hotfix', 'plan']) assert.ok(!values(t, { creating: true }).some((v) => v.startsWith('project:')), t);
    assert.deepEqual(values('story', { creating: true }), ['ACME-INI-001', 'MOVE-INI-001']);
    assert.deepEqual(parentPick('story', null, items, { related_to: 'ACME-INI-001', project: 'ACME' }), {}); // changed, never let go
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
