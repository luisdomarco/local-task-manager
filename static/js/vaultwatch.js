// The page keeps up with its vault: what another program changes in its folder (Obsidian, iCloud, an agent, the vault
// CLI, another tab) shows by itself, a few seconds later. While the page is in view it asks the server what changed
// (GET /api/vault/changes, server.py vault_changes), every EVERY ms and as soon as it comes back (in view, focused, or
// restored from the browser's cache); after AWAY ms without an answer (asleep, hidden, the app in the background) it
// loads everything again whatever the answer says, as it does when the server's index changed; the answer
// names the files, never this tab's own writes (api.js sends its TAB). A Markdown file loads the items again, anything
// loads the file tree again (explorer.js), and onVaultChange hands the paths to whoever shows them.
// A poll, not a stream: the iPhone app answers each request in memory, and a stream would never flow there.
// Reload from disk (Settings → Vaults, ⌘K) opens the vault again on the server, then loads everything again here.
import { api } from './api.js';
import { loadFiles } from './explorer.js';
import { reload, reloadStructure, toast } from './state.js';
import { vaultId } from './vault.js';

const EVERY = 4000;
const AWAY = 60000;
let since = null; // the sequence number of the last answer, of `epoch`
let epoch = null; // the server's index of this vault: another one after Reload from disk or a restart
let asking = false;
let answered = 0; // Date.now() of the last answer: a gap past AWAY means the page was away
const listeners = [];

/** Calls `fn(paths)` after the page took in what changed in the vault (`paths` null: anything may have). */
export const onVaultChange = (fn) => listeners.push(fn);

/** Whether a changed path holds items: a Markdown file under no hidden folder (what the server's walk would read). */
export const touchesItems = (paths) => !paths || paths.some((p) => /\.md$/i.test(p) && !p.split('/').some((s) => s.startsWith('.')));

async function take(paths) {
  if (touchesItems(paths)) await reload();
  loadFiles();
  listeners.forEach((fn) => fn(paths));
}

async function ask() {
  if (asking || document.hidden || !vaultId()) return;
  asking = true;
  try {
    const r = await api.vaultChanges(since, epoch);
    const known = since !== null;
    const reopened = known && r.epoch !== epoch; // opened again meanwhile: what it was is no guide
    const away = known && Date.now() - answered > AWAY;
    since = r.seq;
    epoch = r.epoch;
    answered = Date.now();
    if (reopened || r.more || away) await take(null);
    else if (known && r.paths.length) await take(r.paths);
  } catch {
    // The server restarting, the Mac asleep: asked again at the next tick
  } finally {
    asking = false;
  }
}

/** Reload from disk: the vault `id` (this page's when left out) opened again on the server, its index and the copy this
 *  device keeps of it dropped and read again; this page loads everything again when it is the one shown. A toast says
 *  how much was read. */
export async function reloadFromDisk(id = null) {
  try {
    const r = await api.reloadVault(id);
    if (!id || id === vaultId()) {
      since = null; // the next ask starts again from the new index
      reloadStructure();
      await take(null);
    }
    toast(`Read again from disk: ${r.items} item${r.items === 1 ? '' : 's'}, ${r.files} file${r.files === 1 ? '' : 's'} (${(r.ms / 1000).toFixed(1)} s)`);
    return r;
  } catch (e) {
    toast(`Could not read the vault again: ${e.message}`, true);
    return null;
  }
}

export function initVaultWatch() {
  ask();
  setInterval(ask, EVERY);
  // Back in view, focused (the installed app brought forward fires no visibilitychange), or restored from the cache
  const back = () => { if (!document.hidden) ask(); };
  document.addEventListener('visibilitychange', back);
  window.addEventListener('focus', back);
  window.addEventListener('pageshow', (e) => { if (e.persisted) back(); });
}
