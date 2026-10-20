// An item's own page: the item editor laid out full width, with what hangs from it as tables. Every type whose
// structure says `page` has one (an initiative; in Ticketing a project and a PRD too). Route: #/<type>/:ref, the
// ref being its id, or a project's key (rules.js pageRef).
import { createPageEditor, disposeEditor } from '../panel.js';
import { TYPE_DEFS, findByPageRef } from '../rules.js';
import { firstLoad, state } from '../state.js';
import { h } from '../ui.js';

function mountDetail(type, root, param) {
  const page = h('div', { class: 'page' }, h('p', { class: 'muted' }, 'Loading…'));
  root.replaceChildren(page);
  const back = `#/${TYPE_DEFS[type]?.route || 'today'}`; // its type's list
  const ed = createPageEditor(page, { onGone: () => { location.hash = back; } });
  let ready = false;
  const ref = decodeURIComponent(param || '');
  // A project is named by its key, which only the loaded items know (opened by its address, the page may still be
  // loading them); anything else by its id, which the server finds as well.
  firstLoad.then(() => {
    const known = findByPageRef(type, ref, state.all);
    return ed.load(known ? known.key : ref);
  }).then((ok) => {
    if (!ok) { location.hash = back; return; }
    ready = true;
    ed.render();
  });
  return {
    update() { if (ready) ed.render(); },
    async unmount() { await ed.flush(); ed.reset(); disposeEditor(ed); },
  };
}

/** The page view of one type, for main.js's router. */
export const pageView = (type) => ({ mount: (root, param) => mountDetail(type, root, param) });
