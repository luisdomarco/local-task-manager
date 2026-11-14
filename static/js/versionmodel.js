// A definition's version numbers (tm/versions.py, mirrored): `major.minor`, cut by hand, never typed. No DOM here;
// tested in tests/js/versionmodel.test.mjs.

const VERSION_RE = /^(\d+)\.(\d+)$/;

/** The version after `v`: a minor one (1.2 → 1.3) or a major one, which changes a contract (1.2 → 2.0). One that is
 *  not `major.minor` starts again from 1.0 (versions.bump). */
export function bumpVersion(v, major = false) {
  const m = VERSION_RE.exec(String(v ?? '').trim());
  if (!m) return '1.0';
  return major ? `${Number(m[1]) + 1}.0` : `${m[1]}.${Number(m[2]) + 1}`;
}

/** What the next cut would be named: after the last version kept, else after the item's own `version`. */
export const nextBase = (info) => info?.versions?.[0]?.version || info?.version || null;

/** How the header names it: `v1.2`, `v1.2 · edited` when it changed after its last version; null without a version. */
export function versionText(info) {
  const v = info?.version;
  if (!v) return null;
  return info.edited ? `v${v} · edited` : `v${v}`;
}
