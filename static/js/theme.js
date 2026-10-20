// Light / dark / system theme. The choice lives in localStorage (a per-browser
// convenience); index.html applies it before first paint to avoid a flash.
import { h, icon } from './ui.js';

const KEY = 'tm-theme';
const MODES = [['light', 'sun', 'Light'], ['dark', 'moon', 'Dark'], ['system', 'monitor', 'System']];

const read = () => { try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; } };

function apply(mode) {
  if (mode === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  try { localStorage.setItem(KEY, mode); } catch { /* private mode: still applied for this page */ }
}

export function initTheme() {
  const box = document.getElementById('theme-switch');
  const render = () => {
    const mode = read();
    box.replaceChildren(...MODES.map(([m, ico, label]) => h('button', {
      class: `btn icon ${mode === m ? 'active' : ''}`, title: `${label} theme`, 'aria-pressed': String(mode === m),
      onclick: () => { apply(m); render(); },
    }, icon(ico, 14))));
  };
  apply(read());
  render();
}
