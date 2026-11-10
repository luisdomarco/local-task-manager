// A canvas as a draw.io diagram: its elements (Excalidraw's, as the file keeps them) → the XML draw.io opens and imports
// (File → Open, or drag the .drawio file onto it). Pure: no DOM, no Excalidraw (tests/js/drawio.test.mjs).
//
//   <mxfile><diagram name="…"><mxGraphModel …><root>
//     <mxCell id="0"/><mxCell id="1" parent="0"/>
//     <mxCell id="…" value="…" style="…" vertex="1" parent="1"><mxGeometry x y width height as="geometry"/></mxCell>
//     <mxCell id="…" style="…" edge="1" source="…" target="…" parent="1"><mxGeometry relative="1" as="geometry">…
//   </root></mxGraphModel></diagram></mxfile>
//
// What each element becomes:
//   a figure of the shapes panel  one shape, in draw.io's own style for it (FIGURE_STYLES), the size of its box, its
//                                 label; its ink is not exported (draw.io draws the figure itself). A figure with no
//                                 style here goes part by part, as any other element
//   a card                        a rounded box with its title and kicker (GOL-27)
//   a rectangle, ellipse, diamond a shape of that kind, its bound text its label
//   a free text                   a text
//   an arrow, a line, a stroke    an edge: bound to the shapes its ends are bound to, its turns as waypoints, an elbow
//                                 orthogonal, its arrowheads draw.io's
//   a frame                       a box with its name at the top
// Images are not exported (the canvases take none).

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;', '\n': '&#xa;' };
/** A string fit for an XML attribute. */
export const attr = (s) => String(s ?? '').replace(/[&<>"'\n]/g, (c) => ESC[c]);
/** A text as draw.io's html=1 labels hold it: its markup escaped, its line breaks <br>. */
export const label = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ESC[c]).replace(/\r?\n/g, '<br>');

const r = (n) => Math.round(Number(n || 0) * 100) / 100;
/** An Excalidraw colour → draw.io's: transparent is none, #rrggbbaa its #rrggbb. */
const colour = (c) => (!c || c === 'transparent' ? 'none' : /^#[0-9a-f]{8}$/i.test(c) ? c.slice(0, 7) : c);
const styleOf = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => (v === true ? k : `${k}=${v}`)).join(';') + ';';

// ── figures: draw.io's own style for each figure of the shapes panel (shapes/index.js) ──
const FC = (shape) => `shape=mxgraph.flowchart.${shape};whiteSpace=wrap;html=1;`;
const TASK = 'shape=mxgraph.bpmn.task2;whiteSpace=wrap;rectStyle=rounded;size=10;html=1;container=1;expand=0;collapsible=0;';
const EVENT = 'shape=mxgraph.bpmn.event;html=1;verticalLabelPosition=bottom;labelBackgroundColor=#ffffff;verticalAlign=top;align=center;perimeter=ellipsePerimeter;outlineConnect=0;aspect=fixed;';
const GATEWAY = 'shape=mxgraph.bpmn.gateway2;html=1;verticalLabelPosition=bottom;labelBackgroundColor=#ffffff;verticalAlign=top;align=center;perimeter=rhombusPerimeter;outlineConnect=0;';
const DATA = 'shape=mxgraph.bpmn.data2;labelPosition=center;verticalLabelPosition=bottom;align=center;verticalAlign=top;size=15;html=1;';
const ARROW = 'shape=singleArrow;whiteSpace=wrap;html=1;arrowWidth=0.5;arrowSize=0.4;';
const BOTTOM = 'verticalLabelPosition=bottom;verticalAlign=top;';

/** The BPMN events: <when>-<what> → draw.io's outline and symbol. */
const events = () => {
  const outline = { start: 'standard', catching: 'catching', throwing: 'throwing', end: 'end' };
  const symbol = { none: 'general', parallel: 'parallelMultiple' };
  const kinds = {
    start: ['none', 'message', 'timer', 'conditional', 'signal', 'multiple', 'parallel'],
    catching: ['message', 'timer', 'conditional', 'link', 'signal', 'error', 'multiple'],
    throwing: ['none', 'message', 'signal', 'escalation', 'link', 'compensation', 'multiple'],
    end: ['none', 'message', 'error', 'escalation', 'signal', 'terminate', 'cancel', 'compensation', 'multiple'],
  };
  return Object.entries(kinds).flatMap(([when, whats]) => whats.map((what) => [`bpmn-${when}-${what}`, `${EVENT}outline=${outline[when]};symbol=${symbol[what] || what};`]));
};

/** figure id → draw.io style (without its colours: those are the figure's own, added on export). */
export const FIGURE_STYLES = new Map([
  // General
  ['rect', 'rounded=0;whiteSpace=wrap;html=1;'],
  ['rounded', 'rounded=1;whiteSpace=wrap;html=1;'],
  ['ellipse', 'ellipse;whiteSpace=wrap;html=1;'],
  ['square', 'rounded=0;whiteSpace=wrap;html=1;aspect=fixed;'],
  ['circle', 'ellipse;whiteSpace=wrap;html=1;aspect=fixed;'],
  ['process', 'shape=process;whiteSpace=wrap;html=1;backgroundOutline=1;'],
  ['diamond', 'rhombus;whiteSpace=wrap;html=1;'],
  ['parallelogram', 'shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fixedSize=1;'],
  ['hexagon', 'shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;'],
  ['triangle', 'triangle;whiteSpace=wrap;html=1;'],
  ['cylinder', 'shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;'],
  ['cloud', 'ellipse;shape=cloud;whiteSpace=wrap;html=1;'],
  ['document', 'shape=document;whiteSpace=wrap;html=1;boundedLbl=1;'],
  ['internal', 'shape=internalStorage;whiteSpace=wrap;html=1;backgroundOutline=1;'],
  ['cube', 'shape=cube;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;darkOpacity=0.05;darkOpacity2=0.1;'],
  ['step', 'shape=step;perimeter=stepPerimeter;whiteSpace=wrap;html=1;fixedSize=1;'],
  ['trapezoid', 'shape=trapezoid;perimeter=trapezoidPerimeter;whiteSpace=wrap;html=1;fixedSize=1;'],
  ['tape', 'shape=tape;whiteSpace=wrap;html=1;'],
  ['note', 'shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;darkOpacity=0.05;'],
  ['card', 'shape=card;whiteSpace=wrap;html=1;'],
  ['callout', 'shape=callout;whiteSpace=wrap;html=1;perimeter=calloutPerimeter;'],
  ['actor', `shape=umlActor;${BOTTOM}html=1;outlineConnect=0;`],
  ['datastorage', 'shape=dataStorage;whiteSpace=wrap;html=1;fixedSize=1;'],
  ['or', 'shape=orEllipse;perimeter=ellipsePerimeter;whiteSpace=wrap;html=1;backgroundOutline=1;'],
  ['summing', 'shape=sumEllipse;perimeter=ellipsePerimeter;whiteSpace=wrap;html=1;backgroundOutline=1;'],
  ['cross', 'shape=cross;whiteSpace=wrap;html=1;'],
  ['star', `${BOTTOM}html=1;shape=mxgraph.basic.star;`],
  ['octagon', 'shape=mxgraph.basic.octagon2;html=1;whiteSpace=wrap;dx=15;'],
  ['pentagon', 'shape=mxgraph.basic.pentagon;html=1;whiteSpace=wrap;'],
  ['container', 'swimlane;startSize=28;whiteSpace=wrap;html=1;'],
  ['sticky', 'rounded=0;whiteSpace=wrap;html=1;'],
  ['sticky-pink', 'rounded=0;whiteSpace=wrap;html=1;'],
  ['sticky-blue', 'rounded=0;whiteSpace=wrap;html=1;'],
  ['sticky-green', 'rounded=0;whiteSpace=wrap;html=1;'],
  // Block arrows
  ['barrow-right', ARROW],
  ['barrow-left', `${ARROW}direction=west;`],
  ['barrow-up', `${ARROW}direction=north;`],
  ['barrow-down', `${ARROW}direction=south;`],
  ['barrow-double', 'shape=doubleArrow;whiteSpace=wrap;html=1;arrowWidth=0.5;arrowSize=0.3;'],
  ['barrow-notched', 'shape=mxgraph.arrows2.arrow;dy=0.5;dx=40;notch=15;html=1;whiteSpace=wrap;'],
  ['barrow-chevron', 'shape=mxgraph.arrows2.arrow;dy=0;dx=30;notch=30;html=1;whiteSpace=wrap;'],
  ['barrow-bend', 'shape=mxgraph.arrows2.bendArrow;dy=15;dx=38;notch=0;arrowHead=55;rounded=0;html=1;'],
  ['barrow-uturn', 'shape=mxgraph.arrows2.uTurnArrow;dy=11;arrowHead=43;dx2=25;html=1;'],
  ['barrow-quad', 'shape=mxgraph.arrows2.quadArrow;dy=10;dx=20;notch=0;arrowHead=10;html=1;'],
  // BPMN 2.0 activities
  ['bpmn-task', `${TASK}taskMarker=abstract;`],
  ['bpmn-user', `${TASK}taskMarker=user;`],
  ['bpmn-service', `${TASK}taskMarker=service;`],
  ['bpmn-send', `${TASK}taskMarker=send;`],
  ['bpmn-receive', `${TASK}taskMarker=receive;`],
  ['bpmn-manual', `${TASK}taskMarker=manual;`],
  ['bpmn-rule', `${TASK}taskMarker=businessRule;`],
  ['bpmn-script', `${TASK}taskMarker=script;`],
  ['bpmn-call', `${TASK}taskMarker=abstract;bpmnShapeType=call;`],
  ['bpmn-subprocess', `${TASK}taskMarker=abstract;isLoopSub=1;`],
  ['bpmn-loop', `${TASK}taskMarker=abstract;isLoopStandard=1;`],
  ['bpmn-parallel-mi', `${TASK}taskMarker=abstract;isLoopMultiParallel=1;`],
  ['bpmn-sequential-mi', `${TASK}taskMarker=abstract;isLoopMultiSeq=1;`],
  ['bpmn-adhoc', `${TASK}taskMarker=abstract;isAdHoc=1;isLoopSub=1;`],
  ['bpmn-transaction', `${TASK}taskMarker=abstract;bpmnShapeType=transaction;isLoopSub=1;`],
  ['bpmn-event-sub', `${TASK}taskMarker=abstract;dashed=1;dashPattern=1 2;isLoopSub=1;`],
  ['bpmn-expanded', 'rounded=1;arcSize=4;whiteSpace=wrap;html=1;verticalAlign=top;align=left;spacingLeft=6;container=1;'],
  // BPMN 2.0 events
  ...events(),
  // BPMN 2.0 gateways
  ['bpmn-gateway', `${GATEWAY}outline=none;symbol=none;`],
  ['bpmn-exclusive', `${GATEWAY}outline=none;symbol=none;gwType=exclusive;`],
  ['bpmn-parallel', `${GATEWAY}outline=none;symbol=none;gwType=parallel;`],
  ['bpmn-inclusive', `${GATEWAY}outline=end;symbol=general;`],
  ['bpmn-complex', `${GATEWAY}outline=none;symbol=none;gwType=complex;`],
  ['bpmn-event-gw', `${GATEWAY}outline=catching;symbol=multiple;`],
  ['bpmn-parallel-event-gw', `${GATEWAY}outline=standard;symbol=parallelMultiple;`],
  // BPMN 2.0 data and lanes
  ['bpmn-data', DATA],
  ['bpmn-data-in', `${DATA}bpmnTransferType=input;`],
  ['bpmn-data-out', `${DATA}bpmnTransferType=output;`],
  ['bpmn-data-many', `${DATA}isCollection=1;`],
  ['bpmn-store', 'shape=datastore;html=1;labelPosition=center;verticalLabelPosition=bottom;align=center;verticalAlign=top;'],
  ['bpmn-message', 'shape=message;whiteSpace=wrap;html=1;'],
  ['bpmn-annotation', 'shape=partialRectangle;whiteSpace=wrap;html=1;top=1;bottom=1;left=1;right=0;align=left;spacingLeft=6;'],
  ['bpmn-group', 'rounded=1;arcSize=10;dashed=1;dashPattern=8 3 1 3;html=1;whiteSpace=wrap;verticalAlign=top;'],
  ['bpmn-pool', 'swimlane;html=1;startSize=30;horizontal=0;whiteSpace=wrap;'],
  ['bpmn-lane', 'swimlane;html=1;startSize=30;horizontal=0;whiteSpace=wrap;'],
  // Flowchart
  ['fc-terminator', FC('terminator')],
  ['fc-process', 'rounded=0;whiteSpace=wrap;html=1;'],
  ['fc-decision', FC('decision')],
  ['fc-data', FC('data')],
  ['fc-predefined', FC('predefined_process')],
  ['fc-document', FC('document')],
  ['fc-multi-document', FC('multi-document')],
  ['fc-database', FC('database')],
  ['fc-direct-data', FC('direct_data')],
  ['fc-internal', FC('internal_storage')],
  ['fc-stored', FC('stored_data')],
  ['fc-manual-input', FC('manual_input')],
  ['fc-manual-operation', FC('manual_operation')],
  ['fc-preparation', FC('preparation')],
  ['fc-delay', FC('delay')],
  ['fc-display', FC('display')],
  ['fc-loop-limit', FC('loop_limit')],
  ['fc-merge', FC('merge_or_storage')],
  ['fc-extract', FC('extract_or_measurement')],
  ['fc-collate', FC('collate')],
  ['fc-sort', FC('sort')],
  ['fc-or', FC('or')],
  ['fc-summing', FC('summing_function')],
  ['fc-on-page', FC('on-page_reference')],
  ['fc-off-page', FC('off-page_reference')],
  ['fc-card', FC('card')],
  ['fc-tape', FC('paper_tape')],
  ['fc-annotation', FC('annotation_1')],
]);

// ── arrowheads ──
/**
 * An Excalidraw arrowhead → draw.io's, as [arrow, fill]: what an edge's end draws (`endArrow`/`startArrow`) and whether
 * it is filled (`endFill`/`startFill`). null (no head) is draw.io's 'none'.
 */
export function arrowhead(head) {
  switch (head) {
    case null: case undefined: return ['none', 0];
    case 'arrow': return ['open', 0];
    case 'triangle': return ['classic', 1]; // the vendored Excalidraw draws it notched, as draw.io's classic (BUILD.md)
    case 'triangle_outline': return ['block', 0];
    case 'bar': return ['dash', 0];
    case 'dot': case 'circle': return ['oval', 1];
    case 'circle_outline': return ['oval', 0];
    case 'diamond': return ['diamond', 1];
    case 'diamond_outline': return ['diamond', 0];
    case 'crowfoot_one': return ['ERmandOne', 0];
    case 'crowfoot_many': return ['ERmany', 0];
    case 'crowfoot_one_or_many': return ['ERoneToMany', 0];
    default: return ['classic', 1];
  }
}

// ── the pieces of a style ──
const STROKE_STYLE = { dashed: { dashed: 1 }, dotted: { dashed: 1, dashPattern: '1 4' } };
/** What every shape and edge carries of its element: its line, its fill, its turn, its see-through. */
const look = (e, { fill = true } = {}) => ({
  ...(fill ? { fillColor: colour(e.backgroundColor) } : {}),
  strokeColor: colour(e.strokeColor),
  strokeWidth: e.strokeWidth && e.strokeWidth !== 1 ? e.strokeWidth : undefined,
  ...(STROKE_STYLE[e.strokeStyle] || {}),
  rotation: e.angle ? r((e.angle * 180) / Math.PI) : undefined,
  opacity: e.opacity != null && e.opacity !== 100 ? e.opacity : undefined,
});
/** A text's font as a label's. */
const font = (t) => (t ? {
  fontSize: t.fontSize ? r(t.fontSize) : undefined,
  fontColor: t.strokeColor && t.strokeColor !== '#000000' ? colour(t.strokeColor) : undefined,
  align: t.textAlign && t.textAlign !== 'center' ? t.textAlign : undefined,
  verticalAlign: t.verticalAlign && t.verticalAlign !== 'middle' ? t.verticalAlign : undefined,
} : {});
const KIND = { rectangle: (e) => (e.roundness ? 'rounded=1;' : 'rounded=0;'), ellipse: () => 'ellipse;', diamond: () => 'rhombus;' };

const geometry = (e) => `<mxGeometry x="${r(e.x)}" y="${r(e.y)}" width="${r(e.width)}" height="${r(e.height)}" as="geometry"/>`;
const vertex = (id, value, style, e) => `<mxCell id="${attr(id)}" value="${attr(value)}" style="${attr(style)}" vertex="1" parent="1">${geometry(e)}</mxCell>`;

/**
 * The elements of a canvas → draw.io's XML (a whole .drawio file). `name` is the diagram's (its tab in draw.io);
 * `appState` the canvas's (its background and grid).
 */
export function toDrawio(elements, { name = 'Canvas', appState = {} } = {}) {
  const live = (elements || []).filter((e) => e && !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const boundText = (e) => live.find((t) => t.type === 'text' && t.containerId === e.id) || null;
  const done = new Set();     // the elements already exported (a figure's parts, a card's)
  const alias = new Map();    // an element's id → the id of the shape that stands for it in draw.io
  const cells = [];

  // A figure of the shapes panel: its box (or its outline, when it is its own box) stands for the whole group.
  for (const e of live) {
    const role = e.customData?.tmRole;
    if (!e.customData?.tmShape || (role !== 'box' && role !== 'outline')) continue;
    const style = FIGURE_STYLES.get(e.customData.tmShape);
    if (!style) continue;
    const g = e.groupIds?.[0];
    const parts = g ? live.filter((x) => x.groupIds?.includes(g) && x.customData?.tmShape) : [e];
    const ink = parts.filter((x) => x !== e && x.type !== 'text');
    const paint = role === 'outline' ? e : ink.find((x) => x.backgroundColor && x.backgroundColor !== 'transparent') || ink[0] || e;
    const text = boundText(e);
    const words = parts.filter((x) => x.type === 'text').map((x) => x.text).filter(Boolean); // a name drawn under it
    const value = text?.text || words.join('\n');
    // Its colours and its turn; not its line's width: a thick ring or border is part of the figure, and draw.io's style
    // already draws it (a call activity's, an end event's).
    const own = { ...look(paint), strokeWidth: undefined, strokeColor: colour((ink[0] || paint).strokeColor), rotation: look(e).rotation, ...font(text || parts.find((x) => x.type === 'text')) };
    cells.push(vertex(e.id, label(value), style + styleOf(own), e));
    for (const x of [...parts, text].filter(Boolean)) { done.add(x.id); alias.set(x.id, e.id); }
    for (const x of parts) { const t = boundText(x); if (t) done.add(t.id); }
  }

  // A card: its frame, with its title and kicker; its parts are drawn by its frame.
  for (const e of live) {
    const item = e.customData?.tmItem;
    if (!item || done.has(e.id)) continue;
    const parts = live.filter((x) => x.customData?.tmOf === item);
    const part = (name) => parts.find((x) => x.customData?.tmPart === name);
    const kicker = part('kicker')?.text;
    const title = e.customData.tmTitle || (part('title') && boundText(part('title'))?.text) || boundText(e)?.text || '';
    const meta = [part('status')?.text, part('priority')?.text].filter(Boolean).join(' · ');
    const value = `<b>${label(title)}</b>${[kicker, meta].filter(Boolean).map((s) => `<br><font color="#666666">${label(s)}</font>`).join('')}`;
    cells.push(vertex(e.id, value, `rounded=1;arcSize=8;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacing=12;${styleOf(look(e))}`, e));
    for (const x of [e, ...parts, ...parts.map(boundText), boundText(e)].filter(Boolean)) { done.add(x.id); alias.set(x.id, e.id); }
  }

  // The rest, one by one.
  const edges = [];
  for (const e of live) {
    if (done.has(e.id)) continue;
    if (KIND[e.type]) {
      const text = boundText(e);
      if (text) done.add(text.id);
      cells.push(vertex(e.id, label(text?.text || ''), `${KIND[e.type](e)}whiteSpace=wrap;html=1;${styleOf({ ...look(e), ...font(text) })}`, e));
    } else if (e.type === 'text' && !e.containerId) {
      cells.push(vertex(e.id, label(e.text), `text;html=1;whiteSpace=wrap;${styleOf({ ...font({ ...e, verticalAlign: e.verticalAlign || 'top', textAlign: e.textAlign || 'left' }), align: e.textAlign || 'left', verticalAlign: 'top', rotation: look(e).rotation })}`, e));
    } else if (e.type === 'frame' || e.type === 'magicframe') {
      cells.push(vertex(e.id, label(e.name || ''), `rounded=0;whiteSpace=wrap;html=1;fillColor=none;verticalAlign=top;align=left;spacingLeft=6;strokeColor=#bbbbbb;`, e));
    } else if (e.type === 'arrow' || e.type === 'line' || e.type === 'freedraw') {
      edges.push(e);
    }
  }
  // Edges after every shape, so each end finds the shape that stands for what it is bound to.
  for (const e of edges) {
    const text = live.find((t) => t.type === 'text' && t.containerId === e.id);
    const pts = (e.points || [[0, 0]]).map(([px, py]) => [r(e.x + px), r(e.y + py)]);
    const end = (b) => (b?.elementId && byId.has(b.elementId) ? alias.get(b.elementId) || b.elementId : null);
    const source = end(e.startBinding);
    const target = end(e.endBinding);
    const [sa, sf] = arrowhead(e.type === 'arrow' ? e.startArrowhead : null);
    const [ea, ef] = arrowhead(e.type === 'arrow' ? e.endArrowhead : null);
    const at = (b, x, y) => (b?.fixedPoint ? { [`${x}`]: r(Math.min(1, Math.max(0, b.fixedPoint[0]))), [`${y}`]: r(Math.min(1, Math.max(0, b.fixedPoint[1]))) } : {});
    const route = e.elbowed ? { edgeStyle: 'orthogonalEdgeStyle', rounded: 0 } : e.roundness ? { curved: 1, rounded: 1 } : { edgeStyle: 'none', rounded: 0 };
    const style = styleOf({
      ...route, html: 1, ...look(e, { fill: false }), startArrow: sa, startFill: sf, endArrow: ea, endFill: ef,
      ...(source ? at(e.startBinding, 'exitX', 'exitY') : {}), ...(target ? at(e.endBinding, 'entryX', 'entryY') : {}), ...font(text),
    });
    const [first, last] = [pts[0], pts.at(-1)];
    const inner = pts.slice(1, -1);
    const points = inner.length ? `<Array as="points">${inner.map(([x, y]) => `<mxPoint x="${x}" y="${y}"/>`).join('')}</Array>` : '';
    const ends = `${source ? ` source="${attr(source)}"` : ''}${target ? ` target="${attr(target)}"` : ''}`;
    cells.push(`<mxCell id="${attr(e.id)}" value="${attr(label(text?.text || ''))}" style="${attr(style)}" edge="1" parent="1"${ends}>`
      + `<mxGeometry relative="1" as="geometry"><mxPoint x="${first[0]}" y="${first[1]}" as="sourcePoint"/><mxPoint x="${last[0]}" y="${last[1]}" as="targetPoint"/>${points}</mxGeometry></mxCell>`);
  }

  const bg = appState.viewBackgroundColor && appState.viewBackgroundColor !== '#ffffff' ? ` background="${attr(colour(appState.viewBackgroundColor))}"` : '';
  const grid = appState.gridModeEnabled ? 1 : 0;
  return `<mxfile host="task-manager" type="device"><diagram name="${attr(name)}" id="${attr(diagramId(name))}">`
    + `<mxGraphModel grid="${grid}" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0"${bg}>`
    + `<root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram></mxfile>\n`;
}

/** A diagram id that is the same for the same name (draw.io wants one; a stable one keeps re-exports alike). */
function diagramId(name) {
  let h = 0;
  for (const c of String(name)) h = (Math.imul(h, 31) + c.codePointAt(0)) >>> 0;
  return `tm-${h.toString(36)}`;
}
