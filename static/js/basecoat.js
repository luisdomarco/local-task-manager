// Basecoat (static/vendor/basecoat, VENDOR.md): the whole of it, CSS and scripts, for #/lab and `?basecoat=1` (main.js),
// which loads it over every screen to see what the families the app has not adopted yet would change there. The page
// itself loads only the adopted ones (css/main.css, basecoat-nova.app.css, tools/basecoat_css.py). Its CSS goes into
// the `vendor` cascade layer, under the `app` layer, so every rule of app.css wins over it.
// Its scripts are classic scripts that register on window.basecoat, in order; loaded after DOMContentLoaded they
// do not start on their own, so this starts them.

export const STYLES = ['nova', 'mira'];
// The components the lab uses, after the registry they register with. SRI as index.html's vendored scripts:
// openssl dgst -sha384 -binary <file> | openssl base64 -A
export const SCRIPTS = [
  ['basecoat', 'sha384-K1w/8BZNQc+02JnyibbylrLXh4mBzvzNIl0PZduEsb7JPR5GhJyrmsEVGQV7JTa+'],
  ['select', 'sha384-SFCnp+/4KC2H+vIxe1xNNmrm5mCXvZhJLlRgB9eEr1Ymc8NdhwdGokurjQnEaIZl'],
  ['combobox', 'sha384-X6UT+cRkPnLhs6AT8uJ8S7d7pD4sqRTs16s6F6ALdKaImU3sBYlQW90Kc2AmMvLV'],
  ['dropdown-menu', 'sha384-jBV2NjzQfh3FeeibBIS8xsYyFkuExHOQu0klul7OjhHF0UpovuhWdg2U5HJGU8Cc'],
  ['popover', 'sha384-gB78+zBNA7+hLbmMA2W/GqRU+ufdybk7kIVi3CpsME/9G1sTGbLT10bNoFwrLYF7'],
  ['tabs', 'sha384-Z5FqqbbMj1sOibatDlMrhU2aOrlRVDb5dv9TRnf6Vym1EEdSyya1YFsaDUbj6vjz'],
  ['toast', 'sha384-JCOnao18+zaMlFtMLCJyOqx+8hUugXNiWBbGoOZY7q9sUrMwloVBYEouZtFl/t4f'],
  ['command', 'sha384-i7Raf25qcUmot+J0dl2Hn1aKTz8JFiyFSRou847lNsO/CY+hA8SemZyxteOLd1hm'],
  ['drawer', 'sha384-Xs2za4QS61XS27pew5KUWjDOFxMwxBMde9ZyoGETeK5toMkvLaSBT6ysCD0b01Pt'],
];
export const CALLY = ['vendor/cally/cally.js', 'sha384-u4A+Reqm96p98u0/soe8JHDNHuyIZjXjSIBcq9nF4OBeCLHmSiOKT3MPGnyElqMa'];
export const scriptUrl = (name) => `vendor/basecoat/js/${name}.min.js`;
export const cssUrl = (style) => `vendor/basecoat/basecoat-${STYLES.includes(style) ? style : 'nova'}.cdn.min.css`;

let scripts = null;
const addScript = (src, integrity) => new Promise((ok, fail) => {
  const el = Object.assign(document.createElement('script'), { src, integrity, onload: ok, onerror: () => fail(new Error(`${src} did not load`)) });
  document.head.append(el);
});

/** Basecoat's CSS (in the `vendor` layer) and its scripts on this page; the CSS can change style, the scripts load once. */
export function loadBasecoat(style = 'nova') {
  let el = document.getElementById('basecoat-css');
  if (!el) el = document.head.appendChild(Object.assign(document.createElement('style'), { id: 'basecoat-css' }));
  el.textContent = `@import url("${cssUrl(style)}") layer(vendor);`;
  scripts ||= (async () => {
    for (const [name, sri] of SCRIPTS) await addScript(scriptUrl(name), sri);
    window.basecoat.initAll();
    window.basecoat.start();
  })();
  return scripts;
}

/** Its CSS off the page again, and its observer stopped (scripts cannot be taken back: the components stay registered). */
export function unloadBasecoat() {
  document.getElementById('basecoat-css')?.remove();
  window.basecoat?.stop();
}

export const basecoatLoaded = () => !!document.getElementById('basecoat-css');

/**
 * The app's toast(msg, isError, { label, run }) on Basecoat's toaster (`#toaster`, initialised by its script).
 * Basecoat takes an action only as an `onclick` *string* (an inline handler): the button is added here instead, in the
 * toast's footer, where the toaster's own click handler closes the toast.
 */
export function basecoatToast(toaster, msg, isError = false, action = null) {
  const t = toaster.toast({ category: isError ? 'error' : 'success', title: msg, duration: isError ? 6000 : action ? 7000 : 2500 });
  if (action) {
    const content = t.querySelector('.toast-content');
    let foot = content.querySelector('footer');
    if (!foot) foot = content.appendChild(t.ownerDocument.createElement('footer'));
    const btn = t.ownerDocument.createElement('button');
    Object.assign(btn, { type: 'button', className: 'btn', textContent: action.label });
    btn.dataset.size = 'sm';
    btn.addEventListener('click', () => { Promise.resolve(action.run()).catch(() => {}); });
    foot.append(btn);
  }
  return t;
}
