import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canvasHost, canvasItems, openItems } from '../../static/js/canvas/itemcanvas.js';

const it_ = (id, type, fields = {}, extra = {}) => ({ key: `k${id}`, id, type, ref: id, title: id, fields, ...extra });

describe('an item\'s canvases', () => {
  it('are kept by its ref, a project\'s by its key', () => {
    assert.equal(canvasHost(it_('STY-482', 'story')), 'STY-482');
    assert.equal(canvasHost(it_('ACME-STY-001', 'story')), 'ACME-STY-001'); // a long id, before short ids
    assert.equal(canvasHost({ key: 'p', type: 'project', fields: { project_key: 'ACME' } }), 'ACME');
    assert.equal(canvasHost({ key: 'n', type: 'task', fields: {} }), '');
    assert.equal(canvasHost(it_('../x', 'task')), '');
  });

  it('offer what hangs from it at any depth, still open, never its own records of activity', () => {
    const ini = it_('INI-1', 'initiative', { project: 'ACME' });
    const sty = it_('STY-2', 'story', { project: 'ACME', related_to: 'INI-1' });
    const task = it_('TSK-3', 'task', { related_to: 'STY-2' });
    const done = it_('TSK-4', 'task', { related_to: 'STY-2', status: 'Done' });
    const act = it_('ACT-5', 'activity', { related_to: 'INI-1' });
    const other = it_('STY-6', 'story', { project: 'OPS', related_to: 'INI-9' });
    const loop = [it_('TSK-7', 'task', { related_to: 'TSK-8' }), it_('TSK-8', 'task', { related_to: 'TSK-7' })]; // a cycle ends
    const items = [ini, sty, task, done, act, other, ...loop];
    const byId = new Map(items.map((k) => [k.id, k]));
    const isDone = (k) => k.fields.status === 'Done';
    const ids = (host) => canvasItems(host, items, byId, isDone).map((k) => k.id);
    assert.deepEqual(ids(ini), ['STY-2', 'TSK-3']);
    assert.deepEqual(ids(sty), ['TSK-3']);
    assert.deepEqual(ids(task), []);
    assert.deepEqual(ids({ key: 'p', type: 'project', fields: { project_key: 'ACME' } }), ['INI-1', 'STY-2']);
    // A free canvas: every open one with an id, never an activity.
    assert.deepEqual(openItems([...items, { key: 'np', type: 'project', fields: {} }], isDone).map((k) => k.id),
      ['INI-1', 'STY-2', 'TSK-3', 'STY-6', 'TSK-7', 'TSK-8']);
  });
});
