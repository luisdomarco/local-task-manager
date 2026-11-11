// "Choose…" next to a folder field: the system's own folder dialog instead of typing the path. A page cannot learn a
// folder's absolute path (a browser's folder picker gives names, never where they are), so on a Mac the server opens
// the dialog (server.py pick_folder) and answers the path; inside the iPhone app the app opens Files' picker (its
// `pickFolder` message handler), and keeps the folder open for the server from then on. Typing it still works.
import { api } from './api.js';
import { state, toast } from './state.js';
import { h, icon } from './ui.js';

/** The iPhone app's folder picker (WKWebView's message handler), or null in a browser. */
export const nativePicker = (win = globalThis) => win.webkit?.messageHandlers?.pickFolder || null;

/** {path} or {cancelled} from whichever dialog this page has: the app's, else the server's. */
async function pickFolder(start, prompt) {
  const native = nativePicker();
  if (native) return (await native.postMessage({ start, prompt })) || { cancelled: true };
  return api.pickFolder(start, prompt);
}

/**
 * The button for `input`: the dialog starts at the folder the field names (or its nearest parent that exists), and
 * the folder chosen goes into the field, as if typed (an `input` event, so whatever listens to the field hears it),
 * then to `onPick(path)` if given. Cancelling changes nothing. Null where the server cannot open the dialog (not a
 * Mac): the field alone is shown, as before.
 */
export function folderButton(input, { prompt = 'Choose a folder', onPick } = {}) {
  const native = nativePicker();
  if (!state.config?.can_pick_folder && !native) return null;
  const button = h('button', { type: 'button', class: 'btn small ghost folder-pick', title: native ? 'Choose the folder in Files' : 'Choose the folder in a Finder dialog',
    onclick: async () => {
      button.disabled = true;
      try {
        const { path } = await pickFolder(input.value.trim(), prompt);
        if (!path) return;
        input.value = path;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        onPick?.(path);
      } catch (e) {
        toast(e.message, true);
      } finally {
        button.disabled = false;
        if (document.contains(input) && !native) input.focus(); // on a phone that would raise the keyboard
      }
    } }, icon('folderopen', 13), 'Choose…');
  return button;
}
