// Modern's tooltips: one element for the page, drawn in Basecoat's tooltip look (app.css .tooltip), shown on hover or
// keyboard focus of anything with a `title`. No view changes: the ~400 places that set a title (some at run time, some
// on several lines) keep doing so. While the tip is up the element's title moves to data-tip-title, so the browser's
// own tooltip does not show as well, and comes back when it hides. Classic keeps the browser's own: nothing is made,
// no title is touched (initTooltips does nothing until the root's data-skin is "modern").
//
// Basecoat's tooltip is pure CSS on a [data-tooltip] attribute (a ::before of the element): it would need every place
// to change, and a ::before is cut by any overflow:hidden around it (a table cell, a tab strip, a side panel). One
// fixed element is never cut and can flip at the screen's edge.

const DELAY = 500; // hover before the first tip (the browser's own waits about a second)
const WARM = 300; // a tip hidden less than this ago: the next one shows at once (moving along a toolbar)
const GAP = 6; // between the element and its tip (Basecoat: spacing × 1.5)
const MARGIN = 8; // the least room kept to the window's edge

/** Where the tip goes: above the element and centred on it (Basecoat's default side), below when there is no room
 *  above, and moved along so it stays inside the window. Pure: `anchor` is a DOMRect-like {left, top, right, bottom},
 *  `size` the tip's {width, height}, `view` the window's {width, height}. */
export function placeTip(anchor, size, view, gap = GAP, margin = MARGIN) {
  const above = anchor.top - gap - size.height;
  const below = anchor.bottom + gap;
  const roomAbove = above >= margin;
  const roomBelow = below + size.height <= view.height - margin;
  // no room on either side: the side with more of it, kept inside the window
  const side = roomAbove || (!roomBelow && anchor.top >= view.height - anchor.bottom) ? 'top' : 'bottom';
  const top = Math.max(margin, Math.min(side === 'top' ? above : below, view.height - margin - size.height));
  const centred = (anchor.left + anchor.right) / 2 - size.width / 2;
  const left = Math.max(margin, Math.min(centred, view.width - margin - size.width));
  return { left: Math.round(left), top: Math.round(top), side };
}

/** The text a title shows: trimmed, with no empty lines at either end. Empty: no tip. */
export const tipText = (title) => String(title ?? '').replace(/^\s*\n|\n\s*$/g, '').trim();

let tip = null; // the element, made the first time a tip shows
let anchor = null; // the element whose title the tip shows now
let saved = null; // { text, label, described }: what showing changed on it, put back on hide
let timer = 0;
let hiddenAt = 0;
let watch = null; // the anchor's title set while shown (ui.js tabs, term.js), or the anchor gone from the page

const modern = () => document.documentElement.dataset.skin === 'modern';

function make() {
  tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.id = 'tm-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);
}

function show(el) {
  const text = tipText(el.getAttribute('title'));
  if (!text || !el.isConnected) return;
  hide();
  if (!tip) make();
  anchor = el;
  // Its title says what it is when it has no other name: kept as its label while the title is away. Otherwise the tip
  // describes it, unless its label already says the same (h() labels an icon button with its title).
  const named = el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || el.textContent.trim();
  const described = named && !el.hasAttribute('aria-describedby') && el.getAttribute('aria-label') !== text;
  saved = { text: el.getAttribute('title'), label: !named, described };
  el.dataset.tipTitle = saved.text;
  el.removeAttribute('title');
  if (saved.label) el.setAttribute('aria-label', text);
  if (saved.described) el.setAttribute('aria-describedby', tip.id);
  tip.textContent = text;
  tip.hidden = false;
  tip.classList.remove('open');
  const r = el.getBoundingClientRect();
  const { left, top, side } = placeTip(r, { width: tip.offsetWidth, height: tip.offsetHeight },
    { width: document.documentElement.clientWidth, height: window.innerHeight });
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
  tip.dataset.side = side;
  requestAnimationFrame(() => tip?.classList.add('open')); // from Basecoat's 95% and 8px towards the element
  watch = new MutationObserver(() => {
    if (!anchor?.isConnected) return hide();
    if (anchor.hasAttribute('title')) { // set again while shown: the new text, and the browser's tip kept away
      const next = anchor.getAttribute('title');
      saved.text = next;
      anchor.dataset.tipTitle = next;
      anchor.removeAttribute('title');
      if (!tipText(next)) return hide();
      tip.textContent = tipText(next);
    }
  });
  watch.observe(el, { attributes: true, attributeFilter: ['title'] });
  watch.observe(document.body, { childList: true, subtree: true }); // a repaint that drops it
}

function hide() {
  clearTimeout(timer);
  if (!anchor) return;
  watch?.disconnect();
  watch = null;
  const el = anchor;
  anchor = null;
  if (!el.hasAttribute('title')) el.setAttribute('title', saved.text);
  delete el.dataset.tipTitle;
  if (saved.label) el.removeAttribute('aria-label');
  if (saved.described) el.removeAttribute('aria-describedby');
  saved = null;
  tip.hidden = true;
  tip.classList.remove('open');
  hiddenAt = Date.now();
}

/** The element a pointer or focus on `target` would show the title of. */
const titled = (target) => (target instanceof Element ? target.closest('[title]:not([title=""]):not(iframe)') : null);

function later(target, delay) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const el = titled(target);
    if (el && el !== anchor && (el.matches(':hover') || el.matches(':focus-visible'))) show(el);
  }, Date.now() - hiddenAt < WARM ? 0 : delay);
}

export function initTooltips() {
  document.addEventListener('pointerover', (e) => {
    if (!modern() || e.pointerType === 'touch') return;
    if (anchor?.contains(e.target)) return;
    const was = !!anchor;
    hide();
    if (titled(e.target)) later(e.target, was ? 0 : DELAY);
  });
  document.documentElement.addEventListener('pointerleave', hide); // off the window
  document.addEventListener('focusin', (e) => {
    if (!modern() || !(e.target instanceof Element) || !e.target.matches(':focus-visible')) return;
    hide();
    if (titled(e.target) === e.target) later(e.target, 0); // keyboard focus: at once, its own title only
  });
  document.addEventListener('focusout', (e) => { if (e.target === anchor) hide(); });
  document.addEventListener('pointerdown', hide, true); // a click: the tip would cover what it opens
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); }, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
  window.addEventListener('resize', hide);
  window.addEventListener('tm:themechange', () => { if (!modern()) hide(); }); // to Classic: the title back at once
}
