import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { kindLabel, kindOf, kinded, relatedIn, relationWrites } from '../../static/js/relkinds.js';
import { FOLDER_PER_TYPE } from '../../static/js/structure.js';

const RK = FOLDER_PER_TYPE.relation_kinds;
const item = (id, type, relations = [], kinds = {}, more = {}) => ({ id, type, key: id, fields: { relations, relation_kinds: kinds, ...more } });
const none = () => false;

describe('relation kinds (Redmine): kept on one item, seen inverse from the other', () => {
  it('the structure carries one catalogue, in its order, for every type that can be related', () => {
    assert.deepEqual(RK.kinds.map(([, l]) => l), ['Related to', 'Blocked by (depends on)', 'Blocks', 'Precedes', 'Follows',
      'Duplicates', 'Duplicated by', 'Copied to', 'Copied from']);
    assert.ok(kinded(RK, 'task', 'story'));
    assert.ok(kinded(RK, 'task', 'note')); // a note's relations have kinds too
    assert.ok(!kinded(RK, 'task', 'prompt')); // a prompt is never related
    assert.ok(!kinded(undefined, 'task', 'story'));
    assert.equal(kindLabel(RK, 'blocked'), 'Blocked by (depends on)');
    assert.equal(RK.fields, undefined); // the folder-per-type structure keeps every kind in relation_kinds
  });

  it('a kind is the keeper\'s, and its inverse from the other side; none is "relates"', () => {
    const t = item('TSK-0001', 'task', ['US-0001', 'NOTE-0001'], { 'US-0001': 'precedes' });
    const s = item('US-0001', 'story');
    assert.equal(kindOf(t, s, RK), 'precedes');
    assert.equal(kindOf(s, t, RK), 'follows');
    assert.equal(kindOf(t, item('NOTE-0001', 'note'), RK), 'relates');
  });

  it('a change is written on whichever keeps the relation, stored as that side sees it, with what puts it back', () => {
    const t = item('TSK-0001', 'task', ['US-0001'], { 'US-0001': 'blocks' });
    const s = item('US-0001', 'story');
    const [w] = relationWrites(s, t, 'follows', RK, none); // the story follows the task: the task, which keeps it, precedes the story
    assert.equal(w.holder, t);
    assert.deepEqual(w.values, { relation_kinds: { 'US-0001': 'precedes' } }); // its relations stay as they were
    assert.deepEqual(w.was, { relation_kinds: { 'US-0001': 'blocks' } });
    assert.deepEqual(relationWrites(t, s, 'relates', RK, none)[0].values, { relation_kinds: {} }); // the default is not kept
  });

  it('a new one goes on the item it is added from; none takes it off wherever it was', () => {
    const a = item('TSK-0001', 'task', ['TSK-0009']);
    const b = item('US-0001', 'story');
    const [add] = relationWrites(a, b, 'blocked', RK, none);
    assert.equal(add.holder, a);
    assert.deepEqual(add.values, { relations: ['TSK-0009', 'US-0001'], relation_kinds: { 'US-0001': 'blocked' } });
    const kept = item('US-0001', 'story', ['TSK-0001'], { 'TSK-0001': 'duplicates' });
    const [off] = relationWrites(a, kept, null, RK, none);
    assert.equal(off.holder, kept);
    assert.deepEqual(off.values, { relations: [], relation_kinds: {} });
    assert.deepEqual(off.was, { relations: ['TSK-0001'], relation_kinds: { 'TSK-0001': 'duplicates' } });
  });
});

describe('a kind kept in a field of its own (Projects: Blocked by is depends_on)', () => {
  const PK = { ...RK, fields: { blocked: 'depends_on' } };
  const has = (type, field, other) => field === 'depends_on' && ['initiative', 'story'].includes(type) && other !== 'project';
  const sty = (id, dep = [], relations = [], kinds = {}) => item(id, 'story', relations, kinds, { depends_on: dep });

  it('is read both ways and counts as related', () => {
    const a = sty('ACME-STY-001', ['ACME-STY-002']);
    const b = sty('ACME-STY-002');
    assert.equal(kindOf(a, b, PK), 'blocked');
    assert.equal(kindOf(b, a, PK), 'blocks');
    assert.deepEqual(relatedIn(b, [a, b], PK).map((i) => i.id), ['ACME-STY-001']);
  });

  it('Blocked by and Blocks are written in depends_on of the one that waits, when its type has the field', () => {
    const a = sty('ACME-STY-001');
    const b = sty('ACME-STY-002');
    assert.deepEqual(relationWrites(a, b, 'blocked', PK, has).map((w) => [w.holder.id, w.values]), [['ACME-STY-001', { depends_on: ['ACME-STY-002'] }]]);
    assert.deepEqual(relationWrites(a, b, 'blocks', PK, has).map((w) => [w.holder.id, w.values]), [['ACME-STY-002', { depends_on: ['ACME-STY-001'] }]]);
    const hfx = item('ACME-HFX-001', 'hotfix'); // no depends_on: kept in its relations
    assert.deepEqual(relationWrites(hfx, b, 'blocked', PK, has).map((w) => [w.holder.id, w.values]),
      [['ACME-HFX-001', { relations: ['ACME-STY-002'], relation_kinds: { 'ACME-STY-002': 'blocked' } }]]);
    const prj = item('ACME', 'project'); // a story's depends_on does not name projects: kept in the project's relations
    assert.deepEqual(relationWrites(prj, b, 'blocks', PK, has).map((w) => [w.holder.id, w.values]),
      [['ACME', { relations: ['ACME-STY-002'], relation_kinds: { 'ACME-STY-002': 'blocks' } }]]);
  });

  it('a kind that moves between depends_on and relations changes both items, and Undo puts both back', () => {
    const a = sty('ACME-STY-001', ['ACME-STY-002']);
    const b = sty('ACME-STY-002');
    const writes = relationWrites(a, b, 'precedes', PK, has);
    assert.deepEqual(writes.map((w) => [w.holder.id, w.values, w.was]), [
      ['ACME-STY-001', { depends_on: [], relations: ['ACME-STY-002'], relation_kinds: { 'ACME-STY-002': 'precedes' } },
        { depends_on: ['ACME-STY-002'], relations: [], relation_kinds: {} }]]);
    const back = relationWrites(sty('ACME-STY-001', [], ['ACME-STY-002'], { 'ACME-STY-002': 'precedes' }), b, 'blocks', PK, has);
    assert.deepEqual(back.map((w) => [w.holder.id, w.values]), [
      ['ACME-STY-001', { relations: [], relation_kinds: {} }], ['ACME-STY-002', { depends_on: ['ACME-STY-001'] }]]);
  });
});
