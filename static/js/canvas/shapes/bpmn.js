// BPMN 2.0: activities (tasks with their markers), events (start, intermediate catching and throwing, end, each with
// its symbol), gateways, data, swimlanes and flows, as draw.io's BPMN 2.0 libraries draw them (sizes from the diagrams
// system's style library: task 120 × 80, event 40, gateway 50). A throwing symbol is black (`mark`), a catching one
// white. Figures as data (kit.js).
import { INK, NONE, PAPER, arc, diamond, ellipse, figure, link, mark, ngon, path, poly, rect, shift, text, turn } from './kit.js';
import { cylinder } from './general.js';

// ── markers ──
/** A letter: outlined, or black (a sending task, a throwing event). */
const envelope = (x, y, w, h, black = false) => (black
  ? [mark(rect(x, y, w, h, { backgroundColor: INK })), mark(path([[x, y], [x + w / 2, y + h / 2], [x + w, y]], { strokeColor: PAPER }))]
  : [rect(x, y, w, h), path([[x, y], [x + w / 2, y + h / 2], [x + w, y]])]);
const user = (x, y) => [ellipse(x + 5, y, 7, 7), poly(arc(x + 8.5, y + 16, 7.5, 7.5, 180, 360, 8))];
const gear = (x, y, s = 16) => {
  const c = s / 2;
  const teeth = Array.from({ length: 16 }, (_, i) => {
    const a = (i * Math.PI) / 8;
    const r = i % 2 ? c * 0.72 : c;
    return [x + c + r * Math.cos(a), y + c + r * Math.sin(a)];
  });
  return [poly(teeth), ellipse(x + c - 2.5, y + c - 2.5, 5, 5)];
};
const hand = (x, y) => [poly(shift([[0, 7], [4, 3], [16, 3], [16, 6], [9, 6], [16, 6], [16, 9], [9, 9], [15, 9], [15, 12], [9, 12], [13, 12], [13, 15], [3, 15], [0, 12]], x, y))];
const rule = (x, y) => [rect(x, y + 2, 16, 12), mark(rect(x, y + 2, 16, 4, { backgroundColor: '#d0d0d0' })), path([[x + 5, y + 6], [x + 5, y + 14]]), path([[x, y + 10], [x + 16, y + 10]])];
const script = (x, y) => {
  const side = (dx) => Array.from({ length: 9 }, (_, i) => [x + dx + 2.5 * Math.cos((2 * Math.PI * i) / 8), y + 2 * i]);
  return [poly([...side(13.5), ...side(1.5).reverse()]), ...[5, 8, 11].map((dy) => path([[x + 5, y + dy], [x + 12, y + dy]]))];
};
// Below a task, in its middle: what it repeats as, or that it holds more.
const sub = () => [rect(53, 62, 14, 14), path([[56, 69], [64, 69]]), path([[60, 65], [60, 73]])];
const loop = () => [path(arc(60, 69, 6, 6, -40, 230, 12)), path([[60 + 6 * Math.cos(-0.7) - 4, 69 + 6 * Math.sin(-0.7) - 1], [60 + 6 * Math.cos(-0.7), 69 + 6 * Math.sin(-0.7)], [60 + 6 * Math.cos(-0.7) + 1, 69 + 6 * Math.sin(-0.7) - 4]])];
const parallelMI = () => [55, 60, 65].map((x) => path([[x, 63], [x, 75]]));
const sequentialMI = () => [63, 69, 75].map((y) => path([[54, y], [66, y]]));
const adhoc = (x = 60, y = 69) => [path(Array.from({ length: 9 }, (_, i) => [x - 6 + (12 * i) / 8, y + 2 * Math.sin((2 * Math.PI * i) / 8)]))];

const TASK = { roundness: { type: 3, value: 10 } };
const task = (id, name, marks = [], o = {}, keywords = '') => figure(id, name, 120, 80, [rect(0, 0, 120, 80, { ...TASK, ...o }), ...marks], { self: true, keywords: `bpmn activity ${keywords}` });

export const ACTIVITIES = [
  task('bpmn-task', 'Task'),
  task('bpmn-user', 'User task', user(6, 6), {}, 'human'),
  task('bpmn-service', 'Service task', gear(6, 6), {}, 'system automated'),
  task('bpmn-send', 'Send task', envelope(6, 8, 18, 12, true), {}, 'message'),
  task('bpmn-receive', 'Receive task', envelope(6, 8, 18, 12), {}, 'message'),
  task('bpmn-manual', 'Manual task', hand(6, 6)),
  task('bpmn-rule', 'Business rule task', rule(6, 6), {}, 'decision table'),
  task('bpmn-script', 'Script task', script(6, 6)),
  task('bpmn-call', 'Call activity', [], { strokeWidth: 3 }, 'reusable'),
  task('bpmn-subprocess', 'Sub-process', sub(), {}, 'collapsed'),
  task('bpmn-loop', 'Loop task', loop(), {}, 'repeat'),
  task('bpmn-parallel-mi', 'Multi-instance (parallel)', parallelMI()),
  task('bpmn-sequential-mi', 'Multi-instance (sequential)', sequentialMI()),
  task('bpmn-adhoc', 'Ad-hoc sub-process', [...sub().map((p) => ({ ...p, x: p.x - 9 })), ...adhoc(70, 69)]),
  task('bpmn-transaction', 'Transaction', [rect(4, 4, 112, 72, { roundness: { type: 3, value: 7 }, backgroundColor: NONE }), ...sub()]),
  task('bpmn-event-sub', 'Event sub-process', sub(), { strokeStyle: 'dotted' }),
  figure('bpmn-expanded', 'Expanded sub-process', 240, 160, [rect(0, 0, 240, 160, TASK)],
    { self: true, label: 'Sub-process', align: { verticalAlign: 'top' }, keywords: 'bpmn activity group' }),
];

// ── events: 40 × 40, a thin ring to start, a double one in between, a thick one to end ──
const plus = (x, y, s, t) => [[x + (s - t) / 2, y], [x + (s + t) / 2, y], [x + (s + t) / 2, y + (s - t) / 2], [x + s, y + (s - t) / 2], [x + s, y + (s + t) / 2],
  [x + (s + t) / 2, y + (s + t) / 2], [x + (s + t) / 2, y + s], [x + (s - t) / 2, y + s], [x + (s - t) / 2, y + (s + t) / 2], [x, y + (s + t) / 2],
  [x, y + (s - t) / 2], [x + (s - t) / 2, y + (s - t) / 2]];
const fill = (black) => (black ? { backgroundColor: INK } : {});
const blk = (black, p) => (black ? mark(p) : p);
const SYMBOLS = {
  none: () => [],
  message: (b) => envelope(10, 13, 20, 14, b),
  timer: () => [ellipse(9, 9, 22, 22), path([[20, 12], [20, 20], [26, 20]])],
  conditional: () => [rect(12, 10, 16, 20), ...[14, 18, 22, 26].map((y) => path([[14, y], [26, y]]))],
  signal: (b) => [blk(b, poly([[20, 9], [30, 28], [10, 28]], fill(b)))],
  escalation: (b) => [blk(b, poly([[20, 9], [28, 30], [20, 22], [12, 30]], fill(b)))],
  link: (b) => [blk(b, poly([[10, 16], [21, 16], [21, 11], [30, 20], [21, 29], [21, 24], [10, 24]], fill(b)))],
  error: (b) => [blk(b, poly([[11, 29], [15, 13], [21, 22], [29, 11], [25, 27], [19, 18]], fill(b)))],
  terminate: () => [mark(ellipse(8, 8, 24, 24, { backgroundColor: INK }))],
  cancel: (b) => [blk(b, poly(turn(plus(9, 9, 22, 5), 20, 20, 45), fill(b)))],
  compensation: (b) => [blk(b, poly([[10, 20], [19, 13], [19, 27]], fill(b))), blk(b, poly([[19, 20], [28, 13], [28, 27]], fill(b)))],
  multiple: (b) => [blk(b, poly(ngon(5, 11, 11, 18, 18), fill(b)))],
  parallel: () => [poly(plus(10, 10, 20, 6))],
};
const RING = { start: { strokeWidth: 1 }, catching: { strokeWidth: 1 }, throwing: { strokeWidth: 1 }, end: { strokeWidth: 3 } };
const KIND = { start: 'Start', catching: 'Intermediate', throwing: 'Intermediate', end: 'End' };
const SUFFIX = { start: 'start event', catching: 'catch event', throwing: 'throw event', end: 'end event' };
const WORD = { parallel: 'Parallel multiple' };
/** "Start event", "Message catch event", "Intermediate event" (throwing, none), "Error end event"… */
const eventName = (kind, sym) => {
  if (sym === 'none') return `${KIND[kind]} event`;
  return `${WORD[sym] || `${sym[0].toUpperCase()}${sym.slice(1)}`} ${SUFFIX[kind]}`;
};
const event = (kind, sym) => {
  const black = kind === 'throwing' || kind === 'end';
  const between = kind === 'catching' || kind === 'throwing';
  return figure(`bpmn-${kind}-${sym}`, eventName(kind, sym), 40, 40, [
    ellipse(0, 0, 40, 40, RING[kind]),
    ...(between ? [ellipse(3, 3, 34, 34, { backgroundColor: NONE })] : []),
    ...SYMBOLS[sym](black),
  ], { self: true, keywords: `bpmn event ${KIND[kind]} ${sym} ${kind}` });
};
export const EVENTS = [
  ...['none', 'message', 'timer', 'conditional', 'signal', 'multiple', 'parallel'].map((s) => event('start', s)),
  ...['message', 'timer', 'conditional', 'link', 'signal', 'error', 'multiple'].map((s) => event('catching', s)),
  ...['none', 'message', 'signal', 'escalation', 'link', 'compensation', 'multiple'].map((s) => event('throwing', s)),
  ...['none', 'message', 'error', 'escalation', 'signal', 'terminate', 'cancel', 'compensation', 'multiple'].map((s) => event('end', s)),
];

// ── gateways: 50 × 50 ──
const gateway = (id, name, marks = [], keywords = '') => figure(id, name, 50, 50, [diamond(0, 0, 50, 50), ...marks], { self: true, keywords: `bpmn gateway ${keywords}` });
export const GATEWAYS = [
  gateway('bpmn-gateway', 'Gateway'),
  gateway('bpmn-exclusive', 'Exclusive gateway', [mark(poly(turn(plus(13, 13, 24, 5), 25, 25, 45), { backgroundColor: INK }))], 'xor decision'),
  gateway('bpmn-parallel', 'Parallel gateway', [mark(poly(plus(13, 13, 24, 5), { backgroundColor: INK }))], 'and fork join'),
  gateway('bpmn-inclusive', 'Inclusive gateway', [ellipse(13, 13, 24, 24, { strokeWidth: 3, backgroundColor: NONE })], 'or'),
  gateway('bpmn-complex', 'Complex gateway', [[25, 12, 25, 38], [12, 25, 38, 25], [16, 16, 34, 34], [16, 34, 34, 16]]
    .map(([a, b, c, d]) => mark(path([[a, b], [c, d]], { strokeWidth: 3 })))),
  gateway('bpmn-event-gw', 'Event-based gateway', [ellipse(11, 11, 28, 28, { backgroundColor: NONE }), ellipse(14, 14, 22, 22, { backgroundColor: NONE }), poly(ngon(5, 18, 18, 14, 14))]),
  gateway('bpmn-parallel-event-gw', 'Parallel event-based gateway', [ellipse(11, 11, 28, 28, { backgroundColor: NONE }), poly(plus(16, 16, 18, 5))]),
];

// ── data, artifacts and swimlanes ──
const doc = [poly([[0, 0], [28, 0], [40, 12], [40, 60], [0, 60]]), path([[28, 0], [28, 12], [40, 12]])];
const inArrow = (black) => [blk(black, poly([[4, 8], [10, 8], [10, 5], [16, 10], [10, 15], [10, 12], [4, 12]], fill(black)))];
/** A text turned to read upwards, its middle at cx, cy (a pool's or a lane's name). */
const upwards = (cx, cy, s) => text(cx - (s.length * 7.6) / 2, cy - 9, s, { angle: (3 * Math.PI) / 2 });
export const DATA = [
  figure('bpmn-data', 'Data object', 40, 60, doc, { keywords: 'bpmn document artifact' }),
  figure('bpmn-data-in', 'Data input', 40, 60, [...doc, ...inArrow(false)], { keywords: 'bpmn document' }),
  figure('bpmn-data-out', 'Data output', 40, 60, [...doc, ...inArrow(true)], { keywords: 'bpmn document' }),
  figure('bpmn-data-many', 'Data collection', 40, 60, [...doc, ...[15, 20, 25].map((x) => path([[x, 46], [x, 56]]))], { keywords: 'bpmn document list' }),
  figure('bpmn-store', 'Data store', 60, 60, [...cylinder(0, 0, 60, 60, 8), path(arc(30, 14, 30, 8, 0, 180, 12)), path(arc(30, 20, 30, 8, 0, 180, 12))], { keywords: 'bpmn database' }),
  figure('bpmn-message', 'Message', 40, 28, [rect(0, 0, 40, 28), path([[0, 0], [20, 14], [40, 0]])], { self: true, keywords: 'bpmn envelope' }),
  figure('bpmn-annotation', 'Text annotation', 100, 50, [path([[16, 0], [0, 0], [0, 50], [16, 50]])], { label: 'Annotation', align: { textAlign: 'left' }, keywords: 'bpmn comment note' }),
  figure('bpmn-group', 'Group', 200, 140, [rect(0, 0, 200, 140, { ...TASK, strokeStyle: 'dashed', backgroundColor: NONE })], { self: true, keywords: 'bpmn' }),
  figure('bpmn-pool', 'Pool', 600, 200, [rect(0, 0, 600, 200), path([[30, 0], [30, 200]]), upwards(15, 100, 'Pool')], { self: true, keywords: 'bpmn swimlane participant' }),
  figure('bpmn-pool-lanes', 'Pool with lanes', 600, 300, [
    rect(0, 0, 600, 300), path([[30, 0], [30, 300]]), path([[60, 0], [60, 300]]), path([[30, 150], [600, 150]]),
    upwards(15, 150, 'Pool'), upwards(45, 75, 'Lane'), upwards(45, 225, 'Lane'),
  ], { self: true, keywords: 'bpmn swimlane participant' }),
  figure('bpmn-lane', 'Lane', 570, 150, [rect(0, 0, 570, 150), path([[30, 0], [30, 150]]), upwards(15, 75, 'Lane')], { self: true, keywords: 'bpmn swimlane' }),
];

export const FLOWS = [
  figure('bpmn-sequence', 'Sequence flow', 120, 0, [link(120, 0, { endArrowhead: 'triangle' })], { line: true, keywords: 'bpmn connector' }),
  figure('bpmn-default', 'Default flow', 120, 0, [link(120, 0, { startArrowhead: 'bar', endArrowhead: 'triangle' })], { line: true, keywords: 'bpmn connector' }),
  figure('bpmn-conditional', 'Conditional flow', 120, 0, [link(120, 0, { startArrowhead: 'diamond_outline', endArrowhead: 'triangle' })], { line: true, keywords: 'bpmn connector' }),
  figure('bpmn-message-flow', 'Message flow', 120, 0, [link(120, 0, { startArrowhead: 'circle_outline', endArrowhead: 'triangle_outline', strokeStyle: 'dashed' })], { line: true, keywords: 'bpmn connector' }),
  figure('bpmn-association', 'Association', 120, 0, [link(120, 0, { strokeStyle: 'dotted' })], { line: true, keywords: 'bpmn connector' }),
  figure('bpmn-directed', 'Directed association', 120, 0, [link(120, 0, { strokeStyle: 'dotted', endArrowhead: 'arrow' })], { line: true, keywords: 'bpmn connector data' }),
];
