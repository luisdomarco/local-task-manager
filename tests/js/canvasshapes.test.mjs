import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATEGORIES, SHAPES, search } from '../../static/js/canvas/shapes/index.js';
import { BOX_FILL, INK, NONE, PAPER, boxRepairs } from '../../static/js/canvas/shapes/kit.js';
import { thumbSvg } from '../../static/js/canvas/shapes/thumb.js';

const all = CATEGORIES.flatMap((c) => c.shapes);
const lines = (s) => s.skeleton().every((p) => p.type === 'arrow' || p.type === 'line' || p.type === 'text');

describe('the shapes panel\'s catalog', () => {
  it('has General, the arrows, BPMN 2.0 and Flowchart, each figure once', () => {
    assert.deepEqual(CATEGORIES.map((c) => c.key), ['general', 'arrows', 'bpmn-activities', 'bpmn-events', 'bpmn-gateways', 'bpmn-data', 'bpmn-flows', 'flowchart']);
    assert.equal(SHAPES.size, all.length, 'an id twice');
    assert.ok(all.length > 120);
    for (const name of ['Hexagon', 'Cylinder', 'Cloud', 'Actor', 'User task', 'Timer catch event', 'Error end event', 'Exclusive gateway', 'Pool', 'Message flow', 'Terminator', 'Manual input']) {
      assert.ok(all.some((s) => s.name === name), name);
    }
  });

  it('gives each figure a size, and a box an arrow binds to — or is one line, or one text', () => {
    for (const s of all) {
      assert.ok(s.w > 0 && s.h >= 0, s.id);
      const parts = s.skeleton(100, 50);
      for (const p of parts) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${s.id}: a part with no place`);
      if (lines(s)) continue;
      const boxes = parts.filter((p) => ['box', 'outline'].includes(p.customData?.tmRole));
      assert.equal(boxes.length, 1, `${s.id}: one box`);
      const [b] = boxes;
      assert.ok(['rectangle', 'diamond', 'ellipse'].includes(b.type), s.id);
      assert.deepEqual([b.x, b.y, b.width, b.height], [100, 50, s.w, s.h], `${s.id}: its box is the figure`);
      if (b.customData.tmRole === 'box') {
        assert.equal(b.backgroundColor, BOX_FILL, s.id);
        assert.equal(b.strokeColor, NONE, s.id);
        assert.equal(parts.at(-1 - (parts.at(-1).type === 'text' && parts.at(-1).customData?.tmRole === 'ink' ? 1 : 0)), b, `${s.id}: its box on top of its ink`);
      } else assert.equal(parts[0], b, `${s.id}: its outline under its ink`);
    }
  });

  it('draws in draw.io\'s way: white, a 1 px black line, square corners (the rounded ones by name)', () => {
    for (const s of all) {
      for (const p of s.skeleton()) {
        if (p.type === 'text' || p.customData?.tmRole === 'box') continue;
        assert.equal(p.roughness, 0, s.id);
        if (!/sticky/.test(s.id)) assert.ok([INK, PAPER].includes(p.strokeColor), `${s.id}: ${p.strokeColor}`);
        if (p.roundness) assert.ok(/rounded|bpmn-(task|user|service|send|receive|manual|rule|script|call|sub|loop|parallel-mi|sequential-mi|adhoc|transaction|event-sub|expanded|group)/.test(s.id), `${s.id} is round`);
      }
    }
    const rect = SHAPES.get('rect').skeleton()[0];
    assert.deepEqual([rect.strokeColor, rect.strokeWidth, rect.backgroundColor, rect.roundness], [INK, 1, PAPER, null]);
  });

  it('keeps a figure of several parts in one group, and a lone part out of any', () => {
    for (const s of all) {
      const parts = s.skeleton();
      const groups = new Set(parts.map((p) => (p.groupIds || []).join('|')));
      assert.equal(groups.size, 1, s.id);
      if (parts.length > 1) assert.notEqual([...groups][0], '', s.id);
      else assert.equal([...groups][0], '', s.id);
    }
  });

  it('finds figures by every word of a search, in their name, keywords or family', () => {
    const names = (q) => search(q).flatMap((c) => c.shapes.map((s) => s.name));
    assert.ok(names('gateway').includes('Parallel gateway'));
    assert.ok(names('timer catch').includes('Timer catch event'));
    assert.ok(names('flowchart database').includes('Database'));
    assert.deepEqual(names('nothing like it'), []);
    assert.equal(search('').length, CATEGORIES.length);
  });

  it('draws each figure\'s picture from the same parts, its ink in the page\'s colour, its box unseen', () => {
    for (const s of all) {
      const svg = thumbSvg(s);
      assert.match(svg, /^<svg [^>]*viewBox="[-\d. ]+"/, s.id);
      assert.ok(!svg.includes('NaN') && !svg.includes(BOX_FILL), s.id);
    }
    assert.match(thumbSvg(SHAPES.get('hexagon')), /<polygon points="[^"]+" style="fill:var\(--shape-paper, #fff\)" stroke="currentColor"/);
    assert.match(thumbSvg(SHAPES.get('container')), />Container<\/text>/);
  });
});

describe('a figure\'s box', () => {
  const group = ['g1'];
  const box = (o = {}) => ({ id: 'b', type: 'rectangle', backgroundColor: BOX_FILL, strokeColor: NONE, groupIds: group, customData: { tmRole: 'box' }, ...o });
  const ink = { id: 'i', type: 'line', backgroundColor: PAPER, strokeColor: INK, groupIds: group, customData: { tmRole: 'ink' } };
  const rim = { id: 'r', type: 'line', backgroundColor: NONE, strokeColor: INK, groupIds: group, customData: { tmRole: 'ink' } };
  const mark = { id: 'm', type: 'rectangle', backgroundColor: INK, strokeColor: INK, groupIds: group, customData: { tmRole: 'mark' } };

  it('is left alone while unseen', () => {
    assert.deepEqual(boxRepairs([box(), ink, rim, mark]), []);
  });

  it('gives a colour picked for it alone to the ink (not to an open line\'s fill, nor to a mark), and is cleared', () => {
    const fixes = boxRepairs([box({ backgroundColor: '#ffc9c9', strokeColor: '#e03131' }), ink, rim, mark]);
    assert.deepEqual(fixes, [
      { id: 'i', patch: { backgroundColor: '#ffc9c9', strokeColor: '#e03131' } },
      { id: 'r', patch: { strokeColor: '#e03131' } },
      { id: 'b', patch: { backgroundColor: BOX_FILL, strokeColor: NONE } },
    ]);
  });

  it('is only cleared when the whole figure took the colour', () => {
    const red = { ...ink, backgroundColor: '#ffc9c9' };
    assert.deepEqual(boxRepairs([box({ backgroundColor: '#ffc9c9' }), red, rim]), [{ id: 'b', patch: { backgroundColor: BOX_FILL, strokeColor: NONE } }]);
  });
});
