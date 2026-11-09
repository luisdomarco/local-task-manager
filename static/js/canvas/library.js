// The shapes every canvas starts with in Excalidraw's Library panel: sticky notes, the flow figures (BPMN's tasks,
// gateways and events, a decision), a lane and a title. Data, not a component: Excalidraw skeletons the whiteboard turns
// into library items (convertToExcalidrawElements). Drawn clean (roughness 0) in one palette: ink #343a40 on white, the
// font the canvas writes in (Nunito). A figure of several shapes shares a group, so it moves as one.

const INK = '#343a40';
const base = { roughness: 0, strokeWidth: 2, strokeColor: INK, backgroundColor: '#ffffff', fillStyle: 'solid' };
const label = (text, fontSize = 16) => ({ text, fontSize, fontFamily: 6, strokeColor: INK });
const group = (id, els) => els.map((e) => ({ ...e, groupIds: [id] }));
const line = (x, y, dx, dy, extra = {}) => ({ ...base, type: 'line', x, y, points: [[0, 0], [dx, dy]], strokeWidth: 4, ...extra });

/** A sticky note: no frame, a soft colour, text written straight on it (double-click). */
const sticky = (id, name, bg) => ({ id, name, skeleton: [{ ...base, type: 'rectangle', x: 0, y: 0, width: 180, height: 180, strokeColor: 'transparent', backgroundColor: bg }] });
/** A diamond gateway (BPMN), 60 × 60, with what is drawn inside it. */
const gateway = (id, name, inside) => ({ id, name, skeleton: group(id, [{ ...base, type: 'diamond', x: 0, y: 0, width: 60, height: 60 }, ...inside]) });

/** [{ id, name, skeleton: [...] }] */
export const LIBRARY = [
  sticky('tm-sticky', 'Sticky note', '#fff3bf'),
  sticky('tm-sticky-pink', 'Sticky note (pink)', '#ffdeeb'),
  sticky('tm-sticky-blue', 'Sticky note (blue)', '#d0ebff'),
  sticky('tm-sticky-green', 'Sticky note (green)', '#d3f9d8'),
  { id: 'tm-process', name: 'Task', skeleton: [{ ...base, type: 'rectangle', x: 0, y: 0, width: 180, height: 80, roundness: { type: 3 }, label: label('Task') }] },
  { id: 'tm-decision', name: 'Decision', skeleton: [{ ...base, type: 'diamond', x: 0, y: 0, width: 170, height: 110, label: label('Decision?') }] },
  gateway('tm-exclusive', 'Exclusive gateway', [line(21, 21, 18, 18), line(21, 39, 18, -18)]),
  gateway('tm-parallel', 'Parallel gateway', [line(30, 17, 0, 26), line(17, 30, 26, 0)]),
  gateway('tm-inclusive', 'Inclusive gateway', [{ ...base, type: 'ellipse', x: 17, y: 17, width: 26, height: 26, strokeWidth: 4, backgroundColor: 'transparent' }]),
  { id: 'tm-start', name: 'Start event', skeleton: [{ ...base, type: 'ellipse', x: 0, y: 0, width: 48, height: 48, strokeColor: '#2f9e44', backgroundColor: '#ebfbee' }] },
  {
    id: 'tm-intermediate', name: 'Intermediate event', skeleton: group('tm-intermediate', [
      { ...base, type: 'ellipse', x: 0, y: 0, width: 48, height: 48, strokeWidth: 1, strokeColor: '#e8590c', backgroundColor: '#fff4e6' },
      { ...base, type: 'ellipse', x: 5, y: 5, width: 38, height: 38, strokeWidth: 1, strokeColor: '#e8590c', backgroundColor: 'transparent' },
    ]),
  },
  { id: 'tm-end', name: 'End event', skeleton: [{ ...base, type: 'ellipse', x: 0, y: 0, width: 48, height: 48, strokeWidth: 4, strokeColor: '#e03131', backgroundColor: '#fff5f5' }] },
  {
    id: 'tm-lane', name: 'Lane', skeleton: group('tm-lane', [
      { ...base, type: 'rectangle', x: 0, y: 0, width: 720, height: 220, strokeWidth: 1, strokeColor: '#adb5bd', backgroundColor: 'transparent' },
      { ...base, type: 'rectangle', x: 0, y: 0, width: 44, height: 220, strokeWidth: 1, strokeColor: '#adb5bd', backgroundColor: '#f1f3f5' },
      { type: 'text', x: 58, y: 12, text: 'Lane', fontSize: 16, fontFamily: 6, strokeColor: '#868e96', roughness: 0 },
    ]),
  },
  { id: 'tm-title', name: 'Title', skeleton: [{ type: 'text', x: 0, y: 0, text: 'Title', fontSize: 36, fontFamily: 6, strokeColor: '#1e1e1e', roughness: 0 }] },
];
