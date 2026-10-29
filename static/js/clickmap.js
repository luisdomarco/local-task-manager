// Where a click on rendered Markdown falls in its source, so the editor that replaces the text opens on that spot.

/**
 * sourceOffset(source, text, offset, ratio) → an index into `source`, or -1.
 * `text` is the rendered text node that was clicked and `offset` the place in it; `ratio` (0–1) is how far into the
 * whole rendered text that is. Plain text comes out of Markdown as it went in, so the words around the click are
 * looked up in the source: a wide window first, narrower ones when marks (`**`, `\*`, a link) cut through it. A
 * window found more than once (a repeated phrase) is taken where its place in the source best matches `ratio`.
 */
export function sourceOffset(source, text, offset, ratio = 0) {
  if (!source || !text) return -1;
  offset = Math.max(0, Math.min(offset, text.length));
  for (const k of [40, 20, 10, 5, 2]) {
    const start = Math.max(0, offset - k);
    const needle = text.slice(start, Math.min(text.length, offset + k));
    if (needle.trim().length < 2) continue;
    let best = -1;
    for (let i = source.indexOf(needle); i >= 0; i = source.indexOf(needle, i + 1)) {
      if (best < 0 || Math.abs(i / source.length - ratio) < Math.abs(best / source.length - ratio)) best = i;
    }
    if (best >= 0) return best + (offset - start);
  }
  return -1;
}
