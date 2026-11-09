// "Choose…" next to a folder field: macOS's own folder dialog instead of typing the path. A page cannot learn a
// folder's absolute path (a browser's folder picker gives names, never where they are), so the server opens the
// dialog (server.py pick_folder) and answers the path. Typing it still works: the field stays as it was.
import { api } from './api.js';
import { state, toast } from './state.js';
import { h, icon } from './ui.js';

/**
 * The button for `input`: the dialog starts at the folder the field names (or its nearest parent that exists), and
 * the folder chosen goes into the field, as if typed (an `input` event, so whatever listens to the field hears it),
 * then to `onPick(path)` if given. Cancelling changes nothing. Null where the server cannot open the dialog (not a
 * Mac): the field alone is shown, as before.
 */
export function folderButton(input, { prompt = 'Choose a folder', onPick } = {}) {
  if (!state.config?.can_pick_folder) return null;
  const button = h('button', { type: 'button', class: 'btn small ghost folder-pick', title: 'Choose the folder in a Finder dialog',
    onclick: async () => {
      button.disabled = true;
      try {
        const { path } = await api.pickFolder(input.value.trim(), prompt);
        if (!path) return;
        input.value = path;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        onPick?.(path);
      } catch (e) {
        toast(e.message, true);
      } finally {
        button.disabled = false;
        if (document.contains(input)) input.focus();
      }
    } }, icon('folderopen', 13), 'Choose…');
  return button;
}
