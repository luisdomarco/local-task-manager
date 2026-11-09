// A diff drawn as the dock's chat draws an edit (app.css .cv-diff): a line each, its sign in a narrow column, added
// lines on green and deleted ones on red, a hunk's head as a grey line. What it draws: { lines: [{ sign, text } |
// { hunk }] } — chat-model.js editDiff (an Edit or Write of the chat), udiff.js parseUnifiedDiff (a run's Changes).
import { h } from './ui.js';

export function diffBlock(diff) {
  return h('div', { class: 'cv-diff' }, diff.lines.map((l) => (l.hunk !== undefined
    ? h('div', { class: 'cv-dl hunk' }, l.hunk)
    : h('div', { class: `cv-dl ${l.sign === '+' ? 'add' : l.sign === '-' ? 'del' : ''}` }, h('span', { class: 'cv-sign' }, l.sign), l.text))));
}
