// A canvas on disk, and the cards on it. Pure: no DOM, no Excalidraw (the whiteboard turns skeletons into elements),
// so it is tested on its own (tests/js/canvasfile.test.mjs).
//
// The file is the one Obsidian's Excalidraw plugin writes, so the vault's canvases open there too:
//
//   ---
//   excalidraw-plugin: parsed
//   task-manager-canvas: Goals
//   ---
//   ==⚠  Switch to EXCALIDRAW VIEW … ⚠==
//
//   # Excalidraw Data
//   ## Text Elements
//   Launch the new checkout ^k3J9x
//
//   %%
//   ## Drawing
//   ```json
//   { "type": "excalidraw", "version": 2, "elements": [...], "appState": {...}, "files": {} }
//   ```
//   %%
//
// A card is an item on a canvas: a rounded rectangle with its text bound inside, `customData.tmItem` its item's id,
// and a `[[link]]` to its note (Obsidian follows it; the app opens the item instead).

export const SUFFIX = '.excalidraw.md';
const WARNING = '==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==';
const DRAWING = /##\s*Drawing\s*\n```(json|compressed-json)\n([\s\S]*?)\n```/;

/** An empty scene, as Excalidraw keeps one. */
export const emptyDrawing = () => ({ type: 'excalidraw', version: 2, source: 'task-manager', elements: [], appState: {}, files: {} });

/**
 * A canvas file's text → { frontmatter, drawing }. Also reads a bare `.excalidraw` JSON. A drawing Obsidian saved
 * compressed cannot be read here: it throws, saying how to fix it (the plugin's *Decompress current Excalidraw file*).
 */
export function parse(text) {
  const t = String(text || '');
  if (t.trimStart().startsWith('{')) return { frontmatter: null, drawing: { ...emptyDrawing(), ...JSON.parse(t) } };
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(t);
  const m = DRAWING.exec(t);
  if (!m) return { frontmatter: fm ? fm[1] : null, drawing: emptyDrawing() };
  if (m[1] === 'compressed-json') {
    throw new Error('This canvas was saved compressed by Obsidian. Open it there and run "Decompress current Excalidraw file", or turn off compression in the plugin\'s settings.');
  }
  return { frontmatter: fm ? fm[1] : null, drawing: { ...emptyDrawing(), ...JSON.parse(m[2]) } };
}

/** The text elements as the plugin lists them: `text ^id`, the deleted ones and the empty ones left out. */
const textElements = (elements) => elements.filter((e) => e.type === 'text' && !e.isDeleted && String(e.text || '').trim())
  .map((e) => `${e.text} ^${e.id}`);

/**
 * A drawing (Excalidraw's serializeAsJSON, parsed) → the file's text. `frontmatter` is the file's own (kept as it was:
 * Obsidian may have added keys); a new file gets the plugin's, naming its `host`.
 */
export function serialize(drawing, { frontmatter = null, host = '' } = {}) {
  const fm = frontmatter ?? ['excalidraw-plugin: parsed', ...(host ? [`task-manager-canvas: ${host}`] : []), 'tags: [excalidraw]'].join('\n');
  const texts = textElements(drawing.elements || []);
  return `---\n${fm}\n---\n${WARNING}\n\n# Excalidraw Data\n\n## Text Elements\n${texts.map((t) => `${t}\n\n`).join('')}%%\n## Drawing\n\`\`\`json\n${JSON.stringify(drawing, null, '\t')}\n\`\`\`\n%%\n`;
}

/** A canvas's name → its file name ("Q1 roadmap" → "Q1 roadmap.excalidraw.md"); null when it cannot be one. */
export function fileName(name) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (!n || n.length > 80 || /[\\/:*?"<>|#^[\]]/.test(n) || n.startsWith('.')) return null;
  return `${n}${SUFFIX}`;
}

// ── cards ────────────────────────────────────────────────────────────────────
// A card is drawn as a board's card: a white frame (the element that is the card: `customData.tmItem`, its [[link]],
// what arrows bind to), and on it, grouped with it, its parts (`customData.tmPart`, `tmOf` its item): the title
// (wrapped, two lines at most), under it a kicker line (GOL-27), then its status (a dot of its hue and its name) and
// its priority (its bars and its name, in its colour) as the app shows them, a note on the right (0 of 4 closed) and a
// progress bar. The provider's card(item) says what goes in each:
//
//   { title, kicker?, status?: { label, key }, priority?, note?, progress?: { done, total }, link? }
//
// A card whose item changed is redrawn part by part (its frame stays: your colour, its place, the arrows on it).
export const CARD = { width: 280, height: 104, pad: 14 }; // height: a one-line title's (cardHeight)
export const CARD_LAYOUT = 5; // bumped when the parts are laid out anew: every card is redrawn the next time it is seen

/** A status's hue (app.css .s-* --st-dot): the dot before its name. */
export const DOTS = {
  backlog: '#8a8f98', todo: '#1a73e8', onhold: '#d99a06', blocked: '#d93025', inprogress: '#e8710a', review: '#8e44ad',
  done: '#1e8e3e', discarded: '#8a5a3c',
};
const keyOf = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const dotOf = (status) => DOTS[keyOf(status)] || DOTS.backlog;
/** A priority's ink and how many of its three bars are full (app.css .pr-*: Urgent/P0 … Low/P3). */
export function priorityOf(name) {
  const k = keyOf(name);
  return k === 'urgent' || k === 'p0' ? { ink: '#c5221f', bars: 3 } : k === 'high' || k === 'p1' ? { ink: '#b45309', bars: 3 }
    : k === 'normal' || k === 'p2' ? { ink: '#1a62c7', bars: 2 } : { ink: '#6b6b72', bars: 1 };
}
const INK = '#1e1e1e';
const QUIET = '#6b6b72';
const LINE = '#dcdce1';
const CHAR = 6.7; // Nunito's mean width at 13 px: where the priority starts after the status's name

/** Is this element a card (its frame, not a part)? */
export const isCard = (e) => !!e?.customData?.tmItem && !e.isDeleted && e.type !== 'text';

/** The cards on a canvas: Map item id → its frame. */
export function cardsOn(elements) {
  const out = new Map();
  for (const e of elements || []) if (isCard(e)) out.set(e.customData.tmItem, e);
  return out;
}

/** A card's signature: what it says, so a changed item is found without reading the drawing. */
export const cardSig = (c) => JSON.stringify([CARD_LAYOUT, c.title || '', c.kicker || '', c.status?.label || '', c.status?.key || '',
  c.priority || '', c.note || '', c.progress ? [c.progress.done, c.progress.total] : null]);

/** A title cut to what two lines of the card hold. */
export const clip = (text, max = 56) => { const t = String(text || '').trim().replace(/\s+/g, ' '); return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t; };

// The card's rhythm, top to bottom: 12 · the title (20 a line) · 4 · the ID (15) · 10 · status and priority (17) · 10 ·
// the progress bar (4) · 12. Even gaps, the card as tall as what it holds.
const LEAD = { title: 20, kicker: 15, row: 17 };
/** How many lines a title takes on a card `width` wide (Nunito 16: ~9 px a character), two at most. */
export const titleLines = (title, width = CARD.width) => (clip(title).length > Math.floor((width - 2 * CARD.pad) / 9) ? 2 : 1);
/** A card's height for what it shows. */
export const cardHeight = (card, width = CARD.width) => 12 + titleLines(card.title, width) * LEAD.title
  + (card.kicker ? 4 + LEAD.kicker : 0) + 10 + LEAD.row + (card.progress?.total ? 10 + 4 : 0) + 12;

/** The parts of a card on a frame at { x, y, width }, as skeletons (convertToExcalidrawElements). */
export function partSkeletons(itemId, card, frame) {
  const { pad } = CARD;
  const { x, y, width: w } = frame;
  const part = (name, el) => ({ roughness: 0, fontFamily: 6, ...el, customData: { tmPart: name, tmOf: itemId } });
  const box = { strokeColor: 'transparent', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1 };
  const solid = (color) => ({ strokeColor: color, backgroundColor: color, fillStyle: 'solid', strokeWidth: 1 });
  const out = [];
  // The title first, as on a board's card, in a frameless box: it wraps there (bound text, 5 px in from the box).
  const lines = titleLines(card.title, w);
  out.push(part('title', { ...box, type: 'rectangle', x: x + pad - 5, y: y + 7, width: w - 2 * pad + 10, height: lines * LEAD.title + 10,
    label: { text: clip(card.title), fontSize: 16, fontFamily: 6, textAlign: 'left', verticalAlign: 'top', strokeColor: INK } }));
  let top = y + 12 + lines * LEAD.title;
  if (card.kicker) { out.push(part('kicker', { type: 'text', x: x + pad, y: top + 4, text: card.kicker, fontSize: 12, strokeColor: QUIET })); top += 4 + LEAD.kicker; }
  const row = top + 10; // the meta row: status, then priority; the note at its right
  let at = x + pad;
  if (card.status?.label) {
    out.push(part('dot', { ...solid(dotOf(card.status.key)), type: 'ellipse', x: at, y: row + 5, width: 8, height: 8 }));
    out.push(part('status', { type: 'text', x: at + 14, y: row, text: card.status.label, fontSize: 13, strokeColor: INK }));
    at += 14 + Math.round(card.status.label.length * CHAR) + 14;
  }
  if (card.priority) {
    const pr = priorityOf(card.priority);
    [4, 7, 10].forEach((bh, i) => out.push(part(`bar${i + 1}`, { ...solid(i < pr.bars ? pr.ink : '#d6d6dc'), type: 'rectangle',
      x: at + i * 4, y: row + 14 - bh, width: 2.5, height: bh })));
    out.push(part('priority', { type: 'text', x: at + 16, y: row, text: card.priority, fontSize: 13, strokeColor: pr.ink }));
  }
  if (card.note) {
    out.push(part('note', { ...box, type: 'rectangle', x: x + w / 2, y: row - 3, width: w / 2 - pad + 5, height: 24,
      label: { text: card.note, fontSize: 12, fontFamily: 6, textAlign: 'right', verticalAlign: 'middle', strokeColor: QUIET } }));
  }
  if (card.progress?.total) {
    const full = w - 2 * pad;
    const done = Math.round((full * Math.min(card.progress.done, card.progress.total)) / card.progress.total);
    const bar = { type: 'rectangle', y: row + LEAD.row + 10, height: 4, roundness: { type: 3 } };
    out.push(part('track', { ...bar, ...solid('#ececef'), x: x + pad, width: full }));
    if (done > 0) out.push(part('done', { ...bar, ...solid(DOTS.done), x: x + pad, width: done }));
  }
  return out;
}

/**
 * A card as skeletons, its top-left at `at`: the frame first, then its parts. `card` is the provider's for the item.
 * They share a group (the whiteboard sets it), so the card moves as one.
 */
export function cardSkeleton(item, card, at, kind = '') {
  const frame = {
    type: 'rectangle', x: Math.round(at.x), y: Math.round(at.y), width: CARD.width, height: cardHeight(card),
    strokeColor: LINE, backgroundColor: '#ffffff', fillStyle: 'solid', strokeWidth: 1, roughness: 0, roundness: { type: 3 },
    link: card.link || null, customData: { tmItem: item.id, tmKind: kind, tmSig: cardSig(card), tmTitle: card.title },
  };
  return [frame, ...partSkeletons(item.id, card, frame)];
}

/** The items not on the canvas yet, in their own order. */
export const unplaced = (items, elements) => { const on = cardsOn(elements); return items.filter((i) => !on.has(i.id)); };

/**
 * The cards that no longer say what their item does (a title changed, a status, its progress): [{ id (the frame's),
 * item, card }]. An item gone gets a card saying so, once. `items` maps id → item; `card(item)` is the provider's.
 */
export function staleCards(elements, items, card) {
  const out = [];
  for (const [id, frame] of cardsOn(elements)) {
    const item = items.get(id);
    const want = item ? card(item) : { title: frame.customData.tmTitle || '', status: { label: 'Deleted', key: 'discarded' } };
    if (frame.customData.tmSig !== cardSig(want)) out.push({ id: frame.id, item: id, card: want });
  }
  return out;
}

/** The cards whose link no longer names their item's note (its file renamed with its title): [{ id, link }]. */
export function staleLinks(elements, items, card) {
  const out = [];
  for (const [id, frame] of cardsOn(elements)) {
    const item = items.get(id);
    const link = item ? card(item).link || null : null;
    if (item && (frame.link || null) !== link) out.push({ id: frame.id, link });
  }
  return out;
}
