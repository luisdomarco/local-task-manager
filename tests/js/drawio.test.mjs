import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FIGURE_STYLES, arrowhead, attr, label, toDrawio } from '../../static/js/canvas/drawio.js';
import { SHAPES } from '../../static/js/canvas/shapes/index.js';

/** A figure's skeletons as the elements Excalidraw makes of them: ids given, a label a text bound in its part. */
let n = 0;
function elementsOf(skeletons) {
  const out = [];
  for (const s of skeletons) {
    const { label: lbl, ...rest } = s;
    const e = { id: `e${(n += 1)}`, angle: 0, opacity: 100, ...rest };
    if (e.type !== 'text' && e.type !== 'arrow' && e.type !== 'line' && e.width == null) Object.assign(e, { width: 10, height: 10 });
    out.push(e);
    if (lbl) out.push({ id: `e${(n += 1)}`, type: 'text', x: e.x, y: e.y, width: e.width, height: 20, text: lbl.text, fontSize: lbl.fontSize ?? 14, strokeColor: '#000000', containerId: e.id, groupIds: e.groupIds });
  }
  return out;
}
const figureAt = (id, x, y, labelText = '') => {
  const els = elementsOf(SHAPES.get(id).skeleton(x, y));
  const box = els.find((e) => ['box', 'outline'].includes(e.customData?.tmRole));
  if (labelText) els.push({ id: `e${(n += 1)}`, type: 'text', x, y, width: 50, height: 20, text: labelText, fontSize: 14, strokeColor: '#000000', containerId: box.id, groupIds: box.groupIds });
  return { els, box };
};
const cells = (xml) => [...xml.matchAll(/<mxCell id="([^"]*)"[^>]*?(?:vertex|edge)="1"[^>]*>/g)].map((m) => m[0]);
const styleOf = (cell) => Object.fromEntries((/style="([^"]*)"/.exec(cell)?.[1] || '').split(';').filter(Boolean).map((kv) => { const [k, ...v] = kv.split('='); return [k, v.join('=') || true]; }));

describe('a canvas as a draw.io diagram', () => {
  it('has a draw.io style for every figure of the shapes panel that is not a line or a text', () => {
    const left = ['bpmn-pool-lanes']; // drawn part by part: draw.io's pool takes its lanes as children
    for (const [id, fig] of SHAPES) {
      const parts = fig.skeleton();
      const lone = parts.every((p) => ['arrow', 'line', 'text'].includes(p.type));
      if (lone || left.includes(id)) assert.ok(!FIGURE_STYLES.has(id), `${id}: no style wanted`);
      else assert.ok(FIGURE_STYLES.has(id), `${id}: no draw.io style`);
    }
    for (const id of FIGURE_STYLES.keys()) assert.ok(SHAPES.has(id), `${id}: a style for no figure`);
    for (const style of FIGURE_STYLES.values()) assert.match(style, /;$/);
  });

  it('exports a figure as one draw.io shape, its box\'s size, with its label: not its ink', () => {
    const { els, box } = figureAt('hexagon', 100, 40, 'Review');
    const xml = toDrawio(els, { name: 'Flow' });
    const vs = cells(xml);
    assert.equal(vs.length, 1, 'the ink is draw.io\'s to draw');
    assert.match(vs[0], new RegExp(`id="${box.id}"`));
    assert.match(vs[0], /value="Review"/);
    assert.equal(styleOf(vs[0]).shape, 'hexagon');
    assert.equal(styleOf(vs[0]).fillColor, '#ffffff');
    assert.equal(styleOf(vs[0]).strokeColor, '#000000');
    assert.match(xml, new RegExp(`<mxGeometry x="100" y="40" width="${box.width}" height="${box.height}" as="geometry"/>`));
    assert.match(xml, /<diagram name="Flow"/);
  });

  it('names a BPMN event\'s outline and symbol, an actor its name under it', () => {
    const { els } = figureAt('bpmn-end-error', 0, 0);
    const s = styleOf(cells(toDrawio(els))[0]);
    assert.equal(s.shape, 'mxgraph.bpmn.event');
    assert.deepEqual([s.outline, s.symbol], ['end', 'error']);
    assert.equal(styleOf(cells(toDrawio(figureAt('bpmn-start-none', 0, 0).els))[0]).symbol, 'general');
    const actor = cells(toDrawio(figureAt('actor', 0, 0).els));
    assert.equal(actor.length, 1);
    assert.equal(styleOf(actor[0]).shape, 'umlActor');
  });

  it('binds an arrow to the shapes its ends are bound to, an elbow orthogonal, its head draw.io\'s', () => {
    const a = figureAt('rect', 0, 0, 'A');
    const b = figureAt('cylinder', 300, 0, 'B');
    const arrow = { id: 'arr', type: 'arrow', x: 120, y: 30, width: 180, height: 0, points: [[0, 0], [90, 0], [90, 20], [180, 20]], elbowed: true,
      strokeColor: '#1e1e1e', strokeWidth: 1, startArrowhead: null, endArrowhead: 'triangle',
      startBinding: { elementId: a.box.id, fixedPoint: [1.0001, 0.5] }, endBinding: { elementId: b.box.id, fixedPoint: [-0.0001, 0.5] } };
    const xml = toDrawio([...a.els, ...b.els, arrow]);
    const edge = cells(xml).find((c) => /edge="1"/.test(c));
    assert.match(edge, new RegExp(`source="${a.box.id}"`));
    assert.match(edge, new RegExp(`target="${b.box.id}"`));
    const s = styleOf(edge);
    assert.equal(s.edgeStyle, 'orthogonalEdgeStyle');
    assert.deepEqual([s.endArrow, s.endFill, s.startArrow], ['classic', '1', 'none']);
    assert.deepEqual([s.exitX, s.exitY, s.entryX, s.entryY], ['1', '0.5', '0', '0.5']);
    assert.match(xml, /<Array as="points"><mxPoint x="210" y="30"\/><mxPoint x="210" y="50"\/><\/Array>/);
  });

  it('binds an arrow drawn to a figure\'s ink to the figure', () => {
    const f = figureAt('cloud', 0, 0);
    const ink = f.els.find((e) => e.customData?.tmRole === 'ink');
    const arrow = { id: 'a2', type: 'arrow', x: -100, y: 0, points: [[0, 0], [100, 0]], endBinding: { elementId: ink.id }, endArrowhead: 'arrow' };
    const edge = cells(toDrawio([...f.els, arrow])).find((c) => /edge="1"/.test(c));
    assert.match(edge, new RegExp(`target="${f.box.id}"`));
    assert.equal(styleOf(edge).endArrow, 'open');
    assert.equal(styleOf(edge).edgeStyle, 'none');
  });

  it('exports shapes, texts and lines of no figure as draw.io\'s own, escaped', () => {
    const els = [
      { id: 'r', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, strokeColor: '#e03131', backgroundColor: 'transparent', strokeStyle: 'dashed', roundness: { type: 3 } },
      { id: 'rt', type: 'text', x: 5, y: 5, width: 90, height: 20, text: 'a < b & "c"', containerId: 'r', fontSize: 20, strokeColor: '#e03131' },
      { id: 'o', type: 'ellipse', x: 200, y: 0, width: 60, height: 60, strokeColor: '#000000', backgroundColor: '#ffec99' },
      { id: 't', type: 'text', x: 0, y: 100, width: 80, height: 40, text: 'two\nlines', fontSize: 16, strokeColor: '#000000' },
      { id: 'l', type: 'line', x: 0, y: 200, points: [[0, 0], [50, 0]], strokeColor: '#000000', strokeStyle: 'dotted' },
      { id: 'gone', type: 'rectangle', x: 0, y: 0, width: 1, height: 1, isDeleted: true },
    ];
    const xml = toDrawio(els);
    const all = cells(xml);
    assert.equal(all.length, 4, 'the bound text is its shape\'s label; the deleted one is out');
    const rect = all.find((c) => c.includes('id="r"'));
    assert.match(rect, /value="a &amp;lt; b &amp;amp; &quot;c&quot;"/);
    assert.deepEqual([styleOf(rect).rounded, styleOf(rect).fillColor, styleOf(rect).dashed, styleOf(rect).fontSize, styleOf(rect).fontColor], ['1', 'none', '1', '20', '#e03131']);
    assert.ok(styleOf(all.find((c) => c.includes('id="o"'))).ellipse);
    assert.match(all.find((c) => c.includes('id="t"')), /value="two&lt;br&gt;lines"/);
    const line = styleOf(all.find((c) => c.includes('id="l"')));
    assert.deepEqual([line.endArrow, line.dashed, line.dashPattern], ['none', '1', '1 4']);
  });

  it('exports a card as a box with its title, its kicker and its status, not its parts', () => {
    const els = [
      { id: 'card', type: 'rectangle', x: 0, y: 0, width: 280, height: 104, strokeColor: '#dcdce1', backgroundColor: '#ffffff', roundness: { type: 3 }, customData: { tmItem: 'i1', tmTitle: 'Launch <checkout>' }, groupIds: ['g'] },
      { id: 'p1', type: 'rectangle', x: 9, y: 7, width: 262, height: 30, customData: { tmPart: 'title', tmOf: 'i1' }, groupIds: ['g'] },
      { id: 'p1t', type: 'text', x: 14, y: 12, width: 200, height: 20, text: 'Launch <checkout>', containerId: 'p1', groupIds: ['g'] },
      { id: 'p2', type: 'text', x: 14, y: 40, width: 60, height: 15, text: 'GOL-27', customData: { tmPart: 'kicker', tmOf: 'i1' }, groupIds: ['g'] },
      { id: 'p3', type: 'text', x: 14, y: 60, width: 60, height: 15, text: 'In progress', customData: { tmPart: 'status', tmOf: 'i1' }, groupIds: ['g'] },
    ];
    const all = cells(toDrawio(els));
    assert.equal(all.length, 1);
    assert.match(all[0], /value="&lt;b&gt;Launch &amp;lt;checkout&amp;gt;&lt;\/b&gt;&lt;br&gt;.*GOL-27.*In progress/);
  });

  it('keeps the canvas\'s background and grid', () => {
    assert.match(toDrawio([], { appState: { viewBackgroundColor: '#f8f9fa', gridModeEnabled: true } }), /<mxGraphModel grid="1"[^>]* background="#f8f9fa">/);
    assert.match(toDrawio([], { appState: { viewBackgroundColor: '#ffffff' } }), /<mxGraphModel grid="0"[^>]*page="0"[^>]*shadow="0">/);
  });

  it('writes well-formed XML', () => {
    const { els } = figureAt('bpmn-user', 0, 0, 'Fill in\nthe form & send');
    const xml = toDrawio(els, { name: 'A "quoted" <name>' });
    assert.ok(xml.startsWith('<mxfile'));
    assert.equal((xml.match(/<mxCell /g) || []).length, (xml.match(/<\/mxCell>|<mxCell [^>]*\/>/g) || []).length);
    assert.doesNotMatch(xml.replace(/&(amp|lt|gt|quot|apos|#xa);/g, ''), /&|<[^/a-zA-Z]/);
    assert.match(xml, /<diagram name="A &quot;quoted&quot; &lt;name&gt;"/);
  });

  it('maps each arrowhead to draw.io\'s, and escapes as XML and as a label', () => {
    assert.deepEqual(arrowhead(null), ['none', 0]);
    assert.deepEqual(arrowhead('triangle'), ['classic', 1]);
    assert.deepEqual(arrowhead('triangle_outline'), ['block', 0]);
    assert.deepEqual(arrowhead('arrow'), ['open', 0]);
    assert.deepEqual(arrowhead('circle_outline'), ['oval', 0]);
    assert.deepEqual(arrowhead('diamond'), ['diamond', 1]);
    assert.equal(attr('a"b<\n'), 'a&quot;b&lt;&#xa;');
    assert.equal(label('x<y\nz'), 'x&lt;y<br>z');
  });
});
