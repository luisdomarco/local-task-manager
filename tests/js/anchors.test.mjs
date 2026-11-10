import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { anchor, anchorPoints, bindingTo, connectable, elbowRoute, nearestSide, snapArrows, targetAt } from '../../static/js/canvas/anchors.js';

const box = (id, x, y, w = 100, h = 60) => ({ id, type: 'rectangle', x, y, width: w, height: h });
const arrow = (id, from, to, extra = {}) => ({ id, type: 'arrow', x: from[0], y: from[1], points: [[0, 0], [to[0] - from[0], to[1] - from[1]]], ...extra });
const abs = (a) => a.points.map(([x, y]) => [a.x + x, a.y + y]);

describe('anchors', () => {
  it('names the side nearest to a point, and its middle, a gap out', () => {
    const b = box('b', 0, 0);
    assert.equal(nearestSide(b, [90, 10]), 'right');
    assert.equal(nearestSide(b, [40, 58]), 'bottom');
    assert.deepEqual(anchor(b, 'top'), [50, -4]);
    assert.deepEqual(anchor(b, 'right', 0), [100, 30]);
  });

  it('puts a straight arrow\'s bound ends at the middles of the nearest sides, and leaves a placed one alone', () => {
    const a = box('a', 0, 0); const b = box('b', 300, 200);
    const arr = arrow('x', [100, 10], [345, 200], { startBinding: { elementId: 'a' }, endBinding: { elementId: 'b' } });
    const [{ id, patch }] = snapArrows([a, b, arr]);
    assert.equal(id, 'x');
    const pts = abs({ ...arr, ...patch });
    assert.deepEqual(pts[0], anchor(a, 'right'));
    assert.deepEqual(pts[pts.length - 1], anchor(b, 'top'));
    assert.deepEqual(snapArrows([a, b, { ...arr, ...patch }]), []); // once there, nothing to do
    assert.deepEqual(snapArrows([a, b, arrow('free', [0, 0], [5, 5])]), []); // an arrow bound to nothing
  });

  it('routes an elbow at right angles from the middles, kept as its fixed points', () => {
    const a = box('a', 0, 0); const b = box('b', 300, 200);
    const arr = arrow('e', [100, 10], [310, 200], { elbowed: true, startBinding: { elementId: 'a', fixedPoint: [1, 0.2] }, endBinding: { elementId: 'b', fixedPoint: [0.4, 0] } });
    const [{ patch }] = snapArrows([a, b, arr]);
    assert.deepEqual([patch.startBinding.fixedPoint, patch.endBinding.fixedPoint], [[1, 0.5], [0.5, 0]]);
    const pts = abs({ ...arr, ...patch });
    for (let i = 1; i < pts.length; i += 1) assert.ok(pts[i][0] === pts[i - 1][0] || pts[i][1] === pts[i - 1][1], 'every leg straight across or down');
    // Excalidraw routes it from there on: with its fixed points at the middles, it is left alone.
    assert.deepEqual(snapArrows([a, b, { ...arr, ...patch, points: [[0, 0], [1, 1]] }]), []);
  });

  it('draws a right-angled path without repeated or needless points', () => {
    assert.deepEqual(elbowRoute([0, 0], 'right', [100, 0], 'left'), [[0, 0], [100, 0]]);
    const r = elbowRoute([0, 0], 'bottom', [100, 100], 'top');
    for (let i = 1; i < r.length; i += 1) assert.ok(r[i][0] === r[i - 1][0] || r[i][1] === r[i - 1][1]);
  });

  it('finds the shape under a point: the topmost, a pad around it, never a card part, a bound text or a line', () => {
    const lane = box('lane', 0, 0, 400, 200);
    const task = box('task', 50, 50);
    const part = { ...box('part', 60, 60, 40, 20), customData: { tmPart: 'title', tmOf: 'g1' } };
    const label = { id: 'label', type: 'text', x: 70, y: 70, width: 20, height: 10, containerId: 'task' };
    const line = { id: 'line', type: 'line', x: 0, y: 0, width: 400, height: 200 };
    const els = [lane, task, part, label, line];
    assert.equal(targetAt(els, [75, 75])?.id, 'task');
    assert.equal(targetAt(els, [300, 150])?.id, 'lane');
    assert.equal(targetAt(els, [155, 80], 0)?.id, 'lane');
    assert.equal(targetAt([task], [155, 80], 0), null);
    assert.equal(targetAt([task], [155, 80], 8)?.id, 'task');
    assert.equal(targetAt(els, [75, 75], 0, 'task')?.id, 'lane');
    assert.equal(targetAt([{ ...task, angle: 0.3 }], [75, 75]), null);
    assert.equal(connectable(label), false);
    assert.equal(connectable({ id: 't', type: 'text', x: 0, y: 0, width: 1, height: 1 }), true);
  });

  it('anchors to a figure by its box, never by its ink or its marks (shapes/kit.js)', () => {
    const fig = (role, type = 'rectangle') => ({ ...box(role, 0, 0, 120, 80), type, customData: { tmShape: 'bpmn-send', tmRole: role } });
    const [outline, mark, ink] = [fig('outline'), fig('mark'), fig('ink', 'ellipse')];
    const boxed = fig('box');
    assert.equal(connectable(outline), true);
    assert.equal(connectable(boxed), true);
    assert.equal(connectable(mark), false);
    assert.equal(connectable(ink), false);
    // A task's envelope over its outline: the task is found under it.
    assert.equal(targetAt([outline, { ...mark, x: 6, y: 6, width: 18, height: 12 }], [10, 10])?.id, 'outline');
  });

  it('puts a dot at the middle of each side, and binds there', () => {
    assert.deepEqual(anchorPoints(box('b', 10, 20, 100, 60)), { top: [60, 20], right: [110, 50], bottom: [60, 80], left: [10, 50] });
    assert.deepEqual(bindingTo(box('b', 0, 0), 'right'), { elementId: 'b', focus: 0, gap: 4, fixedPoint: [1, 0.5] });
  });

  it('routes again an elbow that comes into its side through the shape', () => {
    const a = box('a', 0, 0);
    const b = box('b', 300, 0);
    // Bound at b's right middle, but its last segment goes right: into b from inside.
    const bad = { id: 'x', type: 'arrow', elbowed: true, x: 104, y: 30, points: [[0, 0], [100, 0], [100, -60], [300, -60], [300, 0]],
      startBinding: { elementId: 'a', fixedPoint: [1, 0.5] }, endBinding: { elementId: 'b', fixedPoint: [1, 0.5] }, fixedSegments: [{ index: 2 }] };
    const [fix] = snapArrows([a, b, bad]);
    assert.equal(fix.id, 'x');
    assert.equal(fix.patch.fixedSegments, null);
    assert.deepEqual(fix.patch.endBinding.fixedPoint, [1, 0.5]);
    assert.deepEqual(fix.patch.startBinding.fixedPoint, [1, 0.5]); // its path is then Excalidraw's router's (whiteboard.js reroute)
    // One that comes in the right way is left alone.
    const good = { ...bad, x: 104, y: 30, points: [[0, 0], [20, 0], [20, -60], [320, -60], [320, 0], [300, 0]] };
    assert.equal(snapArrows([a, b, good]).length, 0);
  });
});
