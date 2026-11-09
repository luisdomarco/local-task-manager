// A unified diff as `git diff` writes it, read into the lines diffview.js draws: each `{ sign, text }` ('+' added, '-'
// deleted, ' ' kept) or `{ hunk: '@@ -1,2 +1,3 @@ …' }` where a hunk starts. Its headers (diff --git, index, ---, +++,
// mode and binary lines) are left out. No DOM here; tested in tests/js/udiff.test.mjs.

/** → { lines, add, del }: what diffview.js diffBlock takes, and the lines added and deleted. */
export function parseUnifiedDiff(text) {
  const lines = [];
  let add = 0;
  let del = 0;
  let inHunk = false;
  for (const raw of String(text || '').split('\n')) {
    if (raw.startsWith('@@')) { lines.push({ hunk: raw }); inHunk = true; continue; }
    if (!inHunk) continue; // a header (HEADER), or nothing yet
    if (raw.startsWith('diff --git ')) { inHunk = false; continue; } // a second file: its headers again
    if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
    const sign = raw[0];
    if (sign === '+') add += 1;
    else if (sign === '-') del += 1;
    else if (sign !== ' ' && raw !== '') continue;
    lines.push({ sign: sign === '+' || sign === '-' ? sign : ' ', text: raw.slice(1) });
  }
  if (lines.length && lines[lines.length - 1].sign === ' ' && lines[lines.length - 1].text === '') lines.pop(); // the newline git ends with
  return { lines, add, del };
}
