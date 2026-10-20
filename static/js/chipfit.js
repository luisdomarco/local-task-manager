// How many chips of a one-line tag field fit in front of a "+N" chip (ui.js tagInput): pure, so node tests it.

/**
 * `widths`: each chip's width, in order. `room`: the line's inner width. `gap`: between two things on the line.
 * `input`: the least width the text field needs beside the chips. `more`: the "+N" chip's width.
 * → { shown, input }: every chip and the text field when they all fit; every chip alone when only the field does not;
 *   else as many chips as fit in front of "+N" (none: "+N" alone). Without the field it comes back when the field
 *   is opened.
 */
export function fitChips(widths, room, { gap = 4, input = 90, more = 36 } = {}) {
  if (!widths.length) return { shown: 0, input: true };
  const line = (n) => widths.slice(0, n).reduce((sum, w) => sum + w + gap, 0); // each chip and the gap after it
  if (line(widths.length) + input <= room) return { shown: widths.length, input: true };
  if (line(widths.length) - gap <= room) return { shown: widths.length, input: false }; // no gap after the last
  let shown = widths.length - 1; // something is hidden, or there is no "+N" to show
  while (shown > 0 && line(shown) + more > room) shown -= 1;
  return { shown, input: false };
}
