/** The Documentation head's line: the version released and the commit this copy runs, short, with the day it was
 * built or installed (server.py app_build: the iPhone bundle's CORE_COMMIT, the Mac's install.json). */
export function versionLine(version, build) {
  const engine = build && build.commit ? `engine ${build.commit.slice(0, 7)}${build.built_at ? ` · ${String(build.built_at).slice(0, 10)}` : ''}` : '';
  return [version ? `Version ${version}` : '', engine].filter(Boolean).join(' · ');
}
