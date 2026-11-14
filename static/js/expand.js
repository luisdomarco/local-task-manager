// A diagram or a picture of rendered Markdown, expanded: a dialog with it to look into (zoom.js: zoom with the wheel,
// a pinch or − · + · Fit, drag to move it, Esc closes). A drawn diagram (.md-diagram, diagrams.js) gets a corner
// button for it; a picture opens with a click, unless it is a link or sits in an editor (where a click edits).
import { zoomableImage, zoomableSvg } from './zoom.js';
import { h, icon, openDialog } from './ui.js';

/** Opens `el` (an <img>, or a .md-diagram holding an <svg>) in a dialog to look into. */
export function openExpanded(el) {
  const svg = el.tagName === 'IMG' ? null : el.querySelector('svg');
  // A picture's name: its alt text, else its file's (the vault's /api/files/raw?path=…, or a web address's last part)
  const fileName = () => { const u = new URL(el.src, location.href); return (u.searchParams.get('path') || decodeURIComponent(u.pathname)).split('/').pop(); };
  const name = el.tagName === 'IMG' ? (el.getAttribute('alt') || fileName() || 'Picture') : 'Diagram';
  const view = svg ? zoomableSvg(svg.cloneNode(true), name) : zoomableImage(el.src, name);
  openDialog({ title: name, ico: svg ? 'graph' : 'image', label: name, cls: 'attach-modal expand-modal', body: [view] });
}

/** The corner button of a drawn diagram (`box`, a .md-diagram) that expands it. */
export function expandButton(box) {
  const b = h('button', { type: 'button', class: 'btn icon small md-expand', title: 'Expand', 'aria-label': 'Expand the diagram' }, icon('maximize', 14));
  // Pressed in the Live editor, the block under it must not take the press as a click to edit it.
  b.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
  b.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); openExpanded(box); });
  box.append(b);
}

// A picture of rendered Markdown, clicked: expanded. Not one that is a link, nor one in an editor.
document.addEventListener('click', (e) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const img = e.target.closest?.('.md img');
  if (!img || img.closest('a, .cm-editor, .mde-live') || !img.complete || !img.naturalWidth) return;
  e.preventDefault();
  openExpanded(img);
});
