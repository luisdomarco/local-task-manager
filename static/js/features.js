// What this page has: what the platform has (server.py features(): every feature on a computer, none of the
// desktop-only ones on a phone — agents, terminal, canvas, open_in, reveal, export, server) AND what the vault it shows
// keeps on (Settings → Vaults → Features, tm/vaultsettings.py FEATURES: agents, canvas, inbox, activity, goals, graph,
// meetings, worklog, contacts — the server sends each vault's `features_off`). A control that needs one carries
// data-feature="<name>" and app.css hides it while <html data-off> names that feature; a route, a shortcut or a
// Settings tab asks has() instead. state.js reload() hands each config it loads, and the vault picked, to setFeatures().

let platform = {};
let vaultOff = new Set();

/** Takes the features of a config just loaded and of the vault this page shows, and returns the ones off, as
 *  <html data-off> lists them. */
export function setFeatures(config, vault = null) {
  platform = { ...(config?.features || {}) };
  const v = (config?.vaults || []).find((x) => x.id === vault);
  vaultOff = new Set(v?.features_off || []);
  if (vaultOff.has('agents')) vaultOff.add('terminal'); // Claude runs in a terminal: no agents, no Claude button
  return offList();
}

/** Whether `name` is on. Until the config has loaded, and for a server from before features, everything is. */
export function has(name) {
  return platform[name] !== false && !vaultOff.has(name);
}

/** The features turned off, sorted, space-separated ('' when none). */
export function offList() {
  return [...new Set([...Object.keys(platform).filter((name) => platform[name] === false), ...vaultOff])].sort().join(' ');
}

/** The views that are a feature's (main.js routes, the ⌘K palette, the g-keys): off with it, their address goes home. */
export const VIEW_FEATURE = { canvas: 'canvas', runs: 'agents', lab: 'agents', inbox: 'inbox', graph: 'graph', log: 'worklog', contacts: 'contacts' };
export const viewOn = (view) => !VIEW_FEATURE[view] || has(VIEW_FEATURE[view]);

/** Whether the platform has `name`, whatever the vault keeps (Settings → Vaults → Features: "not on this device"). */
export const onPlatform = (name) => platform[name] !== false;
