// What this platform has (server.py features(): every feature on a computer, none of the desktop-only ones on a
// phone): agents, terminal, canvas, open_in, reveal, export, install. A control that needs one carries
// data-feature="<name>" and app.css hides it while <html data-off> names that feature; a route, a shortcut or a
// Settings tab asks has() instead. state.js reload() hands each config it loads to setFeatures().

let features = {};

/** Takes the features of a config just loaded, and returns the ones it turns off, as <html data-off> lists them. */
export function setFeatures(config) {
  features = { ...(config?.features || {}) };
  return offList();
}

/** Whether `name` is on. Until the config has loaded, and for a server from before features, everything is. */
export function has(name) {
  return features[name] !== false;
}

/** The features turned off, sorted, space-separated ('' when none). */
export function offList() {
  return Object.keys(features).filter((name) => features[name] === false).sort().join(' ');
}
