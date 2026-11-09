import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bulkPatches } from '../../static/js/bulk.js';

const task = (key, fields) => ({ key, type: 'task', fields });

describe('bulkPatches', () => {
  it('sets a status, clearing a task\'s board list, and undoes to the status each had', () => {
    const { doing, undoing } = bulkPatches([task('a', { status: 'ToDo', list: 'l1' }), { key: 'b', type: 'story', fields: { status: 'Backlog' } }], 'status', 'InProgress');
    assert.deepEqual(doing, [['a', { status: 'InProgress', list: null }], ['b', { status: 'InProgress' }]]);
    assert.deepEqual(undoing, [['a', { status: 'ToDo', list: 'l1' }], ['b', { status: 'Backlog' }]]);
  });

  it('leaves out the items the action would not change', () => {
    const { doing } = bulkPatches([task('a', { priority: 'High' }), task('b', { priority: 'Low' })], 'priority', 'High');
    assert.deepEqual(doing, [['b', { priority: 'High' }]]);
  });

  it('plans over the old plan, clearing a month only where there is one', () => {
    const planValues = (v) => (v === 'today' ? { plan_day: '2026-10-15', plan_week: '2026-W42' } : {});
    const { doing, undoing } = bulkPatches([task('a', { plan_month: '2026-11' }), task('b', { plan_week: '2026-W40' })], 'plan', 'today', { planValues });
    assert.deepEqual(doing, [
      ['a', { plan_day: '2026-10-15', plan_week: '2026-W42', plan_month: null }],
      ['b', { plan_day: '2026-10-15', plan_week: '2026-W42' }],
    ]);
    assert.deepEqual(undoing[0], ['a', { plan_day: null, plan_week: null, plan_month: '2026-11' }]);
    assert.deepEqual(undoing[1], ['b', { plan_day: null, plan_week: '2026-W40' }]);
  });

  it('unplans with no plan value', () => {
    const { doing } = bulkPatches([task('a', { plan_day: '2026-10-15', plan_week: '2026-W42' })], 'plan', null);
    assert.deepEqual(doing, [['a', { plan_day: null, plan_week: null }]]);
  });

  it('archives, and undoes to not archived', () => {
    const { doing, undoing } = bulkPatches([task('a', {})], 'archive');
    assert.deepEqual(doing, [['a', { archived: true }]]);
    assert.deepEqual(undoing, [['a', { archived: false }]]);
  });
  it('adds a label to each item that lacks it, and undoes to the labels each had', () => {
    const { doing, undoing } = bulkPatches([task('a', { labels: ['infra'] }), task('b', {}), task('c', { labels: ['ux', 'infra'] })], 'label', 'ux');
    assert.deepEqual(doing, [['a', { labels: ['infra', 'ux'] }], ['b', { labels: ['ux'] }]]);
    assert.deepEqual(undoing, [['a', { labels: ['infra'] }], ['b', { labels: null }]]);
  });

  it('moves to a project, letting go of a parent that lives in another one', () => {
    const projectOf = (id) => ({ 'INI-1': 'ACME', 'INI-2': 'OPS' })[id] ?? null;
    const { doing, undoing } = bulkPatches([
      task('a', { project: 'OPS', related_to: 'INI-1' }), // its parent is in ACME: kept
      task('b', { project: 'ACME', related_to: 'INI-2' }), // its parent is in OPS: let go
      task('c', { project: 'ACME' }), // already there: left out
    ], 'project', 'ACME', { projectOf });
    assert.deepEqual(doing, [['a', { project: 'ACME' }], ['b', { project: 'ACME', related_to: null }]]);
    assert.deepEqual(undoing, [['a', { project: 'OPS' }], ['b', { project: 'ACME', related_to: 'INI-2' }]]);
  });

  it('takes items out of their project, and lets go of a parent that has one', () => {
    const { doing } = bulkPatches([task('a', { project: 'ACME', related_to: 'INI-1' })], 'project', null, { projectOf: () => 'ACME' });
    assert.deepEqual(doing, [['a', { project: null, related_to: null }]]);
  });
});
