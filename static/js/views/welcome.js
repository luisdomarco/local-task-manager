// The welcome screen (TSK-128, docs/design.md §3): what a page opened with no address shows while it opens its vault a
// stage at a time (boot.js, state.js itemsByStages) — one button, to the Inbox, which works as soon as its stage is in,
// and under it a bar of how far the rest is. It is only for while the vault loads: once everything is in, a page still
// on it goes where a page with no address always went (boot.js homeHash: Today), in place of it in the history. A
// share lands here too, and goes into the Inbox by itself once that is in (main.js route).
import { entryType, homeHash, progressLabel, stages, welcomeFor } from '../boot.js';
import { STRUCTURE, TYPE_DEFS } from '../rules.js';
import { firstLoad, state } from '../state.js';
import { h, icon } from '../ui.js';

export function mount(root) {
  let loaded = false;
  const go = h('a', { class: 'btn primary welcome-go' });
  const fill = h('div');
  const bar = h('div', { class: 'progress welcome-bar', role: 'progressbar', 'aria-label': 'Opening the vault', 'aria-valuemin': '0' }, fill);
  const said = h('p', { class: 'welcome-said muted', 'aria-live': 'polite' });
  const load = h('div', { class: 'welcome-load' }, bar, said);
  root.replaceChildren(h('section', { class: 'welcome' }, go, load));
  const api = {
    update() {
      const plan = state.bootStages.length ? state.bootStages : stages(STRUCTURE);
      const type = entryType(plan);
      const def = TYPE_DEFS[type];
      go.href = `#/${def?.route || type || ''}`;
      go.replaceChildren(icon(def?.icon || 'inbox', 16), h('span', {}, def?.plural || def?.label || 'Inbox'));
      load.hidden = loaded;
      const total = plan.length || 1;
      const done = Math.min(state.bootDone, total);
      fill.style.width = `${Math.max(4, Math.round((done / total) * 100))}%`; // a sliver before the first stage
      bar.setAttribute('aria-valuemax', String(total));
      bar.setAttribute('aria-valuenow', String(done));
      said.textContent = progressLabel(plan, done) || 'Opening the vault…';
    },
  };
  firstLoad.then(() => {
    loaded = true;
    if (!go.isConnected) return; // the Inbox, or another view, was opened meanwhile
    if (welcomeFor(location.hash, false)) location.replace(homeHash(STRUCTURE));
    else api.update();
  });
  return api;
}
