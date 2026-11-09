import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULTS, createSimulation, fit, forceOptions, nearest, unclutter, zoomAt } from '../../static/js/graphlayout.js';

const ids = (n) => Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));
const dist = (sim, a, b) => Math.hypot(sim.x[sim.index.get(a)] - sim.x[sim.index.get(b)], sim.y[sim.index.get(a)] - sim.y[sim.index.get(b)]);

describe('the graph layout: forces, settled, the same picture each time', () => {
  it('the same graph lays out the same way, to the last digit', () => {
    const nodes = ids(30);
    const edges = nodes.slice(1).map((n, i) => ({ source: `n${Math.floor(i / 3)}`, target: n.id }));
    const a = createSimulation(nodes, edges); a.run(300);
    const b = createSimulation(nodes, edges); b.run(300);
    assert.deepEqual([...a.x], [...b.x]);
    assert.deepEqual([...a.y], [...b.y]);
    assert.ok(a.settled());
  });

  it('linked nodes end near each other, unlinked ones apart', () => {
    const nodes = ids(6);
    const edges = [{ source: 'n0', target: 'n1' }, { source: 'n1', target: 'n2' }, { source: 'n3', target: 'n4' }];
    const sim = createSimulation(nodes, edges);
    sim.run(400);
    assert.ok(dist(sim, 'n0', 'n1') < 80, `a link pulls to about its distance (${dist(sim, 'n0', 'n1')})`);
    assert.ok(dist(sim, 'n0', 'n1') > 15, 'and the push keeps them from sitting on each other');
    assert.ok(dist(sim, 'n0', 'n3') > dist(sim, 'n0', 'n1'), 'two islands stay apart');
    for (let i = 0; i < 6; i++) assert.ok(Number.isFinite(sim.x[i]) && Number.isFinite(sim.y[i]));
  });

  it('nodes on one spot are parted, and an edge to a node not there is left out', () => {
    const nodes = ids(5);
    const prev = new Map(nodes.map((n) => [n.id, { x: 0, y: 0 }]));
    const sim = createSimulation(nodes, [{ source: 'n0', target: 'gone' }, { source: 'n1', target: 'n1' }], { prev });
    assert.equal(sim.links.length, 0);
    sim.run(200);
    for (let i = 1; i < 5; i++) assert.ok(dist(sim, 'n0', `n${i}`) > 5, `n${i} left n0's spot`);
  });

  it('a node that was there keeps its place; a new one starts by its neighbour', () => {
    const nodes = ids(3);
    const edges = [{ source: 'n0', target: 'n1' }, { source: 'n1', target: 'n2' }];
    const first = createSimulation(nodes, edges); first.run(300);
    const prev = first.positions();
    const next = createSimulation([...nodes, { id: 'n3' }], [...edges, { source: 'n2', target: 'n3' }], { prev });
    assert.equal(next.x[next.index.get('n0')], prev.get('n0').x); // before a tick, exactly where it was
    assert.ok(dist(next, 'n2', 'n3') < 40, 'the newcomer starts by the node it is tied to');
    assert.ok(next.alpha < 1, 'and a graph mostly placed warms up gently, not from scratch');
    const again = createSimulation(nodes, edges, { prev });
    again.run(300);
    assert.ok(Math.abs(again.x[0] - prev.get('n0').x) < 5, 'nothing new: it barely moves');
  });

  it('a weight of 0 draws the edge but leaves the layout alone', () => {
    const nodes = ids(2);
    const sim = createSimulation(nodes, [{ source: 'n0', target: 'n1', kind: 'project' }], { weight: (e) => (e.kind === 'project' ? 0 : 1) });
    assert.equal(sim.links.length, 0);
  });

  it('a node held while dragged stays where the pointer is, and goes on moving once let go', () => {
    const nodes = ids(4);
    const sim = createSimulation(nodes, [{ source: 'n0', target: 'n1' }, { source: 'n0', target: 'n2' }]);
    sim.run(100);
    sim.fix(0, 500, -500);
    sim.reheat(0.5);
    for (let k = 0; k < 20; k++) sim.tick();
    assert.deepEqual([sim.x[0], sim.y[0]], [500, -500]);
    assert.ok(dist(sim, 'n0', 'n1') < 300, 'its neighbours follow it');
    sim.release(0);
    sim.tick();
    assert.notDeepEqual([sim.x[0], sim.y[0]], [500, -500]);
  });

  it('a few thousand nodes lay out in reasonable time (Barnes–Hut, not every pair)', () => {
    const nodes = ids(2000);
    const edges = nodes.slice(1).map((n, i) => ({ source: `n${Math.floor(i / 4)}`, target: n.id }));
    const sim = createSimulation(nodes, edges);
    const t0 = Date.now();
    for (let k = 0; k < 30; k++) sim.tick();
    const ms = (Date.now() - t0) / 30;
    assert.ok(ms < 60, `a tick of 2000 nodes took ${ms.toFixed(1)} ms`);
  });
});

describe('the view on the layout: fit, zoom, the node under the pointer', () => {
  it('fit frames every point inside the box, its padding kept', () => {
    const xs = [-100, 50, 300];
    const ys = [-20, 80, 40];
    const v = fit(xs, ys, 800, 400, { pad: 20 });
    for (let i = 0; i < 3; i++) {
      const sx = xs[i] * v.k + v.tx;
      const sy = ys[i] * v.k + v.ty;
      assert.ok(sx >= 19.99 && sx <= 780.01 && sy >= 19.99 && sy <= 380.01, `point ${i} at ${sx},${sy}`);
    }
    assert.deepEqual(fit([], [], 200, 100), { k: 1, tx: 100, ty: 50 });
    assert.equal(fit([5], [5], 200, 100, { maxK: 2 }).k, 2, 'one node is not blown up to the box');
  });

  it('zoomAt keeps the point under the pointer where it is, within its limits', () => {
    const v = { k: 1, tx: 10, ty: 20 };
    const z = zoomAt(v, 2, 110, 70);
    const wx = (110 - v.tx) / v.k;
    assert.equal(wx * z.k + z.tx, 110);
    assert.equal(zoomAt({ k: 5, tx: 0, ty: 0 }, 10, 0, 0, { maxK: 6 }).k, 6);
  });

  it('nearest finds the node within its radius, the closest one first, else none', () => {
    const sim = createSimulation(ids(3), [], { prev: new Map([['n0', { x: 0, y: 0 }], ['n1', { x: 10, y: 0 }], ['n2', { x: 100, y: 100 }]]) });
    assert.equal(nearest(sim, 3, 0, () => 8), 0);
    assert.equal(nearest(sim, 8, 0, () => 8), 1);
    assert.equal(nearest(sim, 50, 50, () => 8), -1);
  });
});

describe('labels that never cover each other', () => {
  it('a label over one kept before it is left out; the first ones win', () => {
    const boxes = [{ x: 0, y: 0, w: 100, h: 14 }, { x: 50, y: 5, w: 100, h: 14 }, { x: 0, y: 20, w: 100, h: 14 }, { x: 300, y: 0, w: 40, h: 14 }];
    assert.deepEqual([...unclutter(boxes)], [0, 2, 3]);
    assert.deepEqual([...unclutter([boxes[1], boxes[0]])], [0], 'the order is the priority');
    assert.deepEqual([...unclutter([])], []);
  });

  it('boxes spanning several cells of the grid still meet', () => {
    const wide = { x: 10, y: 10, w: 500, h: 14 };
    const far = { x: 400, y: 12, w: 30, h: 14 }; // in a cell the wide one reaches, not its first
    assert.deepEqual([...unclutter([wide, far])], [0]);
  });
});

describe('the Forces sliders', () => {
  it('are multiples of the defaults, 1 each by default', () => {
    assert.deepEqual(forceOptions(), { gravity: DEFAULTS.gravity, charge: DEFAULTS.charge, linkStrength: 1, distance: DEFAULTS.distance });
    const o = forceOptions({ center: 2, repel: 0.5, link: 0, distance: 3 });
    assert.equal(o.gravity, DEFAULTS.gravity * 2);
    assert.equal(o.charge, DEFAULTS.charge * 0.5);
    assert.equal(o.linkStrength, 0);
    assert.equal(o.distance, DEFAULTS.distance * 3);
    assert.equal(forceOptions({ repel: -1 }).charge, DEFAULTS.charge, 'a value out of range: the default');
  });

  it('change a running layout: a longer link distance spreads two linked nodes', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }];
    const edges = [{ source: 'a', target: 'b' }];
    const gap = (sim) => Math.hypot(sim.x[0] - sim.x[1], sim.y[0] - sim.y[1]);
    const near = createSimulation(nodes, edges, forceOptions());
    near.run(400);
    const far = createSimulation(nodes, edges, forceOptions());
    far.set(forceOptions({ distance: 3 }));
    far.run(400);
    assert.ok(gap(far) > gap(near) * 1.5, `${gap(far)} vs ${gap(near)}`);
  });
});
