// A figure's picture in the shapes panel: its own skeleton (kit.js), drawn as a small SVG — the same parts the canvas
// gets, so the panel never shows one thing and drops another. Its ink in `currentColor` and its paper in
// `--shape-paper`, so it follows the page's theme. Pure: a string (tests/js/canvasshapes.test.mjs).
import { BOX_FILL, INK, NONE, PAPER } from './kit.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const colour = (c) => (!c || c === NONE ? 'none' : c === INK ? 'currentColor' : c === PAPER ? 'var(--shape-paper, #fff)' : c);
const textBox = (p) => {
  const lines = String(p.text).split('\n');
  const w = Math.max(...lines.map((l) => l.length)) * p.fontSize * 0.55;
  const h = lines.length * p.fontSize * 1.25;
  return { w, h };
};

/** The box x0, y0, x1, y1 that holds every part (a turned text by its middle). */
function bounds(parts) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const p of parts) {
    if (p.points) for (const [px, py] of p.points) add(p.x + px, p.y + py);
    else if (p.type === 'text') {
      const { w, h } = textBox(p);
      const turned = p.angle && Math.abs(Math.sin(p.angle)) > 0.5;
      const [cx, cy] = [p.x + w / 2, p.y + h / 2];
      const [hw, hh] = turned ? [h / 2, w / 2] : [w / 2, h / 2];
      add(cx - hw, cy - hh); add(cx + hw, cy + hh);
    } else { add(p.x, p.y); add(p.x + p.width, p.y + p.height); }
  }
  return [x0, y0, x1, y1];
}

/** An arrowhead at `tip`, coming from `from` (`len` long in the picture's units). */
function head(kind, tip, from, len, stroke) {
  if (!kind) return '';
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const at = (d, side) => [tip[0] - d * Math.cos(a) + side * Math.sin(a), tip[1] - d * Math.sin(a) - side * Math.cos(a)];
  const pts = (ps) => ps.map((p) => p.map((n) => n.toFixed(2)).join(',')).join(' ');
  const s = `stroke="${stroke}" vector-effect="non-scaling-stroke"`;
  if (kind === 'bar') { const [p, q] = [at(0, len * 0.5), at(0, -len * 0.5)]; return `<polyline points="${pts([p, q])}" fill="none" ${s}/>`; }
  if (kind === 'circle' || kind === 'circle_outline' || kind === 'dot') {
    const c = at(len * 0.35, 0);
    return `<circle cx="${c[0].toFixed(2)}" cy="${c[1].toFixed(2)}" r="${(len * 0.35).toFixed(2)}" fill="${kind === 'circle_outline' ? 'var(--shape-paper, #fff)' : stroke}" ${s}/>`;
  }
  if (kind === 'diamond' || kind === 'diamond_outline') {
    return `<polygon points="${pts([tip, at(len * 0.5, len * 0.35), at(len, 0), at(len * 0.5, -len * 0.35)])}" fill="${kind === 'diamond' ? stroke : 'var(--shape-paper, #fff)'}" ${s}/>`;
  }
  const wing = [at(len, len * 0.45), tip, at(len, -len * 0.45)];
  if (kind === 'arrow') return `<polyline points="${pts(wing)}" fill="none" ${s}/>`;
  return `<polygon points="${pts(wing)}" fill="${kind === 'triangle_outline' ? 'var(--shape-paper, #fff)' : stroke}" ${s}/>`;
}

/** A part's label (a container's, an annotation's), where Excalidraw puts it: in the middle, or at its top or left. */
function label(p) {
  const l = p.label;
  if (!l?.text) return '';
  const left = l.textAlign === 'left';
  const x = left ? p.x + 6 : p.x + p.width / 2;
  const y = l.verticalAlign === 'top' ? p.y + l.fontSize + 6 : p.y + p.height / 2 + l.fontSize * 0.35;
  return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${l.fontSize}" text-anchor="${left ? 'start' : 'middle'}" style="font-family:var(--font, sans-serif)" fill="currentColor">${esc(l.text)}</text>`;
}

/** One part as SVG, with its label (the box itself is not drawn: it is not seen). */
function part(p, scale) {
  return (p.backgroundColor === BOX_FILL ? '' : shape(p, scale)) + label(p);
}

function shape(p, scale) {
  const stroke = colour(p.strokeColor);
  const fill = colour(p.backgroundColor);
  const sw = (p.strokeWidth || 1) >= 3 ? 2 : (p.strokeWidth || 1) > 1 ? 1.5 : 1;
  const dash = p.strokeStyle === 'dashed' ? ` stroke-dasharray="${(4 / scale).toFixed(2)} ${(3 / scale).toFixed(2)}"`
    : p.strokeStyle === 'dotted' ? ` stroke-dasharray="${(1.5 / scale).toFixed(2)} ${(2 / scale).toFixed(2)}"` : '';
  const line = `stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"${dash}`;
  const n = (v) => Number(v).toFixed(2);
  if (p.type === 'rectangle') {
    const r = p.roundness ? Math.min(p.roundness.value || 32, Math.min(p.width, p.height) * 0.25) : 0;
    return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.width)}" height="${n(p.height)}" rx="${n(r)}" fill="${fill}" ${line}/>`;
  }
  if (p.type === 'ellipse') return `<ellipse cx="${n(p.x + p.width / 2)}" cy="${n(p.y + p.height / 2)}" rx="${n(p.width / 2)}" ry="${n(p.height / 2)}" fill="${fill}" ${line}/>`;
  if (p.type === 'diamond') {
    const { x, y, width: w, height: h } = p;
    return `<polygon points="${[[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]].map((q) => q.map(n).join(',')).join(' ')}" fill="${fill}" ${line}/>`;
  }
  if (p.type === 'line' || p.type === 'arrow') {
    const pts = p.points.map(([px, py]) => [p.x + px, p.y + py]);
    const list = pts.map((q) => q.map(n).join(',')).join(' ');
    const closed = pts.length > 2 && fill !== 'none';
    let out = closed ? `<polygon points="${list}" fill="${fill}" ${line}/>` : `<polyline points="${list}" fill="none" ${line}/>`;
    if (p.type === 'arrow') {
      const len = 9 / scale;
      out += head(p.endArrowhead, pts[pts.length - 1], pts[pts.length - 2], len, stroke) + head(p.startArrowhead, pts[0], pts[1], len, stroke);
    }
    return out;
  }
  if (p.type === 'text') {
    const { w, h } = textBox(p);
    const turn = p.angle ? ` transform="rotate(${n((p.angle * 180) / Math.PI)} ${n(p.x + w / 2)} ${n(p.y + h / 2)})"` : '';
    return `<text x="${n(p.x)}" y="${n(p.y + p.fontSize)}" font-size="${n(p.fontSize)}" style="font-family:var(--font, sans-serif)" fill="${stroke}"${turn}>${esc(p.text)}</text>`;
  }
  return '';
}

/** `fig` (a figure of the catalog) as an SVG `size` px square, with `pad` px around it. */
export function thumbSvg(fig, { size = 36, pad = 3 } = {}) {
  const parts = fig.skeleton(0, 0);
  let [x0, y0, x1, y1] = bounds(parts);
  // A lone line is drawn across the square (draw.io's picture of an edge), not as a hair.
  if (y1 - y0 < 1) { y0 -= 10; y1 += 10; }
  const span = Math.max(x1 - x0, y1 - y0) || 1;
  const scale = (size - pad * 2) / span;
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const half = span / 2 + pad / scale;
  const view = [cx - half, cy - half, half * 2, half * 2].map((v) => v.toFixed(2)).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${view}" aria-hidden="true" stroke-linejoin="round" stroke-linecap="round">${parts.map((p) => part(p, scale)).join('')
    // A CSS variable is read in a style, not in an attribute.
    .replaceAll('fill="var(--shape-paper, #fff)"', 'style="fill:var(--shape-paper, #fff)"')}</svg>`;
}
