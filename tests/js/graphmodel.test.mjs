import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DOC_TYPE, EDGE_KINDS, NEIGHBOR_KINDS, degrees, describeNode, edgeReading, filterGraph, neighborhood, nodeAddress, nodeByAddress, nodeMatcher } from '../../static/js/graphmodel.js';
import { PROJECTS } from '../../static/js/structure.js';

const RK = PROJECTS.relation_kinds;
const node = (id, type, more = {}) => ({ id, ref: more.ref || id, type, title: more.title || `Title ${id}`, path: more.path || `${id}.md`, status: null, done: false, project: 'ECD', ...more });
// A project ECD with an initiative, two stories (one blocked by the other), a closed task, a doc, a project of its own.
const G = {
  nodes: [
    node('ECD', 'project', { project: null, title: 'Checkout' }), node('1', 'initiative', { ref: 'INI-1' }),
    node('2', 'story', { ref: 'STY-2' }), node('3', 'story', { ref: 'STY-3' }), node('4', 'task', { ref: 'TSK-4', done: true }),
    node('Docs/Guide.md', DOC_TYPE, { project: null, ref: 'Guide', title: 'Guide', path: 'Docs/Guide.md' }),
    node('HB', 'project', { project: null, title: 'Harness' }), node('9', 'note', { ref: 'NOTE-9', project: 'HB' }),
    node('Docs/Lonely.md', DOC_TYPE, { project: null, ref: 'Lonely', title: 'Lonely', path: 'Docs/Lonely.md' }),
  ],
  edges: [
    { source: '1', target: 'ECD', kind: 'project', field: 'project' },
    { source: '2', target: '1', kind: 'parent', field: 'related_to' },
    { source: '3', target: '1', kind: 'parent', field: 'related_to' },
    { source: '3', target: '2', kind: 'relation', field: 'depends_on', relation: 'blocked' },
    { source: '4', target: '3', kind: 'parent', field: 'related_to' },
    { source: 'Docs/Guide.md', target: '1', kind: 'mention' },
    { source: '9', target: 'HB', kind: 'project', field: 'project' },
    { source: '1', target: '9', kind: 'link', field: 'origin' },
  ],
};
const idsOf = (g) => g.nodes.map((n) => n.id).sort();

describe('the graph the view draws: its filters', () => {
  it('with nothing asked, everything', () => {
    assert.deepEqual(filterGraph(G), G);
  });

  it('a type left out takes its edges with it', () => {
    const g = filterGraph(G, { types: new Set(['project', 'initiative', 'story', 'note', DOC_TYPE]) });
    assert.ok(!idsOf(g).includes('4'));
    assert.ok(g.edges.every((e) => e.source !== '4' && e.target !== '4'));
  });

  it('closed items go when asked, and the kinds of link on show are the ones picked', () => {
    assert.ok(!idsOf(filterGraph(G, { done: false })).includes('4'));
    const g = filterGraph(G, { kinds: new Set(['relation']) });
    assert.deepEqual(g.edges.map((e) => e.kind), ['relation']);
    assert.equal(g.nodes.length, G.nodes.length, 'with orphans on, a node with no edge left stays');
    assert.deepEqual(idsOf(filterGraph(G, { kinds: new Set(['relation']), orphans: false })), ['2', '3']);
  });

  it('a project: its items and itself, and the docs tied to them; not another project\'s', () => {
    const g = filterGraph(G, { project: 'ECD' });
    assert.deepEqual(idsOf(g), ['1', '2', '3', '4', 'Docs/Guide.md', 'ECD']);
    assert.ok(!g.edges.some((e) => e.target === '9'), 'its tie to another project\'s note goes with that note');
  });

  it('a focus: what is within its steps, through what is on show; the focus stays whatever the filters say', () => {
    const one = filterGraph(G, { focus: '3', depth: 1 });
    assert.deepEqual(idsOf(one), ['1', '2', '3', '4']);
    assert.deepEqual(Object.fromEntries(one.nodes.map((n) => [n.id, n.depth])), { 1: 1, 2: 1, 3: 0, 4: 1 });
    const two = filterGraph(G, { focus: '3', depth: 2 });
    assert.ok(idsOf(two).includes('Docs/Guide.md') && idsOf(two).includes('ECD'));
    const alone = filterGraph(G, { focus: '4', types: new Set(['story']), done: false });
    assert.deepEqual(idsOf(alone), ['3', '4'], 'a closed task left out by the filters is still the centre');
    assert.deepEqual(filterGraph(G, { focus: 'gone' }), { nodes: [], edges: [] });
  });
});

describe('around one node, and finding one', () => {
  it('neighborhood follows edges either way; the local graph does not go through the project', () => {
    const g = neighborhood(G, '2', 1, NEIGHBOR_KINDS);
    assert.deepEqual(idsOf(g), ['1', '2', '3']);
    assert.ok(idsOf(neighborhood(G, '1', 1, EDGE_KINDS)).includes('ECD'));
    assert.ok(!idsOf(neighborhood(G, '1', 1, NEIGHBOR_KINDS)).includes('ECD'));
    assert.deepEqual(neighborhood(G, 'gone'), { nodes: [], edges: [] });
  });

  it('degrees count every edge at both ends', () => {
    const d = degrees(G);
    assert.equal(d.get('1'), 5);
    assert.equal(d.get('Docs/Lonely.md'), 0);
  });

  it('an address names a node by its ref, id or path, and a node is addressed by its ref', () => {
    assert.equal(nodeByAddress(G, 'STY-2').id, '2');
    assert.equal(nodeByAddress(G, 'ECD').id, 'ECD');
    assert.equal(nodeByAddress(G, 'Docs/Guide.md').id, 'Docs/Guide.md');
    assert.equal(nodeByAddress(G, 'nope'), null);
    assert.equal(nodeAddress(G.nodes[2]), 'STY-2');
    assert.equal(nodeAddress(G.nodes[5]), 'Docs/Guide.md', 'a doc by its path');
    assert.equal(nodeAddress({ id: 'Acme/Plans/Plan.md', ref: 'Plan', title: 'Plan', type: 'plan' }), 'Acme/Plans/Plan.md', 'an item with no id by its file');
  });
});

describe('how an edge reads, from either end', () => {
  it('a relation reads its kind from the item that keeps it, its inverse from the other', () => {
    const blocked = G.edges[3];
    assert.equal(edgeReading(blocked, '3', RK), 'Blocked by');
    assert.equal(edgeReading(blocked, '2', RK), 'Blocks');
    assert.equal(edgeReading({ source: 'a', target: 'b', kind: 'relation', relation: 'precedes' }, 'b', RK), 'Follows');
  });

  it('the rest by what they are', () => {
    assert.equal(edgeReading(G.edges[1], '2'), 'Child of');
    assert.equal(edgeReading(G.edges[1], '1'), 'Parent of');
    assert.equal(edgeReading(G.edges[5], 'Docs/Guide.md'), 'Mentions');
    assert.equal(edgeReading(G.edges[5], '1'), 'Mentioned by');
    assert.equal(edgeReading(G.edges[7], '1', null, (f) => f.toUpperCase()), 'ORIGIN');
    assert.equal(edgeReading(G.edges[7], '9', null, () => 'Origin'), 'Origin of');
  });

  it('a tooltip: its name, ref, type and status, and its ties read from it', () => {
    const d = describeNode({ ...G.nodes[3], status: 'InProgress' }, G, { relationKinds: RK, typeLabel: (t) => t.toUpperCase(), statusLabel: (s) => s.toLowerCase() });
    assert.equal(d.title, 'Title 3');
    assert.equal(d.meta, 'STY-3 · STORY · inprogress');
    assert.deepEqual(d.lines, ['Child of INI-1 Title 1', 'Blocked by STY-2 Title 2', 'Parent of TSK-4 Title 4']);
    const few = describeNode(G.nodes[1], G, { max: 2 });
    assert.equal(few.lines.length, 3);
    assert.equal(few.lines[2], 'and 3 more');
    assert.equal(describeNode(G.nodes[0], G).meta, 'ECD · project', 'a project by its key');
    assert.equal(describeNode(G.nodes[5], G).meta, 'doc', 'a doc, whose ref is its title, shows it once');
  });
});

describe('the graph search (Filters → Search, and a group\'s query)', () => {
  const ids = (q, opts) => G.nodes.filter(nodeMatcher(q, opts)).map((n) => n.id);

  it('matches every word against the title, the ref or the path, in any case', () => {
    assert.deepEqual(ids('sty'), ['2', '3']);
    assert.deepEqual(ids('docs guide'), ['Docs/Guide.md']);
    assert.equal(ids('').length, G.nodes.length, 'an empty search matches all');
  });

  it('reads type:, status:, path: and project:, and - for what must not match', () => {
    assert.deepEqual(ids('type:story'), ['2', '3']);
    assert.deepEqual(ids('type:Stories', { typeLabel: (t) => (t === 'story' ? 'Stories' : t) }), ['2', '3']);
    assert.deepEqual(ids('status:done'), ['4']);
    assert.deepEqual(ids('path:docs/'), ['Docs/Guide.md', 'Docs/Lonely.md']);
    assert.deepEqual(ids('project:hb'), ['HB', '9']);
    assert.deepEqual(ids('type:story -STY-3'), ['2']);
    assert.deepEqual(ids('"title 2"'), ['2']);
  });

  it('filters the graph to what it matches, with the edges between them', () => {
    const g = filterGraph(G, { query: 'type:story' });
    assert.deepEqual(idsOf(g), ['2', '3']);
    assert.deepEqual(g.edges.map((e) => `${e.source}>${e.target}`), ['3>2']);
  });
});
