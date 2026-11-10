// One canvas file as an Excalidraw whiteboard: mounted once per file (a page that repaints keeps it), saved as you draw
// (against the file's rev, as the Explorer's editor), its cards kept saying what their items do. Knows no page: what
// goes on a card, and what a click on one does, is the provider's (docs/design.md, Canvases).
//
//   provider  { kind: 'goal', label: 'Goals',
//               all() → Map id → item (every item a card may show; one missing is "(deleted)"),
//               card(item) → { title, lines[], link },
//               open(item) }
import { api, fileUrl } from '../api.js';
import { pref, setPref } from '../prefs.js';
import { toast } from '../state.js';
import { CARD, cardHeight, cardSig, cardSkeleton, cardsOn, parse, partSkeletons, serialize, staleCards, staleLinks } from './canvasfile.js';
import { anchor, bindingTo, snapArrows } from './anchors.js';
import { mountAnchors } from './anchorlayer.js';
import { toDrawio } from './drawio.js';
import { icon } from '../ui.js';
import { loadExcalidraw } from './loader.js';
import { SHAPE_MIME } from './shapepanel.js';
import { SHAPES } from './shapes/index.js';
import { boxRepairs } from './shapes/kit.js';

export const ITEM_MIME = 'application/x-tm-item'; // a side list's row, dragged: its item's id
const SAVE_AFTER = 800; // ms of quiet before a save
const LIBRARY_PREF = 'canvas.library'; // what you added to Excalidraw's Library panel (the app's shapes are its own panel's)

/** Light or dark, as the page is: theme.js always sets data-theme, the system's choice resolved. */
const pageTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

/** The canvas's own defaults, as draw.io draws: clean lines, a thin black line, square corners, the normal font (each
 *  element can still be changed). */
const CLEAN = { currentItemRoughness: 0, currentItemFontFamily: 6, currentItemFontSize: 16, currentItemRoundness: 'sharp', currentItemStrokeWidth: 1,
  currentItemStrokeColor: '#000000',
  currentItemArrowType: 'elbow', // a connector, as Miro's: straight and curved are a click away in the arrow's properties
  currentItemEndArrowhead: 'triangle', // filled, as draw.io's (Excalidraw's own is an open V)
  // Shapes filled white, as Miro's: Excalidraw takes hold of a shape with no fill only by its outline, so one drawn
  // transparent could not be dragged from its middle (transparent is still a swatch away).
  currentItemBackgroundColor: '#ffffff', currentItemFillStyle: 'solid' };

/**
 * What a canvas saved with Excalidraw's own defaults draws new: its shapes filled too, its arrows' heads filled (its
 * open V was Excalidraw's default, not a choice: one picked since in the arrow's properties is kept for that arrow).
 */
const unfilled = (st) => ({
  ...(!st?.currentItemBackgroundColor || st.currentItemBackgroundColor === 'transparent'
    ? { currentItemBackgroundColor: CLEAN.currentItemBackgroundColor, currentItemFillStyle: CLEAN.currentItemFillStyle } : {}),
  ...(!st?.currentItemEndArrowhead || st.currentItemEndArrowhead === 'arrow' ? { currentItemEndArrowhead: CLEAN.currentItemEndArrowhead } : {}),
});

/** What a canvas looks like besides its drawing, kept in its file: its background colour and whether it shows a grid. */
const lookOf = (st) => `${st?.viewBackgroundColor || ''}|${st?.gridModeEnabled ? 'grid' : 'plain'}`;

/** A file downloaded from the page: `text` saved as `name`. */
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The canvas's fonts loaded (Nunito: the cards and the default text), or given up on after a few seconds. */
const fontsReady = () => Promise.race([
  Promise.all(['16px Nunito', '12px Nunito', '20px Excalifont'].map((f) => document.fonts.load(f).catch(() => null))),
  new Promise((resolve) => { setTimeout(resolve, 3000); }),
]);

async function readFile(path) {
  const res = await fetch(fileUrl(path), { cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 404 ? 'This canvas is gone.' : `Could not read the canvas (${res.status}).`);
  return { text: await res.text(), rev: res.headers.get('X-TM-Rev') };
}

/**
 * Mount the canvas at `path` in `el`. → { addCard(item, at?), locate(id), sync(), placed() → Set of ids, ready, destroy() }.
 * `onCards(placed)` is told whenever the cards on it change (one added, one deleted on the canvas).
 */
export function mountWhiteboard(el, { path, host, name, provider, onCards = () => {} }) {
  let xapi = null; // Excalidraw's imperative API
  let lib = null; // window.ExcalidrawLib
  let root = null; // the React root
  let file = null; // { frontmatter, rev }
  let saved = -1; // the scene version on disk
  let savedLook = ''; // and its look (lookOf): a background or a grid changed is saved too, the drawing the same
  let timer = null;
  let saving = null; // the save in flight
  let dead = false;
  let cardsKey = '';
  let dots = null; // the anchor dots over the drawing (anchorlayer.js)

  el.classList.add('wb');
  el.replaceChildren(Object.assign(document.createElement('div'), { className: 'wb-loading muted', textContent: 'Loading the canvas…' }));

  const elements = () => xapi?.getSceneElementsIncludingDeleted() || [];
  const placed = () => new Set(cardsOn(xapi?.getSceneElements() || []).keys());
  const tellCards = () => {
    const ids = placed();
    const key = [...ids].sort().join('\n');
    if (key !== cardsKey) { cardsKey = key; onCards(ids); }
  };

  // ── saving ──
  const text = () => {
    const json = JSON.parse(lib.serializeAsJSON(xapi.getSceneElements(), xapi.getAppState(), xapi.getFiles(), 'local'));
    return serialize({ ...json, source: 'task-manager' }, { frontmatter: file.frontmatter, host });
  };
  async function save(force = false) {
    clearTimeout(timer); timer = null;
    if (!xapi || !file) return;
    const version = lib.getSceneVersion(elements());
    const look = lookOf(xapi.getAppState());
    if (version === saved && look === savedLook && !force) return;
    if (saving) { await saving.catch(() => {}); return save(force); }
    saving = api.saveFile(path, text(), file.rev, force);
    try {
      const r = await saving;
      file.rev = r.rev;
      saved = version;
      savedLook = look;
    } catch (err) {
      if (err.status !== 409) { toast(`Canvas not saved: ${err.message}`, true); return; }
      // Changed on disk (Obsidian, another tab): what is there now, and yours a click away.
      const mine = elements();
      await reload();
      toast('This canvas changed outside the app: reloaded from disk.', true, { label: 'Keep mine', run: () => { put(mine); return save(true); } });
    } finally { saving = null; }
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(() => save(), SAVE_AFTER); };

  // ── reading ──
  const put = (els) => xapi.updateScene({ elements: lib.restoreElements(els, null, { refreshDimensions: false, repairBindings: true }) });
  async function load() {
    const { text: t, rev } = await readFile(path);
    const { frontmatter, drawing } = parse(t);
    file = { frontmatter, rev };
    return drawing;
  }
  async function reload() {
    const drawing = await load();
    put(drawing.elements || []);
    saved = lib.getSceneVersion(elements());
    sync();
    tellCards();
  }
  // Back on the page (from Obsidian, say): a canvas changed there is read again, unless you have unsaved strokes.
  async function onFocus() {
    if (!xapi || !file || timer || saving || document.hidden) return;
    try {
      const { canvases } = await api.canvases(host);
      const now = canvases.find((c) => c.path === path);
      if (now && now.rev !== file.rev && !timer && !saving) await reload();
    } catch { /* the next save finds out */ }
  }

  // ── cards ──
  /** Turn skeletons into elements, keeping what convertToExcalidrawElements may drop (a card's link and its mark). */
  const build = (skeletons) => {
    const out = lib.convertToExcalidrawElements(skeletons, { regenerateIds: true });
    skeletons.forEach((s, i) => {
      const e = out.find((x) => x.type === s.type && x.x === s.x && x.y === s.y && !x.containerId && !out.slice(0, i).includes(x));
      if (e) Object.assign(e, { link: s.link ?? e.link ?? null, customData: s.customData ?? e.customData });
    });
    return out;
  };
  /** The scene point at the middle of the view (a click on a side row adds there). */
  const middle = () => {
    const r = el.getBoundingClientRect();
    return lib.viewportCoordsToSceneCoords({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }, xapi.getAppState());
  };
  function addCard(item, at = null) {
    if (!xapi) return;
    const on = cardsOn(xapi.getSceneElements());
    if (on.has(item.id)) { locate(item.id); return; }
    let p = at || middle();
    p = { x: p.x - CARD.width / 2, y: p.y - CARD.height / 2 };
    // Clicked in, not dropped: beside the cards already there, never on one.
    const GAP = 24;
    const hits = (q) => xapi.getSceneElements().some((r) => !r.containerId && r.type !== 'arrow' && r.type !== 'line'
      && q.x < r.x + r.width + GAP && r.x < q.x + CARD.width + GAP && q.y < r.y + r.height + GAP && r.y < q.y + CARD.height + GAP);
    for (let n = 0; !at && hits(p) && n < 200; n += 1) p = { x: p.x + CARD.width + GAP, y: p.y };
    const made = build(cardSkeleton(item, provider.card(item), p, item.type || provider.kind));
    const group = [`tm-${item.id}-${Date.now().toString(36)}`]; // the frame and its parts move as one
    for (const e of made) e.groupIds = group;
    xapi.updateScene({ elements: [...elements(), ...made], appState: { selectedElementIds: { [made[0].id]: true }, selectedGroupIds: { [group[0]]: true } },
      captureUpdate: lib.CaptureUpdateAction.IMMEDIATELY });
    tellCards();
  }
  function locate(id) {
    const rect = cardsOn(xapi?.getSceneElements() || []).get(id);
    if (!rect) return;
    xapi.updateScene({ appState: { selectedElementIds: { [rect.id]: true } } });
    xapi.scrollToContent([rect], { animate: true });
  }
  /**
   * Each card says what its item does now (a title renamed, a status moved): a changed card's parts are drawn again on
   * its frame, which stays (your colour, its place, the arrows bound to it). Not an undo step: the item changed, not you.
   */
  function sync() {
    if (!xapi) return;
    const scene = xapi.getSceneElements();
    const all = provider.all();
    const stale = new Map(staleCards(scene, all, provider.card).map((s) => [s.id, s]));
    const links = new Map(staleLinks(scene, all, provider.card).map((l) => [l.id, l.link])); // its note renamed
    if (!stale.size && !links.size) return;
    const items = new Set([...stale.values()].map((s) => s.item));
    // Out: the old parts, their texts, and a text bound in the frame itself (a card drawn before parts).
    const gone = new Set(scene.filter((e) => items.has(e.customData?.tmOf) || (e.containerId && stale.has(e.containerId))).map((e) => e.id));
    for (const e of scene) if (e.containerId && gone.has(e.containerId)) gone.add(e.id);
    const added = [];
    const next = elements().map((e) => {
      if (gone.has(e.id)) return lib.newElementWith(e, { isDeleted: true });
      const s = stale.get(e.id);
      const patch = {};
      if (s) {
        const group = e.groupIds?.length ? e.groupIds : [`tm-${s.item}-${Date.now().toString(36)}`];
        // A card's height is a card's (its parts are laid out on it), its width at least what they need.
        const width = Math.max(e.width, 240);
        const fit = { width, height: cardHeight(s.card, width) };
        const parts = build(partSkeletons(s.item, s.card, { ...e, ...fit }));
        for (const x of parts) x.groupIds = [...group];
        added.push(...parts);
        Object.assign(patch, fit, { groupIds: group, boundElements: (e.boundElements || []).filter((b) => !gone.has(b.id)),
          customData: { ...e.customData, tmSig: cardSig(s.card), tmTitle: s.card.title } });
        // A card from before parts (a bare box with its text in it): the card's own frame, thin and grey.
        if (!e.customData.tmSig) Object.assign(patch, { strokeColor: '#dcdce1', strokeWidth: 1, backgroundColor: '#ffffff', fillStyle: 'solid', roughness: 0, roundness: { type: 3 } });
      }
      if (links.has(e.id)) patch.link = links.get(e.id);
      return Object.keys(patch).length ? lib.newElementWith(e, patch) : e;
    });
    xapi.updateScene({ elements: [...next, ...added], captureUpdate: lib.CaptureUpdateAction.NEVER });
  }

  // ── Excalidraw's Library panel: only what you added to it (the app's shapes are in the shapes panel) ──
  // A built-in shape of before (`tm-…`, always given back then, never saved) is not kept.
  const libraryItems = () => (pref(LIBRARY_PREF, null) || []).filter((i) => !String(i.id).startsWith('tm-'));
  const onLibraryChange = (items) => {
    const own = items.filter((i) => !String(i.id).startsWith('tm-'));
    setPref(LIBRARY_PREF, own.length ? own : null);
  };

  // ── a figure of the shapes panel (shapepanel.js, shapes/) ──
  /**
   * Its skeletons as elements, each part keeping what it is (customData) and the figure its own group: the ids are
   * given here, not regenerated, so each part is found again by its id.
   */
  const buildShape = (skeletons) => {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const named = skeletons.map((s, i) => ({ ...s, id: `tm-${stamp}-${i}` }));
    const out = lib.convertToExcalidrawElements(named, { regenerateIds: false });
    for (const s of named) { const e = out.find((x) => x.id === s.id); if (e && s.customData) e.customData = s.customData; }
    const group = `tm-shape-${stamp}`;
    if (named.some((s) => s.groupIds?.length)) for (const e of out) e.groupIds = [group]; // its label too
    return out;
  };
  /** The figure `id` with its middle at scene point `at` (a drop), or in the view's middle beside what is there. */
  function addShape(id, at = null) {
    const fig = SHAPES.get(id);
    if (!xapi || !fig) return;
    let p = at || middle();
    p = { x: p.x - fig.w / 2, y: p.y - fig.h / 2 };
    // Clicked in, not dropped: not on the figure added before it (each click steps down and right).
    const taken = (q) => xapi.getSceneElements().some((r) => r.customData?.tmShape && Math.abs(r.x - q.x) < 2 && Math.abs(r.y - q.y) < 2);
    for (let n = 0; !at && taken(p) && n < 50; n += 1) p = { x: p.x + 24, y: p.y + 24 };
    const made = buildShape(fig.skeleton(Math.round(p.x), Math.round(p.y)));
    const picked = made.filter((e) => !e.containerId);
    xapi.updateScene({
      elements: [...elements(), ...made],
      appState: { selectedElementIds: Object.fromEntries(picked.map((e) => [e.id, true])),
        selectedGroupIds: made[0]?.groupIds?.length ? { [made[0].groupIds[0]]: true } : {} },
      captureUpdate: lib.CaptureUpdateAction.IMMEDIATELY,
    });
  }
  const title = () => String(name || 'Canvas').replace(/\.excalidraw(\.md)?$/i, '');
  /** The canvas as a draw.io diagram (drawio.js), downloaded as <its name>.drawio: draw.io opens it, or imports it. */
  function exportDrawio() {
    if (!xapi) return;
    download(`${title()}.drawio`, toDrawio(xapi.getSceneElements(), { name: title(), appState: xapi.getAppState() }), 'application/vnd.jgraph.mxfile');
  }
  /** The canvas as Excalidraw's own file, <its name>.excalidraw (excalidraw.com opens it): the menu's download, in
   *  place of Excalidraw's "Save to…" dialog, whose one choice was this. */
  function downloadExcalidraw() {
    if (!xapi) return;
    download(`${title()}.excalidraw`, lib.serializeAsJSON(xapi.getSceneElements(), xapi.getAppState(), xapi.getFiles(), 'local'), 'application/vnd.excalidraw+json');
  }
  /** A figure's box stays unseen when a colour reaches it (shapes/kit.js boxRepairs). */
  const repairBoxes = () => {
    const fixes = new Map(boxRepairs(xapi.getSceneElements()).map((r) => [r.id, r.patch]));
    if (!fixes.size) return;
    xapi.updateScene({ elements: elements().map((e) => (fixes.has(e.id) ? lib.newElementWith(e, fixes.get(e.id)) : e)), captureUpdate: lib.CaptureUpdateAction.NEVER });
  };

  /**
   * A double-click on a figure writes its label, as draw.io's: a figure is a group, and Excalidraw's first double-click
   * on a group only goes into it (its box picked), its second writes in the box. So a first one on a figure is given
   * to Excalidraw's canvas once more, a moment after (the second finds the group entered, and is let be).
   */
  const onDblClick = (e) => {
    if (!xapi || !lib || !e.isTrusted) return;
    const st = xapi.getAppState();
    const { x, y } = lib.viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, st);
    const box = [...xapi.getSceneElements()].reverse().find((b) => ['box', 'outline'].includes(b.customData?.tmRole) && b.groupIds?.length
      && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height);
    if (!box || st.editingGroupId === box.groupIds[0] || st.editingTextElement) return;
    const canvas = el.querySelector('canvas.interactive');
    const { clientX, clientY } = e;
    setTimeout(() => canvas?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX, clientY, detail: 2 })), 30);
  };
  el.addEventListener('dblclick', onDblClick, true);

  // ── drops: a row of the side list (a card), a picture of the shapes panel (a figure) ──
  const dragged = (e) => [...(e.dataTransfer?.types || [])].find((t) => t === ITEM_MIME || t === SHAPE_MIME) || null;
  const onDragOver = (e) => { if (!dragged(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; };
  const onDrop = (e) => {
    const kind = dragged(e);
    if (!kind || !xapi) return;
    e.preventDefault(); e.stopPropagation(); // Excalidraw would try it as a file
    const at = lib.viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, xapi.getAppState());
    if (kind === SHAPE_MIME) { addShape(e.dataTransfer.getData(SHAPE_MIME), at); return; }
    const item = provider.all().get(e.dataTransfer.getData(ITEM_MIME));
    if (item) addCard(item, at);
  };
  el.addEventListener('dragover', onDragOver, true);
  el.addEventListener('drop', onDrop, true);

  // ── arrows meet a shape at the middle of a side (anchors.js), once the pointer is up ──
  // An elbow is then routed by Excalidraw itself, around the shapes, from the sides its fixedPoints name: mutateElement
  // on an elbow arrow in the scene runs its router (0.18; anchors.js's own route is only the first draft). It routes
  // anew only when handed bindings that are new objects: with none it just tidies the points, with the same ones it
  // does nothing.
  const reroute = (ids) => {
    const copy = (b) => (b ? { ...b } : null);
    for (const e of xapi.getSceneElements()) {
      if (!ids.has(e.id) || !e.elbowed) continue;
      try { lib.mutateElement(e, { startBinding: copy(e.startBinding), endBinding: copy(e.endBinding) }); } catch { /* keeps the draft route */ }
    }
  };
  const snap = () => {
    if (!xapi || !lib) return;
    const st = xapi.getAppState();
    if (st.newElement || st.multiElement || st.editingLinearElement) return; // still drawing it
    const changes = new Map(snapArrows(xapi.getSceneElements()).map((c) => [c.id, c.patch]));
    if (!changes.size) return;
    xapi.updateScene({ elements: elements().map((e) => (changes.has(e.id) ? lib.newElementWith(e, changes.get(e.id)) : e)),
      captureUpdate: lib.CaptureUpdateAction.NEVER });
    reroute(new Set(changes.keys()));
  };
  const onPointerUp = () => { setTimeout(snap, 60); };

  /**
   * A click on a shape's dot: the arrow that leaves or meets it there is selected, its ends then Excalidraw's handles
   * (to move one to another shape or side). Selected as a click on the arrow is: Excalidraw draws an arrow's handles
   * only for a selection made by the pointer (its linear editor is not public), so the click is given to its canvas, a
   * few px along the arrow from that end.
   */
  function pickArrow({ shape, side }) {
    if (!xapi) return;
    const at = anchor(shape, side);
    const near = (a, i) => { const p = a.points.at(i); return Math.hypot(a.x + p[0] - at[0], a.y + p[1] - at[1]) < 10; };
    const hit = xapi.getSceneElements().find((a) => a.type === 'arrow'
      && ((a.startBinding?.elementId === shape.id && near(a, 0)) || (a.endBinding?.elementId === shape.id && near(a, -1))));
    const canvas = el.querySelector('canvas.interactive');
    if (!hit || !canvas) return;
    const st = xapi.getAppState();
    const z = st.zoom.value;
    const [i, j] = hit.startBinding?.elementId === shape.id && near(hit, 0) ? [0, 1] : [hit.points.length - 1, hit.points.length - 2];
    const [p, q] = [hit.points[i], hit.points[j]];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const step = Math.min(12 / z, len / 2);
    const sx = hit.x + p[0] + ((q[0] - p[0]) / len) * step;
    const sy = hit.y + p[1] + ((q[1] - p[1]) / len) * step;
    const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0,
      clientX: (sx + st.scrollX) * z + st.offsetLeft, clientY: (sy + st.scrollY) * z + st.offsetTop };
    // After this pointerup is over (the stage lets the pointer go), as a click of its own: the up a moment after the
    // down, once Excalidraw has taken the selection in (its state is React's, set after the event).
    setTimeout(() => {
      canvas.dispatchEvent(new PointerEvent('pointerdown', { ...opts, buttons: 1 }));
      setTimeout(() => window.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 })), 30);
    });
  }

  /** An arrow drawn from a shape's dot (anchorlayer.js): bound at its ends, in the canvas's current arrow style. */
  function addArrow({ from, fromSide, to, toSide, points, elbow }) {
    if (!xapi || !lib) return;
    const st = xapi.getAppState();
    const [x0, y0] = points[0];
    const rel = points.map(([x, y]) => [x - x0, y - y0]);
    const xs = rel.map((p) => p[0]);
    const ys = rel.map((p) => p[1]);
    const [made] = lib.convertToExcalidrawElements([{ type: 'arrow', x: x0, y: y0, width: 1, height: 1 }], { regenerateIds: true });
    const bind = (el, side) => { const b = bindingTo(el, side); if (!elbow) delete b.fixedPoint; return b; };
    const arrow = {
      ...made, points: rel, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
      elbowed: elbow, fixedSegments: null, roundness: !elbow && st.currentItemArrowType === 'round' ? { type: 2 } : null,
      strokeColor: st.currentItemStrokeColor, strokeWidth: st.currentItemStrokeWidth, strokeStyle: st.currentItemStrokeStyle,
      roughness: st.currentItemRoughness, opacity: st.currentItemOpacity,
      startArrowhead: st.currentItemStartArrowhead ?? null, endArrowhead: st.currentItemEndArrowhead ?? CLEAN.currentItemEndArrowhead,
      startBinding: bind(from, fromSide), endBinding: to ? bind(to, toSide) : null,
    };
    const ends = new Set([from.id, to?.id].filter(Boolean));
    const next = elements().map((e) => (ends.has(e.id) ? lib.newElementWith(e, { boundElements: [...(e.boundElements || []), { id: arrow.id, type: 'arrow' }] }) : e));
    xapi.updateScene({ elements: lib.restoreElements([...next, arrow], null, { refreshDimensions: false, repairBindings: true }),
      appState: { selectedElementIds: { [arrow.id]: true } }, captureUpdate: lib.CaptureUpdateAction.IMMEDIATELY });
    reroute(new Set([arrow.id]));
  }
  el.addEventListener('pointerup', onPointerUp, true);

  // ── fonts ──
  // A text is measured in the font it is drawn in, and Excalidraw cuts it at that width: one measured before its font
  // arrived (Excalidraw registers its fonts as a scene needs them) is measured again once the font is there.
  const remeasure = () => {
    if (!xapi || !lib) return;
    xapi.updateScene({ elements: lib.restoreElements(elements(), null, { refreshDimensions: true, repairBindings: true }), captureUpdate: lib.CaptureUpdateAction.NEVER });
  };
  let fontTimer = null;
  const onFonts = () => { clearTimeout(fontTimer); fontTimer = setTimeout(remeasure, 50); };
  document.fonts?.addEventListener?.('loadingdone', onFonts);

  // ── the theme follows the page ──
  let theme = pageTheme();
  let render = () => {};
  const retheme = () => { const t = pageTheme(); if (t !== theme) { theme = t; render(); } };
  const themeObs = new MutationObserver(retheme);
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('focus', onFocus);

  const ready = (async () => {
    const [X, drawing] = await Promise.all([loadExcalidraw(), load()]);
    if (dead) return;
    lib = X;
    const host$ = document.createElement('div');
    host$.className = 'wb-host';
    el.replaceChildren(host$);
    root = X.createRoot(host$);
    dots = mountAnchors(el, { getApi: () => xapi, getLib: () => lib, onArrow: addArrow, onPick: pickArrow }); // beside React's root, not in it
    let first = true;
    let shownLook = '';
    /**
     * Excalidraw's main menu, as the app wants it: its own items save its links (GitHub, X, Discord: Excalidraw's, not
     * the app's) and its "Save to…" dialog (a direct download instead), Export to draw.io, and under the background's
     * colours a plain or a grid background.
     */
    const menu = () => {
      const { React: R, MainMenu: M } = X;
      const el$ = R.createElement;
      const svg = (n) => el$('span', { className: 'wb-menu-icon', dangerouslySetInnerHTML: { __html: icon(n, 16).outerHTML } });
      const grid = !!xapi?.getAppState().gridModeEnabled;
      const pattern = (on, text) => el$('button', {
        type: 'button', className: `btn${on === grid ? ' active' : ''}`, 'aria-pressed': String(on === grid),
        onClick: () => xapi?.updateScene({ appState: { gridModeEnabled: on } }),
      }, text);
      return el$(M, null,
        el$(M.Item, { icon: svg('download'), onSelect: downloadExcalidraw, 'aria-label': 'Download .excalidraw' }, 'Download .excalidraw'),
        el$(M.DefaultItems.SaveAsImage),
        el$(M.Item, { icon: svg('file'), onSelect: exportDrawio, 'aria-label': 'Export to draw.io' }, 'Export to draw.io…'),
        el$(M.DefaultItems.SearchMenu),
        el$(M.DefaultItems.Help),
        el$(M.DefaultItems.ClearCanvas),
        el$(M.Separator),
        el$(M.DefaultItems.ChangeCanvasBackground),
        el$(M.ItemCustom, { className: 'wb-pattern' },
          el$('div', { className: 'wb-pattern-title' }, 'Canvas pattern'),
          el$('div', { className: 'seg', role: 'group', 'aria-label': 'Canvas pattern' }, pattern(false, 'Plain'), pattern(true, 'Grid'))));
    };
    const props = () => ({
      excalidrawAPI: (a) => { xapi = a; },
      initialData: {
        elements: drawing.elements || [], files: drawing.files || {}, libraryItems: libraryItems(), scrollToContent: true,
        appState: { ...CLEAN, ...(drawing.appState || {}), ...unfilled(drawing.appState), collaborators: new Map() },
      },
      theme, name, langCode: 'en', autoFocus: false, handleKeyboardGlobally: false,
      UIOptions: {
        canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: null, export: { saveFileToDisk: true } },
        tools: { image: false },
      },
      // Called on every pointer move too: only a change to the drawing (its version) is saved.
      onChange: () => {
        if (!xapi || !lib) return;
        dots?.update(); // the view moved, a shape moved, the tool changed
        const look = lookOf(xapi.getAppState());
        if (first) {
          first = false;
          saved = lib.getSceneVersion(elements());
          savedLook = look;
          shownLook = look;
          tellCards();
          fontsReady().then(() => { remeasure(); sync(); snap(); });
          return;
        }
        if (look !== shownLook) { shownLook = look; render(); } // the menu's Plain · Grid says which (Ctrl+' toggles it too)
        if (lib.getSceneVersion(elements()) !== saved) { repairBoxes(); later(); tellCards(); } else if (look !== savedLook) later();
      },
      onLibraryChange,
      // A card opens its item here (its [[link]] is for Obsidian); another [[link]] has nowhere to go in the page.
      onLinkOpen: (element, event) => {
        const id = element.customData?.tmItem;
        if (id) { event.preventDefault(); const it = provider.all().get(id); if (it) provider.open(it); else toast('This item is gone.', true); return; }
        if (/^\[\[/.test(element.link || '')) event.preventDefault();
      },
    });
    render = () => root?.render(X.React.createElement(X.Excalidraw, props(), menu()));
    render();
  })().catch((err) => {
    if (dead) return;
    el.replaceChildren(Object.assign(document.createElement('div'), { className: 'wb-loading wb-error', textContent: err.message }));
    throw err;
  });
  ready.catch(() => {});

  return {
    ready, addCard, addShape, locate, sync, placed,
    async destroy() {
      if (dead) return;
      if (timer) await save().catch(() => {});
      dead = true;
      el.removeEventListener('dragover', onDragOver, true);
      el.removeEventListener('drop', onDrop, true);
      el.removeEventListener('dblclick', onDblClick, true);
      el.removeEventListener('pointerup', onPointerUp, true);
      dots?.destroy();
      dots = null;
      themeObs.disconnect();
      document.fonts?.removeEventListener?.('loadingdone', onFonts);
      clearTimeout(fontTimer);
      window.removeEventListener('focus', onFocus);
      root?.unmount();
      root = null; xapi = null;
      el.classList.remove('wb');
      el.replaceChildren();
    },
  };
}
