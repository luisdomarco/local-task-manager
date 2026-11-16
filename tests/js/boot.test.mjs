import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { entryType, homeHash, progressLabel, stages, typeLoaded, welcomeFor } from '../../static/js/boot.js';

const types = (...names) => names.map((name) => ({ name }));

describe('opening a vault a stage at a time (TSK-128)', () => {
  const projects = {
    types: types('task', 'inbox', 'project', 'note', 'contact'),
    boot_order: [['Inbox', ['inbox']], ['Projects', ['project']], ['Gone', ['prd']], ['Tasks', ['task']], ['Notes', ['note']]],
  };

  it('loads the structure\'s stages, the types it has; one it does not name joins the last', () => {
    assert.deepEqual(stages(projects), [
      { label: 'Inbox', types: ['inbox'] }, { label: 'Projects', types: ['project'] },
      { label: 'Tasks', types: ['task'] }, { label: 'Notes', types: ['note', 'contact'] }]); // prd turned off: no stage
  });

  it('loads a structure without stages (a legacy vault) in one go', () => {
    assert.deepEqual(stages({ types: types('task', 'inbox') }), [{ label: 'Items', types: ['task', 'inbox'] }]);
    assert.deepEqual(stages({ types: [] }), []);
  });

  it('opens the Inbox from the welcome screen, wherever it is in the first stage', () => {
    assert.equal(entryType(stages(projects)), 'inbox');
    assert.equal(entryType(stages({ types: types('task', 'inbox') })), 'inbox');
    assert.equal(entryType([{ label: 'Tasks', types: ['task'] }]), 'task');
    assert.equal(entryType([]), null);
  });

  it('says what is in and what comes next, and nothing once all is in', () => {
    const plan = stages(projects);
    assert.equal(progressLabel(plan, 0), 'Inbox…');
    assert.equal(progressLabel(plan, 2), 'Inbox ✓ · Projects ✓ · Tasks…');
    assert.equal(progressLabel(plan, 4), '');
  });

  it('counts every type as in once the page has them all', () => {
    assert.equal(typeLoaded('task', null), true);
    assert.equal(typeLoaded('task', new Set(['inbox'])), false);
    assert.equal(typeLoaded('inbox', new Set(['inbox'])), true);
  });

  it('opens on the welcome screen with no address or with a share, never over an address of its own', () => {
    for (const hash of ['', '#', '#/']) assert.equal(welcomeFor(hash, false), true, hash);
    assert.equal(welcomeFor('#/inbox', true), true); // a share: the welcome, then the Inbox once it is in
    assert.equal(welcomeFor('#/tasks', false), false);
    assert.equal(welcomeFor('#/item/TSK-1', false), false);
  });

  it('once it is all in, the welcome screen gives way to Today, or the List where nothing is planned', () => {
    assert.equal(homeHash({ types: [{ id: 'inbox' }, { id: 'task', plannable: true }] }), '#/today');
    assert.equal(homeHash({ types: [{ id: 'note' }] }), '#/table');
    assert.equal(homeHash(null), '#/table');
  });
});
