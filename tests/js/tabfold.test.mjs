import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_TABS, foldTabs } from '../../static/js/tabfold.js';

const own = (key) => ({ key, own: true });
const group = (key, used = false) => ({ key, used });
const canvas = { key: 'canvas', pinned: true };
const OWN = ['description', 'settings', 'files', 'links', 'docs'].map(own);
const project = ({ briefs = false, records = false, issues = false } = {}) =>
  [...OWN, group('initiatives'), group('issues', issues), group('briefs', briefs), group('records', records), canvas];

describe('an item\'s tab bar', () => {
  it('shows seven, Canvas beyond them, the rest in "+"', () => {
    assert.equal(MAX_TABS, 7);
    assert.deepEqual(foldTabs(project()), {
      shown: ['description', 'settings', 'files', 'links', 'docs', 'initiatives', 'issues', 'canvas'],
      hidden: ['briefs', 'records'],
    });
  });

  it('shows a group with an item of its kinds beyond the seven, in its place', () => {
    assert.deepEqual(foldTabs(project({ briefs: true })), {
      shown: ['description', 'settings', 'files', 'links', 'docs', 'initiatives', 'issues', 'briefs', 'canvas'],
      hidden: ['records'],
    });
    // Used or not, a group within the seven keeps its place; one used never pushes another out.
    assert.deepEqual(foldTabs(project({ issues: true, records: true })).hidden, ['briefs']);
  });

  it('shows the tab open now, and those picked from "+", while the detail stays open', () => {
    assert.deepEqual(foldTabs(project(), { active: 'records' }).hidden, ['briefs']);
    assert.deepEqual(foldTabs(project(), { opened: new Set(['briefs']) }).hidden, ['records']);
    assert.deepEqual(foldTabs(project(), { active: 'briefs', opened: new Set(['records']) }).hidden, []);
  });

  it('folds nothing when they fit', () => {
    const story = [...OWN, group('issues'), canvas];
    assert.deepEqual(foldTabs(story), { shown: story.map((t) => t.key), hidden: [] });
    assert.deepEqual(foldTabs([own('description')]), { shown: ['description'], hidden: [] });
  });

  it('never folds its own sections, nor Canvas, however few the room', () => {
    assert.deepEqual(foldTabs(project(), { max: 3 }), {
      shown: ['description', 'settings', 'files', 'links', 'docs', 'canvas'],
      hidden: ['initiatives', 'issues', 'briefs', 'records'],
    });
    assert.deepEqual(foldTabs(project({ records: true }), { max: 6 }).shown,
      ['description', 'settings', 'files', 'links', 'docs', 'initiatives', 'records', 'canvas']);
  });
});
