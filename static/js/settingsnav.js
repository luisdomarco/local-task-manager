// Settings' sections in groups (views/settings.js settingsNav draws them as a column on the left; a phone, as a list).
// Pure: which group each section's key goes in, and in which order. A key no group names goes last, under More.

/** The groups, in order: what the vault holds, how the app looks and is driven, Claude, the app itself. */
export const NAV_GROUPS = [
  ['Workspace', ['vaults', 'statuses', 'reminders', 'general', 'maintenance']],
  ['Appearance', ['themes', 'keyboard']],
  ['Claude & agents', ['claude', 'agents']],
  ['The app', ['app', 'export', 'documentation']],
];

/** `keys` (the sections this page shows) as [[group name, [key…]]…]: a group with none of them left out. */
export function groupSections(keys) {
  const shown = new Set(keys);
  const groups = NAV_GROUPS.map(([name, own]) => [name, own.filter((k) => shown.has(k))]).filter(([, own]) => own.length);
  const named = new Set(NAV_GROUPS.flatMap(([, own]) => own));
  const rest = keys.filter((k) => !named.has(k));
  return rest.length ? [...groups, ['More', rest]] : groups;
}
