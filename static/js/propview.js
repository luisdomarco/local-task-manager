// A note's property drawn as Obsidian draws it (docs/design.md → Properties): its key with its type's icon, its value
// as that type reads — tags as #chips, a list as chips, a date as a day, a checkbox as a box, a [[note]] or a web
// address as a link (a [[note]] not in the vault grey, as in the text). A note's header (views/files.js) and a base's
// cells (baseview.js) share it.
import { fileTree } from './explorer.js';
import { wikiTarget } from './filetree.js';
import { shortDate, stampLabel } from './dates.js';
import { h, icon, labelChip } from './ui.js';

/** A property's name as its row shows it: its type's icon, then the key (the whole key on hover when it is cut). */
export const propKey = (ico, key) => h('span', { class: 'prop-key', title: key }, icon(ico, 14), h('span', {}, key));

/** One props.js row's value (`r` of propRows) as nodes. `self` the note it is in, `href(path, heading)` a link. */
export function propValue(r, { self, href }) {
  const tree = fileTree();
  const piece = (p) => {
    if (p.url) return h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, p.text);
    if (p.wiki === undefined) return p.text;
    const to = p.wiki ? wikiTarget(tree, p.wiki) : self;
    return to ? h('a', { href: href(to, p.heading) }, p.text)
      : h('span', { class: 'md-missing', title: `Not found: ${p.wiki}` }, p.text);
  };
  if (r.type === 'checkbox') return h('input', { type: 'checkbox', checked: r.value, disabled: true, 'aria-label': r.key });
  if (r.type === 'date' || r.type === 'datetime') {
    return h('span', { title: r.value }, r.type === 'date' ? shortDate(r.value) : stampLabel(r.value));
  }
  if (r.type === 'tags') return h('span', { class: 'prop-chips' }, r.items.map((p) => labelChip(p[0].text)));
  if (r.type === 'list') return h('span', { class: 'prop-chips' }, r.items.map((p) => h('span', { class: 'chip' }, p.map(piece))));
  return h('span', { class: 'prop-text' }, r.items[0].map(piece));
}
