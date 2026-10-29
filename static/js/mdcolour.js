// Text colour and highlight in Markdown, which has neither: inline HTML that Obsidian shows too —
// <span style="color: #…"> for the text, <mark style="background: #…"> for a highlight (as its Highlightr plugin
// writes it). Only the selection changes; the rest of the text stays byte for byte.

export const TEXT_COLOURS = [
  ['Red', '#d93025'], ['Orange', '#e8710a'], ['Gold', '#b8860b'], ['Green', '#188038'],
  ['Blue', '#1a73e8'], ['Purple', '#9334e6'], ['Grey', '#80868b'],
];
// Translucent, so a highlight reads on the light theme and the dark one alike.
export const HIGHLIGHTS = [
  ['Yellow', '#fff3a3a6'], ['Orange', '#ffb86ca6'], ['Red', '#ff5582a6'], ['Pink', '#ffb8eba6'],
  ['Green', '#bbfabba6'], ['Blue', '#adccffa6'], ['Purple', '#d2b3ffa6'],
];

const KINDS = {
  text: { tag: 'span', prop: 'color' },
  highlight: { tag: 'mark', prop: 'background' },
};
const HEX = /^#[0-9a-f]{3,8}$/i;

/**
 * colourRange(value, start, end, kind, colour) → { value, start, end } with the selection (start…end) in that
 * colour: `kind` 'text' or 'highlight', `colour` a #hex, or null to take the colour off. A selection already
 * wrapped in that kind (the tags just outside it, or selected with it) gets the new colour instead of a second
 * wrapper. Nothing selected wraps a placeholder word, selected. The returned start…end is the text, without tags.
 */
export function colourRange(value, start, end, kind, colour) {
  const { tag, prop } = KINDS[kind];
  if (colour !== null && !HEX.test(colour)) throw new Error(`not a colour: ${colour}`);
  const open = new RegExp(`<${tag} style="${prop}: ?#[0-9a-fA-F]{3,8};?">$`);
  const close = `</${tag}>`;
  // The tags selected along with the text: look inside the selection the same way.
  const sel = value.slice(start, end);
  const inner = sel.match(new RegExp(`^<${tag} style="${prop}: ?#[0-9a-fA-F]{3,8};?">([\\s\\S]*)</${tag}>$`));
  let from = start; let to = end; let text = sel;
  if (inner) text = inner[1];
  else {
    const before = value.slice(0, start).match(open);
    if (before && value.startsWith(close, end)) { from = start - before[0].length; to = end + close.length; }
  }
  if (colour === null) {
    if (from === start && to === end && !inner) return { value, start, end }; // nothing to take off
    const out = value.slice(0, from) + text + value.slice(to);
    return { value: out, start: from, end: from + text.length };
  }
  if (!text) text = kind === 'text' ? 'text' : 'highlight';
  const head = `<${tag} style="${prop}: ${colour}">`;
  const out = value.slice(0, from) + head + text + close + value.slice(to);
  return { value: out, start: from + head.length, end: from + head.length + text.length };
}
