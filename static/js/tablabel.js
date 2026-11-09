// A tab's name (ui.js tabPanels): at most TAB_LABEL_MAX characters. A longer one is cut, ending in "…", and the
// button says it whole on hover (its title). Its width is bounded too, in app.css (--tab-min-w / --tab-max-w).

export const TAB_LABEL_MAX = 14;

/** → { text, full }: the name to show, and the whole one when it was cut (else null). Not a string: left as it is. */
export function tabLabel(label, max = TAB_LABEL_MAX) {
  if (typeof label !== 'string') return { text: label, full: null };
  const name = label.trim();
  const chars = [...name]; // by character, not UTF-16 unit: an accent or an emoji is never split
  if (chars.length <= max) return { text: name, full: null };
  return { text: `${chars.slice(0, max - 1).join('').trimEnd()}…`, full: name };
}
