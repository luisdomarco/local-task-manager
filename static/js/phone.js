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
