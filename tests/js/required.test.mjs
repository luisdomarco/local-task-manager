import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { missingOnCreate, setStructure } from '../../static/js/rules.js';
import { FOLDER_PER_TYPE, PROJECTS } from '../../static/js/structure.js';

// What the create form marks before it sends anything (create.js): what tm/store.py would refuse.
const items = [
  { type: 'project', title: 'Acme', fields: { project_key: 'ACME', project_kind: 'product' } },
  { type: 'initiative', id: 'ACME-INI-001', title: 'Pricing', fields: { project: 'ACME' } },
  { type: 'initiative', id: 'INI-9', title: 'Someday', fields: { project: null } },
];
const keys = (type, form) => missingOnCreate(type, form, items).map(([k]) => k);

describe('required on create', () => {
  after(() => setStructure(FOLDER_PER_TYPE));

  it('asks every type for a subject, and only that where nothing else is required', () => {
    setStructure(PROJECTS);
    assert.deepEqual(keys('task', { subject: '  ' }), ['subject']);
    assert.deepEqual(keys('task', { subject: 'Call Ana' }), []);
    assert.deepEqual(keys('note', { subject: 'x', project: null }), []); // a note may have no project
  });

  it('asks a project for a key of 2 to 4 capital letters no other project has', () => {
    setStructure(PROJECTS);
    assert.deepEqual(missingOnCreate('project', { subject: 'Hb', project_key: '' }, items), [['project_key', null]]); // empty: only marked
    assert.deepEqual(missingOnCreate('project', { subject: 'Hb', project_key: 'h' }, items), [['project_key', 'A key is 2 to 4 capital letters']]);
    assert.deepEqual(keys('project', { subject: 'Hb', project_key: 'h' }), ['project_key']);
    assert.deepEqual(keys('project', { subject: 'Hb', project_key: 'HB1' }), ['project_key']);
    assert.deepEqual(keys('project', { subject: 'Hb', project_key: ' hb ' }), []); // written upper-case, as the server does
    assert.deepEqual(missingOnCreate('project', { subject: 'Other', project_key: 'acme' }, items), [['project_key', 'ACME is the key of Acme']]);
    assert.deepEqual(keys('project', { subject: '', project_key: '' }), ['subject', 'project_key']);
  });

  it('asks a ticket for neither a project nor a parent: it may be in no project, hanging from nothing', () => {
    setStructure(PROJECTS);
    for (const t of ['initiative', 'story', 'spec', 'support', 'hotfix', 'prd']) assert.deepEqual(keys(t, { subject: 'Login' }), [], t);
    assert.deepEqual(keys('story', { subject: 'Login', project: 'ACME' }), []);
    assert.deepEqual(keys('story', { subject: 'Login', related_to: 'ACME-INI-001' }), []);
  });

  it('asks a sub-document for its project or its item, and a plan for what it executes', () => {
    setStructure(PROJECTS);
    assert.deepEqual(keys('analysis', { subject: 'Why' }), ['parent']);
    assert.deepEqual(keys('analysis', { subject: 'Why', project: 'ACME' }), []);
    assert.deepEqual(keys('error', { subject: 'Broke', related_to: 'INI-9' }), []); // its item's project, none included
    assert.deepEqual(keys('plan', { subject: 'Steps', project: 'ACME' }), ['parent']);
    assert.deepEqual(keys('plan', { subject: 'Steps' }), ['parent']); // once, though both are missing
    assert.deepEqual(keys('plan', { subject: 'Steps', related_to: 'ACME-INI-001' }), []);
    assert.deepEqual(keys('plan', { subject: 'Steps', related_to: 'INI-9' }), []); // under an item in no project
  });

  it('asks nothing of a project outside a structure with projects in folders', () => {
    setStructure(FOLDER_PER_TYPE);
    assert.deepEqual(keys('initiative', { subject: 'x' }), []);
  });
});
