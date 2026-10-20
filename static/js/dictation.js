// Dictation: a mic toggle next to a text field that types what you say at the cursor (Web Speech API). The app is
// a page on localhost, so it cannot switch on macOS Dictation itself; the button's tooltip says how to. Chrome sends
// the audio to Google to transcribe it; Safari needs Siri or Dictation turned on (System Settings → Keyboard).
// Where the browser has no speech recognition (Firefox), there is no button.
import { toast } from './state.js';
import { h, icon } from './ui.js';

/** The browser's SpeechRecognition constructor (prefixed in Safari and Chrome), or null. */
export const speechCtor = (win = globalThis) => win.SpeechRecognition || win.webkitSpeechRecognition || null;

export const DICTATION_TITLE = 'Dictate: speak and the text appears at the cursor (Esc stops) · '
  + 'or use macOS Dictation: press Fn (🌐) twice, or the shortcut in System Settings → Keyboard → Dictation';

/**
 * The final and the still-changing text of a recognition event. `results` is its SpeechRecognitionResultList (or an
 * array of [{ transcript }] with isFinal), `from` its resultIndex: results before it were already given as final.
 */
export function splitResults(results, from = 0) {
  let final = '';
  let interim = '';
  for (let i = from; i < results.length; i += 1) {
    const r = results[i];
    if (r.isFinal) final += r[0].transcript;
    else interim += r[0].transcript;
  }
  return { final, interim };
}

/**
 * What to insert so the dictated `text` reads well between `before` and `after` (the text around the cursor):
 * one space between words, none before punctuation or after an opening bracket or a line break. '' for no words.
 */
export function spaced(before, text, after = '') {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const lead = before && !/[\s([{"'¿¡]$/.test(before) && !/^[.,;:!?)\]}…]/.test(t) ? ' ' : '';
  const trail = after && /^[\p{L}\p{N}]/u.test(after) ? ' ' : '';
  return lead + t + trail;
}

/** The end of a long interim text, cut at a word, to fit the small bubble that shows it. */
export function tail(text, max = 48) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(-max);
  const word = cut.indexOf(' ');
  return `…${word > 0 && word < max / 2 ? cut.slice(word + 1) : cut}`;
}

let active = null; // the one dictation listening (a second mic stops the first)

/** `field` (an <input> or a <textarea>) with a mic inside its right edge (TSK-040), or the field alone where the
 *  browser has no speech recognition. What is said goes in at the cursor, firing `input` as it types and `change`
 *  when it stops, so the field saves as it does when typed into. */
export function withMic(field, { place = 'below' } = {}) {
  const mic = dictation(field, { place });
  return mic ? h('span', { class: 'dictation-host' }, field, mic.el) : field;
}

/**
 * dictation(target, { insert, place }) → { el, stop } or null (no speech recognition here).
 * `target` is the textarea it types into; `insert(start, end, text)` puts text there (default: setRangeText plus an
 * input event, so the field's own listeners save it). `place: 'above' | 'below'` is where the bubble with what is
 * being heard opens. It stops on its button, Esc in the field, the field losing focus, or the field leaving the page.
 */
export function dictation(target, { insert = null, place = 'below' } = {}) {
  const Ctor = speechCtor(typeof window === 'undefined' ? globalThis : window);
  if (!Ctor) return null;
  const put = insert || ((start, end, text) => {
    target.setRangeText(text, start, end, 'end');
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const heard = h('span', { class: 'dictation-heard', 'aria-live': 'polite' });
  const btn = h('button', {
    type: 'button', class: 'btn icon dictation-btn', title: DICTATION_TITLE, 'aria-pressed': 'false',
    onmousedown: (e) => e.preventDefault(), // keep the field's focus and cursor
    onclick: () => (rec ? stop() : start()),
  }, icon('mic', 16));
  const el = h('span', { class: 'dictation', 'data-place': place }, btn, heard);

  let rec = null;
  let typed = false; // anything inserted: the field gets a change event when it stops
  let observer = null;
  const show = (text) => { heard.textContent = text; };

  const onKey = (e) => { // capture, so the first Esc only stops dictating (the editor's own Esc comes next time)
    if (e.key !== 'Escape' || !rec) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    stop();
  };
  // The window losing focus (a permission prompt, another app) blurs the field too: keep listening then.
  const onBlur = () => setTimeout(() => { if (rec && document.hasFocus() && document.activeElement !== target) stop(); });

  function start() {
    active?.();
    rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      if (!target.isConnected) { stop(); return; }
      const { final, interim } = splitResults(e.results, e.resultIndex);
      if (final) {
        const { selectionStart: s, selectionEnd: end, value: v } = target;
        const text = spaced(v.slice(0, s), final, v.slice(end));
        if (text) { put(s, end, text); typed = true; }
      }
      show(interim ? tail(interim) : 'Listening…');
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        toast('Dictation is blocked: allow the microphone for this page (in Safari, also turn on Siri or Dictation)', true);
      } else if (e.error === 'network') toast('Dictation needs the network in this browser (it transcribes online)', true);
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast(`Dictation stopped: ${e.error}`, true);
      stop();
    };
    rec.onend = () => { if (rec) stop(); }; // the browser ended it (a long silence): show it off
    try { rec.start(); } catch { rec = null; toast('Dictation could not start', true); return; }
    active = stop;
    typed = false;
    target.focus();
    target.addEventListener('keydown', onKey, true);
    target.addEventListener('blur', onBlur);
    observer = new MutationObserver(() => { if (!target.isConnected) stop(); });
    observer.observe(document.body, { childList: true, subtree: true });
    btn.setAttribute('aria-pressed', 'true');
    el.classList.add('listening');
    show('Listening…');
  }

  function stop() {
    if (!rec) return;
    const r = rec;
    rec = null;
    try { r.stop(); } catch { /* already ended */ }
    if (active === stop) active = null;
    target.removeEventListener('keydown', onKey, true);
    target.removeEventListener('blur', onBlur);
    observer?.disconnect();
    observer = null;
    btn.setAttribute('aria-pressed', 'false');
    el.classList.remove('listening');
    show('');
    if (typed && !insert) target.dispatchEvent(new Event('change', { bubbles: true })); // a field that saves on change
  }

  return { el, stop };
}
