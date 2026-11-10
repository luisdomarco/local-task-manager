// General (draw.io's General and Misc), the block arrows, and the lines: figures as data (kit.js).
import { NONE, arc, diamond, ellipse, figure, link, ngon, path, poly, rect, scallop, star, text, turn, wave } from './kit.js';

// ── outlines more than one family draws (flowchart.js reuses them) ──
export const cylinder = (x, y, w, h, rim = 8) => [
  poly([[x, y + rim], ...arc(x + w / 2, y + h - rim, w / 2, rim, 180, 0, 12), ...arc(x + w / 2, y + rim, w / 2, rim, 0, -180, 12)]),
  path(arc(x + w / 2, y + rim, w / 2, rim, 0, 180, 12)),
];
export const documentPts = (x, y, w, h, amp = 8) => [[x, y], [x + w, y], ...wave(x + w, x, y + h - amp, -amp)];
export const tapePts = (x, y, w, h, amp = 8) => [...wave(x, x + w, y + amp, amp), ...wave(x + w, x, y + h - amp, amp)];
/** Stored data: round on the left, hollowed on the right. */
export const storedPts = (w, h, r = 15) => [[r, 0], ...arc(w, h / 2, r, h / 2, 270, 90, 12), [r, h], ...arc(r, h / 2, r, h / 2, 90, 270, 12).slice(1, -1)];
export const notePts = (w, h, fold = 16) => [[0, 0], [w - fold, 0], [w, fold], [w, h], [0, h]];
export const cardPts = (w, h, cut = 16) => [[cut, 0], [w, 0], [w, h], [0, h], [0, cut]];
export const actor = (w = 30, h = 60) => [
  ellipse(w / 4, 0, w / 2, w / 2),
  path([[w / 2, w / 2], [w / 2, h * 0.66]]),
  path([[0, h * 0.4], [w, h * 0.4]]),
  path([[0, h], [w / 2, h * 0.66], [w, h]]),
];
/** An Or (a + in a circle) and a summing junction (an × in one). */
export const junction = (s, x) => {
  const r = s / 2;
  const d = (r * Math.SQRT2) / 2;
  return x
    ? [ellipse(0, 0, s, s), path([[r - d, r - d], [r + d, r + d]]), path([[r - d, r + d], [r + d, r - d]])]
    : [ellipse(0, 0, s, s), path([[r, 0], [r, s]]), path([[0, r], [s, r]])];
};

/** A block arrow pointing right in w × h, turned to `dir`. */
const block = (dir) => {
  const pts = [[0, 15], [60, 15], [60, 0], [100, 30], [60, 60], [60, 45], [0, 45]];
  if (dir === 'right') return pts;
  if (dir === 'left') return pts.map(([x, y]) => [100 - x, y]);
  return turn(pts, 50, 30, dir === 'down' ? 90 : -90).map(([x, y]) => [x - 20, y + 20]); // 60 × 100
};

export const GENERAL = [
  figure('rect', 'Rectangle', 120, 60, [rect(0, 0, 120, 60)], { self: true, keywords: 'box square process' }),
  figure('rounded', 'Rounded rectangle', 120, 60, [rect(0, 0, 120, 60, { roundness: { type: 3, value: 10 } })], { self: true }),
  figure('text', 'Text', 40, 20, [text(0, 0, 'Text', { fontSize: 16 })], { line: true, keywords: 'label' }),
  figure('heading', 'Heading', 120, 36, [text(0, 0, 'Heading', { fontSize: 28 })], { line: true, keywords: 'title' }),
  figure('ellipse', 'Ellipse', 120, 80, [ellipse(0, 0, 120, 80)], { self: true, keywords: 'oval' }),
  figure('square', 'Square', 80, 80, [rect(0, 0, 80, 80)], { self: true }),
  figure('circle', 'Circle', 80, 80, [ellipse(0, 0, 80, 80)], { self: true }),
  figure('process', 'Process', 120, 60, [rect(0, 0, 120, 60), path([[12, 0], [12, 60]]), path([[108, 0], [108, 60]])], { self: true, keywords: 'subroutine predefined' }),
  figure('diamond', 'Diamond', 80, 80, [diamond(0, 0, 80, 80)], { self: true, keywords: 'rhombus decision' }),
  figure('parallelogram', 'Parallelogram', 120, 60, [poly([[20, 0], [120, 0], [100, 60], [0, 60]])]),
  figure('hexagon', 'Hexagon', 120, 80, [poly([[20, 0], [100, 0], [120, 40], [100, 80], [20, 80], [0, 40]])]),
  figure('triangle', 'Triangle', 60, 80, [poly([[0, 0], [60, 40], [0, 80]])]),
  figure('cylinder', 'Cylinder', 60, 80, cylinder(0, 0, 60, 80), { keywords: 'database storage' }),
  figure('cloud', 'Cloud', 120, 80, [poly(scallop(60, 40, 50, 30, 8, 5))]),
  figure('document', 'Document', 120, 80, [poly(documentPts(0, 0, 120, 80))]),
  figure('internal', 'Internal storage', 80, 80, [rect(0, 0, 80, 80), path([[12, 0], [12, 80]]), path([[0, 12], [80, 12]])], { self: true }),
  figure('cube', 'Cube', 120, 80, [
    poly([[0, 10], [110, 10], [110, 80], [0, 80]]), poly([[0, 10], [10, 0], [120, 0], [110, 10]]), poly([[110, 10], [120, 0], [120, 70], [110, 80]]),
  ], { keywords: '3d box' }),
  figure('step', 'Step', 120, 60, [poly([[0, 0], [100, 0], [120, 30], [100, 60], [0, 60], [20, 30]])], { keywords: 'chevron' }),
  figure('trapezoid', 'Trapezoid', 120, 60, [poly([[20, 0], [100, 0], [120, 60], [0, 60]])]),
  figure('tape', 'Tape', 120, 80, [poly(tapePts(0, 0, 120, 80))], { keywords: 'flag' }),
  figure('note', 'Note', 80, 100, [poly(notePts(80, 100)), path([[64, 0], [64, 16], [80, 16]])], { keywords: 'page file' }),
  figure('card', 'Card', 80, 100, [poly(cardPts(80, 100))]),
  figure('callout', 'Callout', 120, 80, [poly([[0, 0], [120, 0], [120, 56], [50, 56], [30, 80], [30, 56], [0, 56]])], { keywords: 'speech bubble comment' }),
  figure('actor', 'Actor', 30, 60, actor(), { below: 'Actor', keywords: 'person user stick' }),
  figure('datastorage', 'Data storage', 120, 80, [poly(storedPts(120, 80))]),
  figure('or', 'Or', 60, 60, junction(60, false), { keywords: 'plus' }),
  figure('summing', 'Summing junction', 60, 60, junction(60, true), { keywords: 'cross' }),
  figure('cross', 'Cross', 80, 80, [poly([[28, 0], [52, 0], [52, 28], [80, 28], [80, 52], [52, 52], [52, 80], [28, 80], [28, 52], [0, 52], [0, 28], [28, 28]])], { keywords: 'plus' }),
  figure('star', 'Star', 80, 80, [poly(star(5, 0, 0, 80, 80, 0.42))]),
  figure('octagon', 'Octagon', 80, 80, [poly([[24, 0], [56, 0], [80, 24], [80, 56], [56, 80], [24, 80], [0, 56], [0, 24]])]),
  figure('pentagon', 'Pentagon', 80, 80, [poly(ngon(5, 0, 0, 80, 80))]),
  figure('container', 'Container', 200, 140, [rect(0, 0, 200, 140), path([[0, 28], [200, 28]])],
    { self: true, label: 'Container', align: { verticalAlign: 'top' }, keywords: 'group swimlane frame' }),
  figure('sticky', 'Sticky note', 160, 160, [rect(0, 0, 160, 160, { strokeColor: NONE, backgroundColor: '#fff3bf' })], { self: true, keywords: 'post-it' }),
  figure('sticky-pink', 'Sticky note (pink)', 160, 160, [rect(0, 0, 160, 160, { strokeColor: NONE, backgroundColor: '#ffdeeb' })], { self: true, keywords: 'post-it' }),
  figure('sticky-blue', 'Sticky note (blue)', 160, 160, [rect(0, 0, 160, 160, { strokeColor: NONE, backgroundColor: '#d0ebff' })], { self: true, keywords: 'post-it' }),
  figure('sticky-green', 'Sticky note (green)', 160, 160, [rect(0, 0, 160, 160, { strokeColor: NONE, backgroundColor: '#d3f9d8' })], { self: true, keywords: 'post-it' }),
  // The lines, as draw.io's General ends
  figure('line', 'Line', 120, 0, [path([[0, 0], [120, 0]])], { line: true }),
  figure('line-dashed', 'Dashed line', 120, 0, [path([[0, 0], [120, 0]], { strokeStyle: 'dashed' })], { line: true }),
  figure('line-dotted', 'Dotted line', 120, 0, [path([[0, 0], [120, 0]], { strokeStyle: 'dotted' })], { line: true }),
  figure('arrow', 'Arrow', 120, 0, [link(120, 0, { endArrowhead: 'triangle' })], { line: true, keywords: 'connector edge' }),
  figure('arrow-open', 'Open arrow', 120, 0, [link(120, 0, { endArrowhead: 'arrow' })], { line: true, keywords: 'connector edge' }),
  figure('arrow-both', 'Two-way arrow', 120, 0, [link(120, 0, { startArrowhead: 'triangle', endArrowhead: 'triangle' })], { line: true, keywords: 'bidirectional connector' }),
  figure('arrow-dashed', 'Dashed arrow', 120, 0, [link(120, 0, { endArrowhead: 'triangle', strokeStyle: 'dashed' })], { line: true, keywords: 'connector dependency' }),
  figure('arrow-thick', 'Thick arrow', 120, 0, [link(120, 0, { endArrowhead: 'triangle', strokeWidth: 4 })], { line: true, keywords: 'connector bold' }),
];

export const ARROWS = [
  figure('barrow-right', 'Arrow right', 100, 60, [poly(block('right'))], { keywords: 'block' }),
  figure('barrow-left', 'Arrow left', 100, 60, [poly(block('left'))], { keywords: 'block' }),
  figure('barrow-up', 'Arrow up', 60, 100, [poly(block('up'))], { keywords: 'block' }),
  figure('barrow-down', 'Arrow down', 60, 100, [poly(block('down'))], { keywords: 'block' }),
  figure('barrow-double', 'Double arrow', 120, 60, [poly([[0, 30], [30, 0], [30, 15], [90, 15], [90, 0], [120, 30], [90, 60], [90, 45], [30, 45], [30, 60]])], { keywords: 'block two-way' }),
  figure('barrow-notched', 'Notched arrow', 100, 60, [poly([[0, 15], [60, 15], [60, 0], [100, 30], [60, 60], [60, 45], [0, 45], [12, 30]])], { keywords: 'block' }),
  figure('barrow-chevron', 'Chevron', 100, 60, [poly([[0, 0], [70, 0], [100, 30], [70, 60], [0, 60], [30, 30]])], { keywords: 'block step' }),
  figure('barrow-bend', 'Bend arrow', 100, 100, [poly([
    [0, 100], ...arc(35, 50, 35, 35, 180, 270, 10), [70, 15], [70, 0], [100, 25], [70, 50], [70, 35],
    ...arc(35, 50, 15, 15, 270, 180, 6), [20, 100],
  ])], { keywords: 'block turn' }),
  figure('barrow-uturn', 'U-turn arrow', 100, 100, [poly([
    [0, 100], [0, 45], ...arc(40, 45, 40, 40, 180, 360, 14), [80, 60], [100, 60], [70, 100], [40, 60], [60, 60], ...arc(40, 45, 20, 20, 360, 180, 10), [20, 100],
  ])], { keywords: 'block return' }),
  figure('barrow-quad', 'Four-way arrow', 100, 100, [poly([
    [50, 0], [68, 18], [58, 18], [58, 42], [82, 42], [82, 32], [100, 50], [82, 68], [82, 58], [58, 58], [58, 82], [68, 82], [50, 100],
    [32, 82], [42, 82], [42, 58], [18, 58], [18, 68], [0, 50], [18, 32], [18, 42], [42, 42], [42, 18], [32, 18],
  ])], { keywords: 'block move cross' }),
];
