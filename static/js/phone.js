// A phone, as the page tells it: a narrow screen you touch (≤760px wide and a coarse pointer). css/phone.css sizes it
// (its own cascade layer, docs/design.md §2 *The phone layer*); what JS does differently there asks isPhone(). A narrow
// window on a computer, with a mouse, is not a phone: it keeps the desktop's behaviour (ui.js PHONE_POP's centred
// popups, sidebar.js's drawer), as before. A touch screen of any width asks isTouch().

/** The query phone.css's phone blocks use, verbatim (tests/js/phone.test.mjs checks they agree). */
export const PHONE_TOUCH = '(max-width: 760px) and (pointer: coarse)';
/** Phone.css's other block: any touch screen (an iPad too). */
export const TOUCH = '(pointer: coarse)';

const query = (q) => (typeof matchMedia === 'function' ? matchMedia(q) : { matches: false, addEventListener() {} });
const phoneQ = query(PHONE_TOUCH);
const touchQ = query(TOUCH);

export const isPhone = () => phoneQ.matches;
export const isTouch = () => touchQ.matches;
/** `fn(isPhone)` each time the answer changes (a rotation, a window dragged to another screen). */
export const onPhoneChange = (fn) => phoneQ.addEventListener('change', (e) => fn(e.matches));

/**
 * The height left for the page above the keyboard, as --vvh on <html> (iOS shrinks the visual viewport for the
 * keyboard, never 100dvh or innerHeight): what floats over the page on a phone (a centred menu, the palette, a
 * modal) keeps under it. `viewportHeight()` is the same number for JS. Run once, at start (main.js).
 */
export function trackViewport() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return;
  const set = () => document.documentElement.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
  vv.addEventListener('resize', set);
  vv.addEventListener('scroll', set);
  set();
}
export const viewportHeight = () => (typeof window !== 'undefined' && window.visualViewport ? window.visualViewport.height : innerHeight);

/** How far down, or how fast, a drag must go to close a sheet: a slow pull past `distance`, or a flick past `flick`
 *  at `speed` px/ms or more. */
export const SWIPE_CLOSE = { distance: 96, flick: 40, speed: 0.6 };

/** Whether a drag of (dx, dy) in `ms` closes a sheet: down, more down than sideways, far or fast enough. */
export function swipeCloses(dx, dy, ms) {
  if (!(dy > 0) || Math.abs(dx) > dy) return false;
  return dy >= SWIPE_CLOSE.distance || (dy >= SWIPE_CLOSE.flick && dy / Math.max(ms, 1) >= SWIPE_CLOSE.speed);
}

/**
 * On a phone, a finger dragged down from `handle` (a selector inside `sheet`: its head) moves the sheet with it and,
 * past swipeCloses, slides it away and calls `onClose`; let go short of that, it springs back. A drag that starts on
 * a control is the control's. Assigned as `sheet.onpointerdown`, so calling it again replaces it.
 */
export function swipeDown(sheet, handle, onClose) {
  sheet.onpointerdown = (e) => {
    if (e.pointerType === 'mouse' || !isPhone() || !e.target.closest(handle)
      || e.target.closest('button, a, input, select, textarea, [contenteditable]')) return;
    const x0 = e.clientX; const y0 = e.clientY; const t0 = performance.now();
    let dx = 0; let dy = 0;
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      dx = ev.clientX - x0; dy = ev.clientY - y0;
      sheet.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
    };
    const end = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
      const done = ev.type === 'pointerup' && swipeCloses(dx, dy, performance.now() - t0);
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Closed first, then put back where it was (hidden by then), or it would flash back for a frame
      const clear = () => { sheet.style.transition = ''; sheet.style.transform = ''; };
      const finish = () => (done ? Promise.resolve(onClose()).finally(clear) : clear());
      if (still || !dy) { finish(); return; }
      sheet.style.transition = 'transform .18s ease-out';
      sheet.style.transform = done ? 'translateY(100%)' : '';
      setTimeout(finish, 180);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
  };
}
