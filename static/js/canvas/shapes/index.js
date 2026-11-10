// The shapes panel's catalog (canvas/shapepanel.js): its families, in the order the panel lists them, each a list of
// figures (kit.js `figure`). The figures come from the process-diagram system's draw.io libraries — General, the block
// arrows, BPMN 2.0, Flowchart — drawn in the canvas's own primitives.
import { ACTIVITIES, DATA, EVENTS, FLOWS, GATEWAYS } from './bpmn.js';
import { FLOWCHART } from './flowchart.js';
import { ARROWS, GENERAL } from './general.js';

/** [{ key, title, shapes: [figure] }]. Only General starts unfolded. */
export const CATEGORIES = [
  { key: 'general', title: 'General', shapes: GENERAL, open: true },
  { key: 'arrows', title: 'Arrows', shapes: ARROWS },
  { key: 'bpmn-activities', title: 'BPMN 2.0 Activities', shapes: ACTIVITIES },
  { key: 'bpmn-events', title: 'BPMN 2.0 Events', shapes: EVENTS },
  { key: 'bpmn-gateways', title: 'BPMN 2.0 Gateways', shapes: GATEWAYS },
  { key: 'bpmn-data', title: 'BPMN 2.0 Data and lanes', shapes: DATA },
  { key: 'bpmn-flows', title: 'BPMN 2.0 Flows', shapes: FLOWS },
  { key: 'flowchart', title: 'Flowchart', shapes: FLOWCHART },
];

/** id → figure. */
export const SHAPES = new Map(CATEGORIES.flatMap((c) => c.shapes.map((s) => [s.id, s])));

/** The categories with only the figures whose name (or keywords, or family) has every word of `q` in it. */
export function search(q, categories = CATEGORIES) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return categories;
  return categories.map((c) => ({ ...c, shapes: c.shapes.filter((s) => {
    const hay = `${s.name} ${s.keywords} ${c.title}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  }) })).filter((c) => c.shapes.length);
}
