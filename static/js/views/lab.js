// #/lab — the design-system spike (plans/design-system-spike.md). Not in the sidebar or ⌘K: reached by its address.
// Two parts. The stage, an iframe with Basecoat on its own (no app.css) and the tokens of the theme being looked at:
// Classic (app.css's, read from the file) or Modern (css/themes/modern.css), light or dark, in
// Nova or Mira, at either density, with one of four accents. Under it, the risky tests, run on this page with Basecoat
// loaded the way the app would load it (basecoat.js: its CSS in the `vendor` layer, under app.css).
import { CALLY, SCRIPTS, STYLES, basecoatLoaded, basecoatToast, cssUrl, loadBasecoat, scriptUrl, unloadBasecoat } from '../basecoat.js';
import { createPageEditor, disposeEditor } from '../panel.js';
import { hasPage } from '../rules.js';
import { firstLoad, state, toast } from '../state.js';
import { h, icon, pageHead, select } from '../ui.js';

const HUES = ['gray', 'blue', 'amber', 'red', 'orange', 'violet', 'grass', 'brown', 'indigo', 'teal'];
const ACCENTS = ['indigo', 'blue', 'violet', 'teal'];
const LUCIDE = ['chevron-down', 'check', 'search', 'x', 'plus', 'calendar', 'settings', 'sun', 'moon', 'info', 'trash-2', 'ellipsis',
  'circle-alert', 'undo-2', 'command', 'inbox', 'copy', 'pencil', 'arrow-up-down', 'list-filter'];
const STATUSES = [['backlog', 'Backlog', 'gray'], ['todo', 'To do', 'blue'], ['onhold', 'On hold', 'amber'], ['blocked', 'Blocked', 'red'],
  ['inprogress', 'In progress', 'orange'], ['review', 'Review', 'violet'], ['done', 'Done', 'grass'], ['discarded', 'Discarded', 'brown']];
const CURRENT_SCALE = [['--fs-title', 22], ['--fs-h4', 14], ['--fs-base', 13.5], ['--fs-sm', 13], ['--fs-xs', 12.5], ['--fs-2xs', 12]];
const PROPOSED_SCALE = [['2xl', 24, 32], ['xl', 20, 28], ['lg', 18, 26], ['md', 16, 24], ['base', 14, 22], ['sm', 13, 20], ['xs', 12, 16]];

const KEY = 'tm.lab';
const effectiveMode = () => document.documentElement.dataset.theme
  || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const readOpts = () => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* a private window: defaults */ }
  return { skin: 'modern', style: 'nova', density: 'comfortable', accent: 'indigo', mode: effectiveMode(), ...saved };
};
const saveOpts = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* still applied */ } };

// ── colour maths: a colour as the screen paints it (a canvas turns any CSS colour into sRGB) ──────────────────
const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
function rgb(css) {
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = '#000';
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
}
const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
  .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
export function contrast(fg, bg) {
  const [a, b] = [lum(rgb(fg)), lum(rgb(bg))].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
/** The contrast of an element's text on its background, as rendered (both resolved in its own document). */
const contrastOf = (el) => { const cs = el.ownerDocument.defaultView.getComputedStyle(el); return contrast(cs.color, cs.backgroundColor); };
const ratio = (n) => `${n.toFixed(1)}:1`;

// ── Classic's tokens, from app.css as it is (its :root block, the shadcn aliases Basecoat reads included) ───────
let classicCss = null;
async function classicTokens() {
  if (classicCss) return classicCss;
  const css = await fetch('css/app.css').then((r) => r.text());
  const block = (start) => {
    const i = css.indexOf(start);
    if (i < 0) return '';
    const open = css.indexOf('{', i);
    let depth = 1;
    let k = open + 1;
    while (depth && k < css.length) { depth += css[k] === '{' ? 1 : css[k] === '}' ? -1 : 0; k++; }
    return css.slice(open + 1, k - 1);
  };
  classicCss = `@layer app{:root{${block(':root {')}}\n:root.dark{${block(':root[data-theme="dark"], #termdock')}}}`;
  return classicCss;
}

const bcImport = (style) => `@import url("${cssUrl(style)}") layer(vendor);`;

function stageDoc(o, classic) {
  const links = (urls) => urls.map((u) => `<link rel="stylesheet" href="${u}">`).join('');
  const radix = HUES.flatMap((hue) => [`vendor/radix-colors/${hue}.css`, `vendor/radix-colors/${hue}-dark.css`]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${links(['vendor/fonts/inter.css', ...radix])}`
    // the page's layers (css/main.css): Basecoat in vendor, Classic's tokens in app, Modern's file in themes
    + `<style>@layer vendor, app, themes;</style><style id="bc">${bcImport(o.style)}</style><style>${classic}</style>`
    + links(['css/themes/modern.css', 'css/lab/stage.css'])
    + SCRIPTS.map(([n, sri]) => `<script src="${scriptUrl(n)}" integrity="${sri}"></script>`).join('')
    + `<script type="module" src="${CALLY[0]}" integrity="${CALLY[1]}"></script></head><body></body></html>`;
}

function applyStage(doc, o) {
  const root = doc.documentElement;
  Object.assign(root.dataset, { skin: o.skin, density: o.density, accent: o.accent });
  root.classList.toggle('dark', o.mode === 'dark');
  const bc = doc.getElementById('bc');
  if (bc && bc.textContent !== bcImport(o.style)) bc.textContent = bcImport(o.style);
}

// ── the specimen sheet: Basecoat's markup (its templates/, rendered), built with h() ──────────────────────────
let uid = 0;
const id = (p) => `${p}-${++uid}`;
const sec = (title, ...body) => h('section', { class: 'lab-sec' }, h('h2', {}, title), ...body);
const row = (...items) => h('div', { class: 'lab-row' }, ...items);
const btn = (label, attrs = {}) => h('button', { type: 'button', class: 'btn', ...attrs }, label);
const chev = () => icon('down', 16);

function selectBox(items, picked) {
  const i = id('sel');
  const label = items.find(([v]) => v === picked)?.[1] || items[0][1];
  return h('div', { id: i, class: 'select' },
    h('button', { type: 'button', id: `${i}-trigger`, 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': `${i}-listbox` },
      h('span', { class: 'truncate' }, label), chev()),
    h('div', { id: `${i}-popover`, 'data-popover': true, 'aria-hidden': 'true' },
      h('div', { role: 'listbox', id: `${i}-listbox`, 'aria-orientation': 'vertical', 'aria-labelledby': `${i}-trigger` },
        items.map(([v, l], n) => h('div', { id: `${i}-o${n}`, role: 'option', 'data-value': v, 'aria-selected': v === picked ? 'true' : null }, l)))),
    h('input', { type: 'hidden', name: `${i}-value`, value: picked }));
}

function combobox(names) {
  const i = id('cmb');
  return h('div', { id: i, class: 'combobox' },
    h('input', { type: 'text', role: 'combobox', placeholder: 'Search 100 items…', autocomplete: 'off', spellcheck: 'false',
      'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': `${i}-listbox`, 'aria-label': 'Item' }),
    h('div', { id: `${i}-popover`, 'data-popover': true, 'aria-hidden': 'true' },
      h('div', { role: 'listbox', id: `${i}-listbox`, 'aria-orientation': 'vertical' },
        names.map((n, k) => h('div', { id: `${i}-o${k}`, role: 'option', 'data-value': `v${k}` }, n)))),
    h('input', { type: 'hidden', value: '' }));
}

export function dropdownMenu(label, items) {
  const i = id('dd');
  return h('div', { id: i, class: 'dropdown-menu' },
    h('button', { type: 'button', class: 'btn', 'data-variant': 'outline', id: `${i}-trigger`, 'aria-haspopup': 'menu', 'aria-controls': `${i}-menu`, 'aria-expanded': 'false' }, label, chev()),
    h('div', { id: `${i}-popover`, 'data-popover': true, 'aria-hidden': 'true' },
      h('div', { role: 'menu', id: `${i}-menu`, 'aria-labelledby': `${i}-trigger` },
        items.map((it) => (it === '-' ? h('hr', { role: 'separator' })
          : h('div', { role: 'menuitem', 'data-variant': it.danger ? 'destructive' : null }, it.label, it.kbd ? h('kbd', { class: 'kbd' }, it.kbd) : null))))));
}

function popover(label, content) {
  const i = id('pop');
  return h('div', { id: i, class: 'popover' },
    h('button', { type: 'button', class: 'btn', 'data-variant': 'outline', id: `${i}-trigger`, 'aria-expanded': 'false', 'aria-controls': `${i}-popover` }, label),
    h('div', { id: `${i}-popover`, 'data-popover': true, 'aria-hidden': 'true' }, content));
}

function tabs(sets) {
  const i = id('tabs');
  return h('div', { class: 'tabs', id: i },
    h('nav', { role: 'tablist', 'aria-orientation': 'horizontal' },
      sets.map(([t], n) => h('button', { type: 'button', role: 'tab', id: `${i}-t${n}`, 'aria-controls': `${i}-p${n}`, 'aria-selected': String(!n), tabindex: n ? '-1' : '0' }, t))),
    sets.map(([, p], n) => h('div', { role: 'tabpanel', id: `${i}-p${n}`, 'aria-labelledby': `${i}-t${n}`, tabindex: '-1', hidden: n ? true : null }, p)));
}

function command(groups) {
  const i = id('cmd');
  return h('div', { class: 'command', id: i, 'aria-label': 'Command menu' },
    h('header', {}, icon('search', 16), h('input', { type: 'text', id: `${i}-input`, placeholder: 'Type a command or search…', autocomplete: 'off',
      spellcheck: 'false', 'aria-autocomplete': 'list', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': `${i}-menu` })),
    h('div', { role: 'menu', id: `${i}-menu`, 'aria-orientation': 'vertical', 'data-empty': 'No results found.' },
      groups.map(([g, items], n) => h('div', { role: 'group', 'aria-labelledby': `${i}-g${n}` },
        h('span', { role: 'heading', id: `${i}-g${n}` }, g),
        items.map(([l, k]) => h('div', { role: 'menuitem' }, l, k ? h('kbd', { class: 'kbd' }, k) : null))))));
}

const modal = (cls, ...body) => h('dialog', { class: cls, onclick: (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); } }, h('div', {}, ...body));

function sheet(o, names) {
  const variants = ['primary', 'secondary', 'outline', 'ghost', 'destructive', 'link'];
  const sizes = ['xs', 'sm', 'default', 'lg'];
  const dialog = modal('dialog',
    h('header', {}, h('h2', {}, 'Rename the view'), h('p', {}, 'The name the sidebar shows. Only this browser keeps it.')),
    h('section', {}, h('input', { class: 'input', type: 'text', value: 'Open bugs', 'aria-label': 'Name' })),
    h('footer', {}, btn('Cancel', { 'data-variant': 'outline', onclick: (e) => e.target.closest('dialog').close() }), btn('Save', { onclick: (e) => e.target.closest('dialog').close() })));
  const alert = modal('alert-dialog',
    h('header', {}, h('h2', {}, 'Move 3 items to the trash?'), h('p', {}, 'They can be restored from Trash; their ids are never reused.')),
    h('footer', {}, btn('Cancel', { 'data-variant': 'outline', onclick: (e) => e.target.closest('dialog').close() }),
      btn('Move to trash', { 'data-variant': 'destructive', onclick: (e) => e.target.closest('dialog').close() })));
  const drawer = h('dialog', { class: 'drawer', 'data-side': 'right', onclick: (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); } },
    h('div', {}, h('header', {}, h('h2', {}, 'Filters'), h('p', {}, 'A drawer from the right: the phone sidebar would be one from the left.')),
      h('section', {}, h('p', {}, 'Content')), h('footer', {}, btn('Done', { onclick: (e) => e.target.closest('dialog').close() }))));
  const palette = h('dialog', { class: 'command-dialog', onclick: (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); } },
    command([['Go to', [['Today', 'G T'], ['Board', 'G B'], ['Settings', 'G S']]], ['Items', names.slice(0, 5).map((n) => [n])],
      ['Create', [['New story', 'C'], ['New doc']]]]));
  const toaster = h('div', { id: 'toaster', class: 'toaster' });
  const calendarSlot = h('div', { class: 'lab-cal' });
  const table = h('div', { class: 'table-container' }, h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, ['ID', 'Title', 'Status', 'Due'].map((t) => h('th', {}, t)))),
    h('tbody', {}, names.slice(0, 5).map((n, k) => h('tr', {}, h('td', { class: 'tnum' }, `STY-${480 + k}`), h('td', {}, n),
      h('td', {}, h('span', { class: 'badge', 'data-variant': 'outline' }, STATUSES[k + 1][1])), h('td', { class: 'tnum' }, `2026-11-${10 + k}`))))));

  const el = h('div', {},
    sec('Buttons', variants.map((v) => row(...sizes.map((s) => btn(`${v} ${s}`, { 'data-variant': v, 'data-size': s })),
      btn(icon('plus', 16), { 'data-variant': v, 'data-size': 'icon', 'aria-label': 'Add' })))),
    sec('Badges and tooltips',
      row(...['primary', 'secondary', 'outline', 'destructive', 'ghost'].map((v) => h('span', { class: 'badge', 'data-variant': v }, v))),
      row(...['top', 'bottom', 'left', 'right'].map((s) => btn(`Tooltip ${s}`, { 'data-variant': 'outline', 'data-tooltip': `Opens on hover and focus (${s})`, 'data-side': s })))),
    sec('Fields',
      h('div', { class: 'lab-grid2' },
        h('div', { class: 'lab-col' },
          h('div', { class: 'field' }, h('label', { class: 'label', for: 'lab-title' }, 'Title'),
            h('input', { class: 'input', id: 'lab-title', type: 'text', value: 'Draft the release notes' }),
            h('p', {}, 'What the card and the list show.')),
          h('div', { class: 'field' }, h('label', { class: 'label' }, 'Status (select)'),
            selectBox(STATUSES.map(([k, l]) => [k, l]), 'inprogress')),
          h('div', { class: 'field' }, h('label', { class: 'label' }, 'Parent (combobox, 100 options)'), combobox(names))),
        h('div', { class: 'lab-col' },
          h('label', { class: 'label' }, h('input', { type: 'checkbox', class: 'input', checked: true }), 'Show closed items'),
          h('label', { class: 'label' }, h('input', { type: 'checkbox', class: 'input', role: 'switch' }), 'Compact rows'),
          h('label', { class: 'label' }, h('input', { type: 'checkbox', class: 'input', role: 'switch', checked: true }), 'Week starts on Monday')))),
    sec('Menus',
      row(dropdownMenu('Display', [{ label: 'Order', kbd: 'O' }, { label: 'Group', kbd: 'G' }, '-', { label: 'Delete view', danger: true }]),
        popover('Due date', calendarSlot), popover('Filter', h('div', { class: 'lab-col' }, h('p', {}, 'Status'), selectBox([['any', 'Any'], ['open', 'Open']], 'any'))))),
    sec('Tabs', tabs([['Properties', h('p', {}, 'Status, priority, dates…')], ['Relations', h('p', {}, 'Parent, blocks, relates to')], ['History', h('p', {}, '12 changes')]])),
    sec('Overlays',
      row(btn('Dialog', { onclick: () => dialog.showModal() }), btn('Alert dialog', { 'data-variant': 'outline', onclick: () => alert.showModal() }),
        btn('Drawer', { 'data-variant': 'outline', onclick: () => drawer.showModal() }),
        btn(h('span', {}, 'Command ', h('kbd', { class: 'kbd' }, '⌘K')), { 'data-variant': 'outline', onclick: () => palette.showModal() }),
        btn('Toast with Undo', { 'data-variant': 'secondary', onclick: () => basecoatToast(toaster, 'STY-482 moved to Done', false, { label: 'Undo', run: () => basecoatToast(toaster, 'Undone') }) }),
        btn('Error toast', { 'data-variant': 'ghost', onclick: () => basecoatToast(toaster, 'The vault could not be read', true) })),
      dialog, alert, drawer, palette, toaster),
    sec('Empty, skeleton, kbd',
      h('div', { class: 'lab-grid2' },
        h('div', { class: 'empty' }, h('header', {}, h('figure', {}, icon('inbox', 20)), h('h3', {}, 'Nothing in Inbox'), h('p', {}, 'What you capture with q lands here.')),
          h('section', {}, btn('Capture', { 'data-size': 'sm' }))),
        h('div', { class: 'lab-col' }, h('div', { class: 'skeleton', style: 'height:16px;width:70%' }), h('div', { class: 'skeleton', style: 'height:16px;width:90%' }),
          h('div', { class: 'skeleton', style: 'height:16px;width:50%' }), h('p', {}, 'Press ', h('kbd', { class: 'kbd' }, '⌘'), h('kbd', { class: 'kbd' }, 'K'), ' to search.')))),
    sec('Table and item',
      table,
      h('div', { class: 'item', 'data-variant': 'outline', style: 'margin-top:12px;max-width:520px' }, h('figure', {}, icon('calendar', 18)),
        h('section', {}, h('h3', {}, 'Weekly review'), h('p', {}, 'Every Friday · 30 min')), h('aside', {}, btn('Open', { 'data-size': 'sm', 'data-variant': 'outline' })))),
    sec('Type scale',
      h('div', { class: 'lab-grid2' },
        h('div', {}, h('p', { class: 'lab-note' }, 'Now (app.css --fs-*)'), h('div', { class: 'lab-scale' },
          CURRENT_SCALE.map(([n, px]) => [h('code', {}, n), h('code', {}, `${px}px`), h('span', { style: `font-size:${px}px` }, 'Draft the release notes')]))),
        h('div', {}, h('p', { class: 'lab-note' }, 'Proposed (size / line)'), h('div', { class: 'lab-scale' },
          PROPOSED_SCALE.map(([n, px, lh]) => [h('code', {}, n), h('code', {}, `${px}/${lh}`), h('span', { style: `font-size:${px}px;line-height:${lh}px` }, 'Draft the release notes')]))))),
    sec('Statuses: now and from Radix scales (contrast of the text on its fill)',
      h('div', { class: 'lab-chips' }, STATUSES.map(([k, l, hue]) => [h('code', {}, k),
        h('span', { class: 'lab-chip lab-measure', style: `background:var(--st-${k}-bg);color:var(--st-${k}-fg)` }, l),
        h('span', { class: 'lab-chip lab-measure', style: `background:var(--${hue}-3);color:var(--${hue}-11);box-shadow:inset 0 0 0 1px var(--${hue}-6)` }, h('i', { style: `background:var(--${hue}-9)` }), l),
        h('small', { class: 'lab-ratios' })]))),
    sec('Accents (brand fill with white text · accent text on the background)',
      row(...ACCENTS.map((a) => h('span', { class: 'lab-swatch lab-measure', style: `background:var(--${a}-9);color:#fff` }, a))),
      row(...ACCENTS.map((a) => h('span', { class: 'lab-swatch lab-measure', style: `background:var(--background);color:var(--${a}-11);box-shadow:inset 0 0 0 1px var(--border)` }, `${a} link`)))),
    sec('Icons: Lucide 1.70 (vendored SVG) over the ones copied into ui.js', h('div', { class: 'lab-icons lab-lucide' }), h('div', { class: 'lab-icons', style: 'margin-top:12px' },
      LUCIDE.map((n) => h('figure', {}, icon({ 'chevron-down': 'down', 'trash-2': 'trash', ellipsis: 'more' }[n] || n, 20), n)))));
  return { el, calendarSlot };
}

/** Each measured chip and swatch, its contrast written next to it (in its own document's colours). */
function writeRatios(doc) {
  doc.querySelectorAll('.lab-swatch.lab-measure').forEach((s) => { s.dataset.ratio = ratio(contrastOf(s)); s.title = s.dataset.ratio; s.textContent = `${s.textContent.split(' ·')[0]} · ${s.dataset.ratio}`; });
  doc.querySelectorAll('.lab-chips .lab-ratios').forEach((cell) => {
    const [now, radix] = [cell.previousElementSibling.previousElementSibling, cell.previousElementSibling];
    cell.textContent = `now ${ratio(contrastOf(now))} · radix ${ratio(contrastOf(radix))}`;
  });
}

async function fillLucide(doc) {
  const box = doc.querySelector('.lab-lucide');
  const parser = new DOMParser();
  for (const n of LUCIDE) {
    const text = await fetch(`vendor/lucide/icons/${n}.svg`).then((r) => r.text()); // our own vendored files, not user input
    const svg = parser.parseFromString(text, 'image/svg+xml').documentElement;
    // Into this page's document first: h() tells nodes from text with `instanceof Node`, which is per window.
    box.append(h('figure', {}, document.importNode(svg, true), n));
  }
}

function calendar(doc) {
  const cal = doc.createElement('calendar-date');
  cal.setAttribute('value', '2026-11-12');
  cal.setAttribute('first-day-of-week', '1');
  cal.append(doc.createElement('calendar-month'));
  cal.addEventListener('change', () => { cal.closest('.popover')?.querySelector('button').replaceChildren(`Due ${cal.value}`); });
  return cal;
}

// ── the risky tests, on this page ─────────────────────────────────────────────────────────────────────────────
const results = [];
const tick = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// withSelect: 'basecoat' (its select in every row), 'app' (ui.js select(), as the lists do today) or false.
function fakeRows(n, withSelect) {
  const cell = () => (withSelect === 'basecoat' ? selectBox([['a', 'Low'], ['b', 'High']], 'a')
    : withSelect === 'app' ? select([['a', 'Low'], ['b', 'High']], 'a', () => {}) : h('span', {}, 'Low'));
  return Array.from({ length: n }, (_, k) => h('div', { class: 'lab-perf-row' },
    h('span', { class: 'mono' }, `STY-${k}`), h('span', {}, `Row ${k}`), h('span', { class: 'chip' }, 'In progress'), cell(), h('span', {}, '2026-11-12')));
}

async function repaintCost(box, { withSelect, observer, manual }) {
  if (observer) window.basecoat.start(); else window.basecoat.stop();
  const times = [];
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    box.replaceChildren(...fakeRows(200, withSelect));
    if (manual) window.basecoat.init('select');
    await tick(); // the observer's callback runs before the next task
    times.push(performance.now() - t0);
  }
  window.basecoat.start();
  return { median: median(times), total: times.reduce((s, x) => s + x, 0) };
}

function testsPanel(o, addResult) {
  const out = h('tbody');
  const sandbox = h('div', { class: 'lab-sandbox', hidden: true });
  let pageToaster = null;
  const need = async () => { await loadBasecoat(o.style); loadBtn.textContent = 'Unload Basecoat from the page'; };
  const loadBtn = h('button', { class: 'btn', onclick: async () => {
    if (basecoatLoaded()) { unloadBasecoat(); loadBtn.textContent = 'Load Basecoat on the page'; return; }
    await need();
  } }, basecoatLoaded() ? 'Unload Basecoat from the page' : 'Load Basecoat on the page');

  const perf = async () => {
    await need();
    sandbox.hidden = false;
    const cases = [['plain rows, observer off', { withSelect: false, observer: false }], ['plain rows, observer on', { withSelect: false, observer: true }],
      ['rows with the app\'s select() (today), observer on', { withSelect: 'app', observer: true }],
      ['rows with a Basecoat select, observer on (auto-init)', { withSelect: 'basecoat', observer: true }],
      ['rows with a Basecoat select, observer off, basecoat.init("select")', { withSelect: 'basecoat', observer: false, manual: true }]];
    for (const [name, c] of cases) {
      const r = await repaintCost(sandbox, c);
      addResult(`Repaint 200 rows ×50: ${name}`, `${r.median.toFixed(1)} ms median · ${r.total.toFixed(0)} ms total`, '');
    }
    sandbox.replaceChildren();
    sandbox.hidden = true;
  };

  const menuOpen = async () => {
    await need();
    sandbox.hidden = false;
    const draw = () => { const m = dropdownMenu('Display', [{ label: 'Order' }, { label: 'Group' }]); sandbox.replaceChildren(m, h('p', { class: 'lab-sib' }, 'a sibling')); return m; };
    let m = draw();
    await tick();
    m.querySelector('button').click();
    await tick();
    const opened = m.querySelector('button').getAttribute('aria-expanded') === 'true';
    sandbox.querySelector('.lab-sib').replaceChildren('the sibling, repainted');
    await tick();
    const keptSibling = m.isConnected && m.querySelector('button').getAttribute('aria-expanded') === 'true';
    m = draw(); // what a view's update() does when it rebuilds its rows
    await tick();
    const openAfter = !!sandbox.querySelector('[aria-expanded="true"]');
    addResult('A menu open while the page repaints', opened ? `repaint of a sibling: ${keptSibling ? 'stays open' : 'closes'} · rebuild of the menu: ${openAfter ? 'stays open' : 'closes'}` : 'the menu did not open',
      'Basecoat keeps no state outside the element: rebuilding it closes it (as the app\'s own menus today).');
    sandbox.replaceChildren();
    sandbox.hidden = true;
  };

  const toastUndo = async () => {
    await need();
    if (!pageToaster) { pageToaster = h('div', { id: 'toaster', class: 'toaster' }); document.body.append(pageToaster); await tick(); }
    let ran = false;
    const t = basecoatToast(pageToaster, 'STY-482 moved to Done', false, { label: 'Undo', run: () => { ran = true; } });
    await tick();
    const undo = t.querySelector('footer button');
    undo.click();
    await new Promise((r) => setTimeout(r, 400));
    addResult('toast(msg, isError, { label, run }) on Basecoat', `Undo ran: ${ran} · toast closed: ${!t.isConnected || t.getAttribute('aria-hidden') === 'true'}`,
      'Basecoat takes the action only as an onclick string; basecoat.js adds the button itself. Role status/alert per category.');
  };

  const cardDialog = async () => {
    await need();
    await firstLoad;
    const item = state.all.find(hasPage) || state.all[0];
    if (!item) { addResult('Item card in a Basecoat dialog', 'no item in this vault', ''); return; }
    const page = h('div', { class: 'page' });
    const dlg = h('dialog', { class: 'dialog lab-card', 'aria-label': item.title }, h('div', {}, page));
    document.body.append(dlg);
    const ed = createPageEditor(page, { onGone: () => dlg.close() });
    await ed.load(item.key);
    ed.render();
    dlg.showModal();
    await tick();
    const inside = dlg.contains(document.activeElement);
    dlg.addEventListener('close', async () => {
      addResult('Item card in a Basecoat dialog', `focus inside on open: ${inside} · closed by: ${dlg.returnValue || 'Esc / close()'}`, 'The rest of the page is inert while it is open (native showModal).');
      await ed.flush(); ed.reset(); disposeEditor(ed); dlg.remove();
    }, { once: true });
  };

  const box = h('section', { class: 'group lab-tests' },
    h('header', {}, h('h3', {}, 'Risky tests, on this page')),
    h('p', { class: 'muted' }, 'With Basecoat loaded as the app would load it (its CSS in the vendor layer, under app.css). The results stay here and in window.__labResults.'),
    h('div', { class: 'lab-actions' }, loadBtn,
      h('button', { class: 'btn', onclick: perf }, 'Measure repaint cost'),
      h('button', { class: 'btn', onclick: menuOpen }, 'Repaint with a menu open'),
      h('button', { class: 'btn', onclick: toastUndo }, 'Toast with Undo'),
      h('button', { class: 'btn', onclick: cardDialog }, 'Item card in a dialog')),
    h('table', { class: 'lab-results' }, h('thead', {}, h('tr', {}, h('th', {}, 'Test'), h('th', {}, 'Result'), h('th', {}, 'Note'))), out),
    sandbox);
  return { el: box, out, cleanup: () => { pageToaster?.remove(); } };
}

export function mount(root) {
  const o = readOpts();
  // Not h(): its href takes only links from files (safeUrl), and this one is the app's own stylesheet.
  const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'css/lab/lab.css', id: 'lab-css' });
  document.head.append(css);
  const frame = h('iframe', { class: 'lab-frame', title: 'Basecoat components' });
  let doc = null;
  const set = (k) => (v) => { o[k] = v; saveOpts(o); if (doc) { applyStage(doc, o); requestAnimationFrame(() => writeRatios(doc)); } };
  const control = (label, k, values) => h('label', {}, label, select(values.map((v) => [v, v]), o[k], set(k), { 'aria-label': label }));
  const bar = h('div', { class: 'lab-bar' },
    control('Theme', 'skin', ['classic', 'modern']), control('Mode', 'mode', ['light', 'dark']), control('Style', 'style', STYLES),
    control('Density', 'density', ['comfortable', 'compact']), control('Accent', 'accent', ACCENTS));
  window.__labResults = results;
  const tests = testsPanel(o, (test, result, note) => {
    results.push({ test, result, note });
    tests.out.append(h('tr', {}, h('td', {}, test), h('td', {}, result), h('td', { class: 'muted' }, note)));
  });
  root.replaceChildren(pageHead({ title: 'Lab' }),
    h('p', { class: 'muted' }, 'The design-system spike: Basecoat\'s components on their own, with the theme\'s tokens. Density and accent apply to the new theme only.'),
    bar, frame, tests.el);
  firstLoad.then(async () => {
    const names = [...new Set(state.all.map((i) => i.title).filter(Boolean))].slice(0, 100);
    while (names.length < 100) names.push(`Item ${names.length + 1}`);
    frame.addEventListener('load', async () => {
      doc = frame.contentDocument;
      applyStage(doc, o);
      const { el, calendarSlot } = sheet(o, names);
      doc.body.append(doc.adoptNode(el));
      calendarSlot.append(calendar(doc));
      await fillLucide(doc);
      await doc.fonts.ready;
      writeRatios(doc);
    }, { once: true });
    frame.srcdoc = stageDoc(o, await classicTokens());
  });
  return {
    update() {},
    unmount() {
      css.remove();
      tests.cleanup();
      if (!new URLSearchParams(location.search).has('basecoat')) unloadBasecoat();
    },
  };
}
