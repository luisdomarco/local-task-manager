// Flowchart (draw.io's Flowchart library, the ISO 5807 symbols): figures as data (kit.js).
import { arc, diamond, ellipse, figure, link, path, poly, rect } from './kit.js';
import { cardPts, cylinder, documentPts, junction, storedPts, tapePts } from './general.js';

const fc = (id, name, w, h, parts, o = {}) => figure(`fc-${id}`, name, w, h, parts, { ...o, keywords: `flowchart ${o.keywords || ''}` });

export const FLOWCHART = [
  fc('terminator', 'Terminator', 120, 40, [poly([...arc(20, 20, 20, 20, 90, 270, 10), ...arc(100, 20, 20, 20, 270, 450, 10)])], { keywords: 'start end' }),
  fc('process', 'Process', 120, 60, [rect(0, 0, 120, 60)], { self: true }),
  fc('decision', 'Decision', 100, 80, [diamond(0, 0, 100, 80)], { self: true, keywords: 'if condition' }),
  fc('data', 'Data (input / output)', 120, 60, [poly([[20, 0], [120, 0], [100, 60], [0, 60]])], { keywords: 'io parallelogram' }),
  fc('predefined', 'Predefined process', 120, 60, [rect(0, 0, 120, 60), path([[12, 0], [12, 60]]), path([[108, 0], [108, 60]])], { self: true, keywords: 'subroutine' }),
  fc('document', 'Document', 120, 80, [poly(documentPts(0, 0, 120, 80))]),
  fc('multi-document', 'Multiple documents', 120, 80, [
    poly(documentPts(12, 0, 108, 64, 6)), poly(documentPts(6, 6, 108, 64, 6)), poly(documentPts(0, 12, 108, 64, 6)),
  ]),
  fc('database', 'Database', 60, 80, cylinder(0, 0, 60, 80), { keywords: 'storage disk' }),
  fc('direct-data', 'Direct data', 120, 60, [
    poly([[12, 0], [108, 0], ...arc(108, 30, 12, 30, 270, 450, 12), [12, 60], ...arc(12, 30, 12, 30, 90, 270, 12)]), path(arc(108, 30, 12, 30, 90, 270, 12)),
  ], { keywords: 'drum storage' }),
  fc('internal', 'Internal storage', 80, 80, [rect(0, 0, 80, 80), path([[12, 0], [12, 80]]), path([[0, 12], [80, 12]])], { self: true }),
  fc('stored', 'Stored data', 120, 60, [poly(storedPts(120, 60))]),
  fc('manual-input', 'Manual input', 120, 60, [poly([[0, 20], [120, 0], [120, 60], [0, 60]])], { keywords: 'keyboard' }),
  fc('manual-operation', 'Manual operation', 120, 60, [poly([[0, 0], [120, 0], [100, 60], [20, 60]])]),
  fc('preparation', 'Preparation', 120, 60, [poly([[20, 0], [100, 0], [120, 30], [100, 60], [20, 60], [0, 30]])], { keywords: 'hexagon setup' }),
  fc('delay', 'Delay', 100, 60, [poly([[0, 0], [70, 0], ...arc(70, 30, 30, 30, 270, 450, 12), [0, 60]])], { keywords: 'wait' }),
  fc('display', 'Display', 120, 60, [poly([[0, 30], [20, 0], [100, 0], ...arc(100, 30, 20, 30, 270, 450, 12), [20, 60]])], { keywords: 'screen' }),
  fc('loop-limit', 'Loop limit', 120, 60, [poly([[20, 0], [100, 0], [120, 20], [120, 60], [0, 60], [0, 20]])], { keywords: 'repeat' }),
  fc('merge', 'Merge', 80, 60, [poly([[0, 0], [80, 0], [40, 60]])], { keywords: 'triangle' }),
  fc('extract', 'Extract', 80, 60, [poly([[40, 0], [80, 60], [0, 60]])], { keywords: 'triangle' }),
  fc('collate', 'Collate', 60, 60, [poly([[0, 0], [60, 0], [30, 30]]), poly([[30, 30], [60, 60], [0, 60]])], { keywords: 'hourglass' }),
  fc('sort', 'Sort', 60, 60, [diamond(0, 0, 60, 60), path([[0, 30], [60, 30]])], { self: true }),
  fc('or', 'Or', 60, 60, junction(60, false)),
  fc('summing', 'Summing junction', 60, 60, junction(60, true)),
  fc('on-page', 'On-page connector', 40, 40, [ellipse(0, 0, 40, 40)], { self: true, keywords: 'reference circle' }),
  fc('off-page', 'Off-page connector', 60, 60, [poly([[0, 0], [60, 0], [60, 40], [30, 60], [0, 40]])], { keywords: 'reference' }),
  fc('card', 'Punched card', 120, 80, [poly(cardPts(120, 80, 20))]),
  fc('tape', 'Paper tape', 120, 80, [poly(tapePts(0, 0, 120, 80))]),
  fc('annotation', 'Annotation', 100, 50, [path([[16, 0], [0, 0], [0, 50], [16, 50]])], { label: 'Comment', align: { textAlign: 'left' }, keywords: 'comment note' }),
  fc('flow', 'Flow line', 120, 0, [link(120, 0, { endArrowhead: 'triangle' })], { line: true, keywords: 'arrow connector' }),
];
