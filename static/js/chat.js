// One chat in the dock: a Claude session the server runs as `claude -p` in stream-json (tm/chat.py), shown as a
// conversation — Claude's text as Markdown, each tool call on one line that opens to its input and output (an edit
// as its diff; a subagent as what it did), a permission request as a card answered with a click (a question as its
// options, a plan as the plan) — and a composer with the session's mode, model, effort, plan, attached items and
// images, and a stop button. What the messages mean is chat-model.js; this file only draws it. term.js hosts it.
import { api } from './api.js';
import { STATUSES, apply, currentModel, editDiff, effortLabel, emptyChat, kTokens, modelName, modelOptions, questionAnswers, sessionStatus, shortPath,
  subagentSummary, toolTarget } from './chat-model.js';
import { IMAGE_TYPES, dropToken, imageFit, insertPick, matchCommands, matchFiles, matchItems, tokenAt } from './composer.js';
import { isDone } from './rules.js';
import { state, toast } from './state.js';
import { h, icon, renderMarkdown, select, typeIcon } from './ui.js';

const MODES = [['default', 'Ask before edits', 'user'], ['acceptEdits', 'Accept edits', 'pencil'], ['plan', 'Plan', 'note'], ['auto', 'Auto', 'target']];
const MODELS = ['opus', 'sonnet', 'haiku', 'fable']; // until claude lists its own (tm/chat.py model_choice)
const ITEMS_MAX = 10; // attached to one message (server.py CHAT_ITEMS_MAX)
const IMAGES_MAX = 5; // with one message (tm/chat.py IMAGES_MAX)
const IMAGE_MAX = 5 * 1024 * 1024; // characters of one image in base64 (tm/chat.py IMAGE_MAX)
const IMAGE_SIDE = 2000; // pixels: a larger image is scaled down before it goes
const FILES_FRESH = 30000; // ms an @ list of the session's files is reused before it is asked again
// The commands claude listed last (its `init`): a chat that has not had its first reply yet offers these.
let knownCommands = [];
try { knownCommands = JSON.parse(localStorage.getItem('tm.chat.commands') || '[]'); } catch { /* private window */ }
const TOOL_ICON = { Read: 'file', Edit: 'pencil', MultiEdit: 'pencil', Write: 'pencil', NotebookEdit: 'pencil', Bash: 'terminal',
  Grep: 'search', Glob: 'search', WebFetch: 'link', WebSearch: 'search', Task: 'bot', Agent: 'bot', TodoWrite: 'checklist',
  AskUserQuestion: 'message', ExitPlanMode: 'note' };
const ANSWERED = { allow: 'Allowed once', deny: 'Denied', interrupted: 'Not answered: the turn ended' };
const RESULT_SHOWN = 6000; // characters of a tool's output drawn; the server keeps up to 20 000

const money = (usd) => (usd >= 0.01 ? `$${usd.toFixed(2)}` : usd > 0 ? '<$0.01' : '');

/** A button that copies `text()` and says so. */
function copyButton(text, title = 'Copy') {
  const b = h('button', { type: 'button', class: 'btn icon cv-copy', title, 'aria-label': title, onclick: async () => {
    try { await navigator.clipboard.writeText(text()); b.classList.add('done'); setTimeout(() => b.classList.remove('done'), 1200); } catch (e) { toast(`Could not copy: ${e.message}`, true); }
  } }, icon('copy', 13));
  return b;
}

// ── one item of the thread ───────────────────────────────────────────────────
function diffBlock(diff) {
  return h('div', { class: 'cv-diff' }, diff.lines.map((l) => h('div', { class: `cv-dl ${l.sign === '+' ? 'add' : l.sign === '-' ? 'del' : ''}` },
    h('span', { class: 'cv-sign' }, l.sign), l.text)));
}

/** A subagent's own steps, one short line each, under its call. */
function childLines(children, cwd) {
  return h('div', { class: 'cv-sub' }, children.map((c) => {
    if (c.kind === 'tool') {
      const st = !c.done ? h('span', { class: 'cv-spin' }) : c.error ? h('span', { class: 'cv-bad' }, icon('x', 12)) : h('span', { class: 'cv-ok' }, icon('check', 12));
      return h('div', { class: 'cv-sub-line' }, icon(TOOL_ICON[c.name] || 'sparkles', 12), h('span', { class: 'cv-tname' }, c.name),
        h('span', { class: 'cv-target' }, toolTarget(c.name, c.input, cwd)), h('span', { class: 'spacer' }), st);
    }
    return c.kind === 'text' ? h('div', { class: 'cv-sub-text' }, c.text) : null;
  }));
}

function toolItem(item, cwd, opened) {
  const diff = editDiff(item.name, item.input);
  const sub = item.children?.length ? subagentSummary(item.children) : null;
  const state = !item.done ? h('span', { class: 'cv-spin', title: 'Running' })
    : item.error ? h('span', { class: 'cv-bad', title: 'Failed' }, icon('x', 13)) : h('span', { class: 'cv-ok', title: 'Done' }, icon('check', 13));
  const counts = diff ? h('span', { class: 'cv-counts' }, h('span', { class: 'add' }, `+${diff.add}`), ' ', h('span', { class: 'del' }, `−${diff.del}`))
    : sub ? h('span', { class: 'cv-counts' }, `${sub.tools} tool${sub.tools === 1 ? '' : 's'}${sub.running ? ` · ${sub.running}…` : ''}`) : null;
  const body = [];
  if (sub) body.push(childLines(item.children, cwd));
  if (item.name === 'ExitPlanMode' && item.input.plan) {
    const md = h('div', { class: 'cv-plan md' });
    md.innerHTML = renderMarkdown(String(item.input.plan)); // sanitized (DOMPurify)
    body.push(md);
  }
  if (item.name === 'Bash') body.push(h('pre', { class: 'cv-code' }, item.input.command || ''));
  if (diff) body.push(diffBlock(diff));
  if (item.name === 'TodoWrite') {
    body.push(h('ul', { class: 'cv-todos' }, (item.input.todos || []).map((t) => h('li', { class: `cv-todo ${t.status}` },
      icon(t.status === 'completed' ? 'check' : t.status === 'in_progress' ? 'right' : 'minus', 12), t.content || t.activeForm || ''))));
  }
  if (item.result && !(diff && !item.error) && !(item.name === 'ExitPlanMode' && !item.error)) {
    const shown = item.result.length > RESULT_SHOWN ? `${item.result.slice(0, RESULT_SHOWN)}\n…` : item.result;
    body.push(h('pre', { class: `cv-out${item.error ? ' error' : ''}` }, shown));
  }
  const details = h('details', { class: `cv-tool${item.error ? ' error' : ''}${sub ? ' cv-agent' : ''}` },
    h('summary', {}, icon(TOOL_ICON[item.name] || 'sparkles', 13), h('span', { class: 'cv-tname' }, item.name),
      h('span', { class: 'cv-target' }, toolTarget(item.name, item.input, cwd)), h('span', { class: 'spacer' }), counts, state),
    body.length ? h('div', { class: 'cv-tbody' }, body) : null);
  // An edit is worth seeing as it happens; what the user opened or closed stays so when the line is drawn again.
  // `opened` holds an id opened by hand and `-id` closed by hand.
  details.open = opened.has(item.id) || (Boolean(diff) && item.name !== 'Write' && !opened.has(`-${item.id}`));
  details.addEventListener('toggle', () => {
    opened.delete(details.open ? `-${item.id}` : item.id);
    opened.add(details.open ? item.id : `-${item.id}`);
  });
  return details;
}

// ── the cards with a form of their own: a question, a plan ───────────────────
function questionCard(item, answer) {
  const questions = Array.isArray(item.input.questions) ? item.input.questions : [];
  const picks = questions.map(() => []);
  const other = questions.map(() => '');
  const single = questions.length === 1 && !questions[0].multiSelect;
  const submit = h('button', { class: 'btn primary', disabled: true, onclick: () => send() }, 'Send answers', h('kbd', {}, '⏎'));
  const ready = () => questionAnswers(questions, picks, other);
  const send = () => { const a = ready(); if (a) answer(item, 'allow', false, { answers: a }); };
  const paint = () => { submit.disabled = !ready(); };
  const blocks = questions.map((q, i) => {
    const opts = (q.options || []).map((o) => {
      const btn = h('button', { type: 'button', class: 'cv-opt', role: q.multiSelect ? 'checkbox' : 'radio', 'aria-checked': 'false',
        onclick: () => {
          if (q.multiSelect) picks[i] = picks[i].includes(o.label) ? picks[i].filter((x) => x !== o.label) : [...picks[i], o.label];
          else picks[i] = [o.label];
          other[i] = ''; otherBox.value = '';
          for (const b of list.children) b.setAttribute('aria-checked', String(picks[i].includes(b.dataset.label)));
          paint();
          if (single) send(); // one question, one choice: the click is the answer
        } }, h('span', { class: 'cv-opt-label' }, o.label), o.description ? h('span', { class: 'cv-opt-desc' }, o.description) : null);
      btn.dataset.label = o.label;
      return btn;
    });
    const list = h('div', { class: 'cv-opts', role: q.multiSelect ? 'group' : 'radiogroup', 'aria-label': q.question }, opts);
    const otherBox = h('input', { class: 'cv-other', type: 'text', placeholder: 'Other: type your own answer', maxlength: 4000,
      oninput: () => {
        other[i] = otherBox.value;
        if (otherBox.value.trim()) { picks[i] = []; for (const b of list.children) b.setAttribute('aria-checked', 'false'); }
        paint();
      },
      onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); } } });
    return h('div', { class: 'cv-q' }, h('div', { class: 'cv-q-text' }, q.header ? h('span', { class: 'cv-q-head' }, q.header) : null, q.question),
      list, otherBox);
  });
  return h('div', { class: 'cv-perm cv-ask', role: 'group', 'aria-label': 'Claude asks', tabindex: '-1',
    onkeydown: (e) => { if (e.key === 'Escape') { e.preventDefault(); answer(item, 'deny', false, { message: 'The user skipped the question.' }); } } },
  h('div', { class: 'cv-perm-head' }, icon('message', 14), questions.length > 1 ? 'Claude has some questions' : 'Claude asks'),
  ...blocks,
  h('div', { class: 'cv-perm-actions' }, single ? null : submit,
    h('button', { class: 'btn', onclick: () => answer(item, 'deny', false, { message: 'The user skipped the question.' }) }, 'Skip', h('kbd', {}, 'esc'))));
}

function planCard(item, answer) {
  const md = h('div', { class: 'cv-plan md' });
  md.innerHTML = renderMarkdown(String(item.input.plan || '')); // sanitized (DOMPurify)
  const note = h('textarea', { class: 'cv-other', rows: 2, placeholder: 'Or tell Claude what to change, and keep planning' });
  const keep = h('button', { class: 'btn', onclick: () => {
    const message = note.value.trim();
    answer(item, 'deny', false, { message: message || 'Keep planning: the user did not approve this plan yet.' });
  } }, 'Keep planning');
  return h('div', { class: 'cv-perm cv-plancard', role: 'group', 'aria-label': 'The plan', tabindex: '-1' },
    h('div', { class: 'cv-perm-head' }, icon('note', 14), 'Claude\'s plan is ready'),
    md,
    h('div', { class: 'cv-perm-actions' },
      h('button', { class: 'btn primary', onclick: () => answer(item, 'allow', false, { mode: 'acceptEdits' }) }, 'Approve, accept edits'),
      h('button', { class: 'btn', onclick: () => answer(item, 'allow', false, { mode: 'default' }) }, 'Approve, ask before edits')),
    note, h('div', { class: 'cv-perm-actions' }, keep));
}

function formAnswered(item) {
  if (item.form === 'question' && item.answer === 'allow') {
    return h('div', { class: 'cv-answered allow cv-qa' }, Object.entries(item.answers || {}).map(([q, a]) => h('div', {},
      icon('check', 13), h('span', { class: 'cv-qa-q' }, q), ' ', h('b', {}, a))));
  }
  const text = item.form === 'plan'
    ? (item.answer === 'allow' ? (item.mode === 'acceptEdits' ? 'Plan approved — accepting edits' : 'Plan approved')
      : item.answer === 'deny' ? `Kept planning${item.message && !item.message.startsWith('Keep planning:') ? `: ${item.message}` : ''}` : ANSWERED[item.answer])
    : item.answer === 'deny' ? 'Question skipped' : ANSWERED[item.answer];
  return h('div', { class: `cv-answered ${item.answer}` }, icon(item.answer === 'allow' ? 'check' : 'x', 13), text || item.answer);
}

function permissionItem(item, chat, cwd, answer) {
  if (item.form) {
    if (item.answer) return formAnswered(item);
    const card = item.form === 'question' ? questionCard(item, answer) : planCard(item, answer);
    queueMicrotask(() => {
      const typing = document.activeElement?.classList.contains('cv-input') && document.activeElement.value.trim();
      if (card.isConnected && !chat.ended && !typing) card.querySelector('button.cv-opt, button.primary')?.focus({ preventScroll: true });
    });
    return card;
  }
  if (item.answer) {
    const text = item.answer === 'allow' && item.always ? 'Allowed for the rest of this session' : ANSWERED[item.answer] || item.answer;
    return h('div', { class: `cv-answered ${item.answer}` }, icon(item.answer === 'allow' ? 'check' : 'x', 13), `${item.tool}: ${text}`);
  }
  const diff = editDiff(item.tool, item.input);
  const what = item.tool === 'Bash' ? h('pre', { class: 'cv-code' }, item.input.command || '')
    : diff ? diffBlock(diff) : h('pre', { class: 'cv-code' }, toolTarget(item.tool, item.input, cwd) || JSON.stringify(item.input, null, 2));
  const allow = h('button', { class: 'btn primary', onclick: () => answer(item, 'allow') }, 'Allow', h('kbd', {}, '⏎'));
  const card = h('div', { class: 'cv-perm', role: 'group', 'aria-label': `Permission for ${item.tool}`, tabindex: '-1',
    onkeydown: (e) => { if (e.key === 'Escape') { e.preventDefault(); answer(item, 'deny'); } } },
  h('div', { class: 'cv-perm-head' }, icon('alert', 14), `Claude wants to use ${item.tool}`),
  item.description ? h('div', { class: 'cv-perm-desc' }, item.description) : null,
  what,
  h('div', { class: 'cv-perm-actions' }, allow,
    h('button', { class: 'btn', onclick: () => answer(item, 'allow', true) }, 'Allow for this session'),
    h('button', { class: 'btn', onclick: () => answer(item, 'deny') }, 'Deny', h('kbd', {}, 'esc'))));
  // The card takes the focus (Enter allows, Esc denies), unless the user is in the middle of typing something.
  queueMicrotask(() => {
    const typing = document.activeElement?.classList.contains('cv-input') && document.activeElement.value.trim();
    if (card.isConnected && !chat.ended && !typing) allow.focus({ preventScroll: true });
  });
  return card;
}

/** A vault item attached to a message: its type, its id, its title — and an × while it is still in the composer. */
function itemChip(it, onRemove = null) {
  return h('span', { class: 'cv-att', title: `${it.id ? `${it.id} · ` : ''}${it.title}` }, it.type ? typeIcon(it.type, 12) : icon('note', 12),
    it.id ? h('span', { class: 'cv-att-id' }, it.id) : null, h('span', { class: 'cv-att-title' }, it.title),
    onRemove ? h('button', { type: 'button', class: 'btn icon cv-att-x', title: 'Remove', 'aria-label': `Remove ${it.id || it.title}`, onclick: onRemove }, icon('x', 11)) : null);
}

/** An image of a message: its thumbnail (a data: URL the composer made), or a plain chip when none was kept. */
// A thumbnail is a data: URL, which h() refuses for any src: only a raster one in base64 is set (tm/chat.py THUMB…).
const THUMB_RE = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/;
function imageThumb(im, onRemove = null) {
  let face = h('span', { class: 'cv-img-none' }, icon('image', 16));
  if (THUMB_RE.test(im.thumb || '')) { face = h('img', { alt: 'Image' }); face.src = im.thumb; }
  return h('span', { class: 'cv-img', title: im.name || im.media_type || 'Image' }, face,
    onRemove ? h('button', { type: 'button', class: 'btn icon cv-att-x', title: 'Remove', 'aria-label': 'Remove the image', onclick: onRemove }, icon('x', 11)) : null);
}

function itemEl(item, chat, cwd, answer, opened) {
  switch (item.kind) {
    case 'user': return h('div', { class: 'cv-user' },
      item.images?.length ? h('div', { class: 'cv-att-row' }, item.images.map((im) => imageThumb(im))) : null,
      item.text ? h('div', { class: 'cv-bubble' }, item.text) : null,
      item.attached?.length ? h('div', { class: 'cv-att-row' }, item.attached.map((it) => itemChip(it))) : null,
      h('div', { class: 'cv-user-foot' }, item.queued ? h('span', { class: 'cv-queued', title: 'Claude takes it in when it can' }, 'Sent while Claude was working') : null,
        item.text ? copyButton(() => item.text, 'Copy this message') : null));
    case 'text': {
      const el = h('div', { class: `cv-text md${item.partial ? ' partial' : ''}` });
      if (item.partial) { el.textContent = item.text; return el; } // plain while it streams: Markdown once it is whole
      el.innerHTML = renderMarkdown(item.text); // sanitized by renderMarkdown (DOMPurify; escaped when it is missing)
      return h('div', { class: 'cv-said' }, el, copyButton(() => item.text, 'Copy this reply (Markdown)'));
    }
    case 'thinking': return h('details', { class: 'cv-think' }, h('summary', {}, icon('lightbulb', 13), 'Thought'),
      h('div', { class: 'cv-think-body' }, item.text));
    case 'tool': return toolItem(item, cwd, opened);
    case 'permission': return permissionItem(item, chat, cwd, answer);
    case 'notice': return h('div', { class: `cv-notice ${item.tone || ''}` }, item.text);
    case 'settings': return h('div', { class: 'cv-notice cv-settings' }, icon('sparkles', 12),
      `Now ${modelName(chat.models, item.model)}${item.effort ? ` · ${effortLabel(item.effort)} effort` : ''}`);
    case 'turn': return h('div', { class: 'cv-turn', title: item.model }, modelName(chat.models, item.model));
    default: return h('div');
  }
}

// What makes an item look different: when it changes, the item is drawn again.
const sig = (it) => (it.kind === 'text' ? `${it.text.length}${it.partial}`
  : it.kind === 'tool' ? `${it.done}${it.error}${(it.result || '').length}/${it.children?.length || 0}.${it.children?.filter((c) => c.done).length || 0}`
  : it.kind === 'permission' ? `${it.answer}${it.always}` : '');

// ── the view ─────────────────────────────────────────────────────────────────
/**
 * A chat's pane. `info` is the server's (tm/chat.py Chat.info); `onChange(view)` runs whenever its status may have
 * changed, for the dock's list. → { id, el, info, chat, status(), focus(), destroy(), attachItem(item), resume }
 */
export function chatView(info, { onChange = () => {}, onResume = null } = {}) {
  let chat = emptyChat();
  const rendered = []; // [{ item, sig, el }], in the thread's order
  const opened = new Set(); // tool lines opened (id) or closed (-id) by hand, kept when they are drawn again
  const view = { id: info.id, info, get chat() { return chat; } };
  let slashCommands = [];

  const thread = h('div', { class: 'cv-thread', role: 'log', 'aria-live': 'polite' });
  const input = h('textarea', { class: 'cv-input', rows: 1, 'data-mentions': 'off', 'aria-autocomplete': 'list',
    placeholder: 'Reply to Claude — / commands, @ files, # items' });
  const send = h('button', { class: 'btn icon cv-round cv-send', title: 'Send (Enter) — Shift+Enter for a new line', 'aria-label': 'Send' }, icon('up', 16));
  const stop = h('button', { class: 'btn icon cv-round cv-stop', title: 'Stop this turn', 'aria-label': 'Stop' }, icon('stop', 14));
  const modeSel = select(MODES, 'default', async (v) => {
    try { await api.chatControl(info.id, { mode: v }); } catch (e) { toast(e.message, true); modeSel.value = chat.mode; }
  }, { class: 'small cv-pick cv-mode', 'aria-label': 'Permission mode', title: 'Permission mode' });
  // The model and effort menus are made again when what they offer changes (claude lists its models once it starts).
  let modelSel = h('span', { hidden: true });
  let effortSel = h('span', { hidden: true });
  let pickersSig = null;
  const trigger = (ch, title, face = ch) => h('button', { type: 'button', class: 'btn icon cv-trigger', title, 'aria-label': title,
    onmousedown: (e) => e.preventDefault(), onclick: () => typeTrigger(ch) }, face);
  const attached = []; // vault items for the next message: { key, id, title, type }
  const images = []; // images for the next message: { data (base64), thumb (data URL), name }
  const chips = h('div', { class: 'cv-att-row', hidden: true });
  const fileInput = h('input', { type: 'file', accept: IMAGE_TYPES.join(','), multiple: true, hidden: true,
    onchange: () => { addImages([...fileInput.files]); fileInput.value = ''; } });
  const imageBtn = h('button', { type: 'button', class: 'btn icon cv-trigger', title: 'Add an image (or paste or drop one)', 'aria-label': 'Add an image',
    onclick: () => fileInput.click() }, icon('image', 14));
  const planList = h('div', { class: 'cv-planpop', hidden: true, role: 'dialog', 'aria-label': 'Claude\'s plan' });
  const planChip = h('button', { type: 'button', class: 'cv-chip', hidden: true, 'aria-haspopup': 'dialog', title: 'See the plan',
    onclick: () => { planList.hidden = !planList.hidden; planChip.setAttribute('aria-expanded', String(!planList.hidden)); } });
  const meter = h('span', { class: 'cv-meter' });
  const working = h('div', { class: 'cv-working', hidden: true }, h('span', { class: 'cv-spin' }), 'Claude is working…');
  const suggest = h('div', { class: 'cv-suggest', hidden: true, role: 'listbox', id: `cv-sug-${info.id}` });
  input.setAttribute('aria-controls', suggest.id);
  const resumeBtn = h('button', { class: 'btn primary', onclick: () => onResume?.(view) }, icon('terminal', 14), 'Resume this session');
  const endedBar = h('div', { class: 'cv-endedbar', hidden: true }, h('span', {}, 'This session is not running.'), resumeBtn);
  const composer = h('div', { class: 'cv-composer' },
    h('div', { class: 'cv-box' }, suggest, planList, chips, input, fileInput,
      h('div', { class: 'cv-tools' }, trigger('/', 'Run a command (/)'), trigger('@', 'Mention a file (@)'),
        trigger('#', 'Attach an item of the vault (#)', icon('paperclip', 14)), imageBtn, modeSel, modelSel, effortSel, planChip,
        h('span', { class: 'spacer' }), meter, stop, send)));
  // Scrolled up while something new comes in: a button down to it, louder when Claude is waiting for an answer.
  const jump = h('button', { type: 'button', class: 'cv-jump', hidden: true, onclick: () => toEnd(true) }, icon('down', 13), h('span'));
  const el = h('div', { class: 'td-pane cv' }, thread, h('div', { class: 'cv-jumpbar' }, jump), working, endedBar, composer);
  view.el = el;

  const near = () => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
  let unseen = false; // drawn while the thread was scrolled up
  function paintJump() {
    if (near()) unseen = false;
    const waiting = chat.pending > 0;
    jump.hidden = near() || !(unseen || waiting);
    jump.classList.toggle('urgent', waiting);
    jump.lastChild.textContent = waiting ? 'Claude needs you' : 'New messages';
  }
  function toEnd(smooth = false) {
    thread.scrollTo({ top: thread.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }
  thread.addEventListener('scroll', paintJump, { passive: true });
  async function answer(item, behavior, always = false, extra = {}) {
    try { await api.chatPermission(info.id, item.id, behavior, always, extra); } catch (e) { toast(e.message, true); }
  }

  function draw() {
    const stick = near();
    const items = chat.items;
    let i = 0;
    while (i < rendered.length && i < items.length && rendered[i].item === items[i] && rendered[i].sig === sig(items[i])) i += 1;
    for (const r of rendered.splice(i)) r.el.remove(); // from the first that changed on, drawn again
    if (i < items.length && !stick) unseen = true;
    for (; i < items.length; i += 1) {
      const node = itemEl(items[i], chat, info.cwd, answer, opened);
      thread.append(node);
      rendered.push({ item: items[i], sig: sig(items[i]), el: node });
    }
    working.hidden = !chat.busy || chat.pending > 0 || chat.items.at(-1)?.partial;
    paintSend();
    modeSel.value = chat.mode;
    paintPickers();
    paintPlan();
    const w = chat.window;
    meter.textContent = [w ? `${w.percent}% context` : kTokens(chat.context) && `${kTokens(chat.context)} tokens`, money(chat.cost)].filter(Boolean).join(' · ');
    meter.title = w ? `${kTokens(w.used)} of ${kTokens(w.max)} tokens of context used` : 'Tokens of context used';
    meter.classList.toggle('full', Boolean(w && w.percent >= 80));
    endedBar.hidden = !chat.ended;
    composer.hidden = chat.ended;
    if (stick) toEnd();
    paintJump();
    onChange(view);
  }

  function take(msg) {
    if (msg.type === 'system' && msg.subtype === 'init' && msg.slash_commands?.length) {
      slashCommands = knownCommands = msg.slash_commands;
      try { localStorage.setItem('tm.chat.commands', JSON.stringify(knownCommands)); } catch { /* private window */ }
    }
    apply(chat, msg);
  }

  // ── the stream ──
  const source = new EventSource(`/api/chat/stream?id=${encodeURIComponent(info.id)}`);
  source.addEventListener('snapshot', (e) => {
    const p = JSON.parse(e.data);
    chat = emptyChat();
    rendered.splice(0).forEach((r) => r.el.remove());
    view.info = info = { ...info, ...p.info };
    for (const m of p.events) take(m);
    if (p.info.busy) chat.busy = true;
    if (!chat.model) chat.model = p.info.model || ''; // a resume: the model it was recorded with, until claude says
    if (p.info.mode && chat.mode === 'default') chat.mode = p.info.mode;
    if (p.info.models?.length) chat.models = p.info.models; // not in the conversation: claude's answers to us
    if (p.info.effort) chat.effort = p.info.effort;
    if (p.info.window) chat.window = p.info.window;
    draw();
    toEnd(); // a conversation reopened starts at its end
    unseen = false;
    paintJump();
  });
  source.addEventListener('msg', (e) => { take(JSON.parse(e.data)); draw(); });
  source.addEventListener('exit', () => { source.close(); if (!chat.ended) { apply(chat, { type: 'tm_exit', exit_code: 0 }); draw(); } });
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED && !chat.ended) { apply(chat, { type: 'tm_exit', exit_code: null }); draw(); }
  };

  // ── the composer ──
  async function submit() {
    const text = input.value.trim();
    if ((!text && !attached.length && !images.length) || chat.ended) return;
    const items = attached.splice(0);
    const pics = images.splice(0);
    input.value = '';
    fit();
    hidePicker();
    paintChips();
    try { await api.chatSend(info.id, text, items.map((it) => it.key), pics.map(({ data, thumb }) => ({ data, thumb }))); } catch (e) {
      input.value = text; attached.push(...items); images.push(...pics); fit(); paintChips(); toast(e.message, true);
    }
  }
  // ↑ in an empty box brings back the last message sent, to fix it and send it again.
  function recall() {
    const lastSent = chat.items.findLast((it) => it.kind === 'user' && it.text);
    if (!lastSent) return false;
    input.value = lastSent.text;
    fit();
    input.setSelectionRange(input.value.length, input.value.length);
    paintSend();
    return true;
  }
  function paintPlan() {
    const plan = chat.plan;
    planChip.hidden = !plan?.total;
    if (!plan?.total) { planList.hidden = true; return; }
    planChip.replaceChildren(icon('checklist', 12), `Plan ${plan.done}/${plan.total}`);
    planList.replaceChildren(h('div', { class: 'cv-sug-head' }, `Claude's plan · ${plan.done} of ${plan.total} done`),
      h('ul', { class: 'cv-todos' }, plan.todos.map((t) => h('li', { class: `cv-todo ${t.status}` },
        icon(t.status === 'completed' ? 'check' : t.status === 'in_progress' ? 'right' : 'minus', 12),
        t.status === 'in_progress' ? t.activeForm || t.content : t.content || t.activeForm || ''))));
  }

  // ── images: pasted, dropped or picked; scaled down when large, sent as base64 with a small copy to show ──
  const readAs = (blob) => new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(r.error || new Error('could not read it'));
    r.readAsDataURL(blob);
  });
  async function encode(bitmap, side, type, quality) {
    const [w, hgt] = imageFit(bitmap.width, bitmap.height, side);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = hgt;
    const ctx = canvas.getContext('2d');
    if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hgt); } // a transparent PNG would go black
    ctx.drawImage(bitmap, 0, 0, w, hgt);
    return canvas.toDataURL(type, quality);
  }
  async function addImages(files) {
    for (const file of files) {
      if (!IMAGE_TYPES.includes(file.type)) { toast(`${file.name || 'That file'}: images are PNG, JPEG, GIF or WebP`, true); continue; }
      if (images.length >= IMAGES_MAX) { toast(`At most ${IMAGES_MAX} images go with one message`, true); break; }
      try {
        const bitmap = await createImageBitmap(file);
        let url = await readAs(file);
        if (Math.max(bitmap.width, bitmap.height) > IMAGE_SIDE || url.length > IMAGE_MAX) {
          url = await encode(bitmap, IMAGE_SIDE, 'image/jpeg', 0.85); // a large screenshot: scaled to what the model reads
        }
        if (url.length > IMAGE_MAX) { toast(`${file.name || 'That image'} is too large, even scaled down`, true); continue; }
        const thumb = await encode(bitmap, 160, 'image/jpeg', 0.7);
        bitmap.close?.();
        images.push({ data: url.slice(url.indexOf(',') + 1), thumb, name: file.name || 'Pasted image' });
      } catch (e) { toast(`Could not read ${file.name || 'that image'}: ${e.message}`, true); }
    }
    paintChips();
    input.focus();
  }
  function paintSend() {
    const ready = Boolean(input.value.trim()) || attached.length > 0 || images.length > 0;
    stop.hidden = !chat.busy;
    send.hidden = chat.busy && !ready; // while Claude works, Stop takes its place until there is something to send
    send.disabled = !ready;
  }
  function paintChips() {
    chips.replaceChildren(...images.map((im, i) => imageThumb(im, () => { images.splice(i, 1); paintChips(); input.focus(); })),
      ...attached.map((it, i) => itemChip(it, () => { attached.splice(i, 1); paintChips(); input.focus(); })));
    chips.hidden = !attached.length && !images.length;
    paintSend();
  }
  // Model and effort: claude's own list once it has given it — each model with its version, the efforts it takes.
  function paintPickers() {
    const options = modelOptions(chat.models, MODELS);
    const cur = currentModel(chat.models, chat.model);
    const efforts = cur?.efforts || [];
    const sigNow = JSON.stringify([options, efforts]);
    if (sigNow !== pickersSig) {
      pickersSig = sigNow;
      const m = select(options.map(([v, l]) => [v, l, 'sparkles']), null, async (v) => {
        try { await api.chatControl(info.id, { model: v }); } catch (e) { toast(e.message, true); paintPickers(); }
      }, { class: 'small cv-pick', 'aria-label': 'Model', title: 'Model' });
      const e = select(efforts.map((x) => [x, effortLabel(x), 'flame']), null, async (v) => {
        try { await api.chatControl(info.id, { effort: v }); } catch (err) { toast(err.message, true); paintPickers(); }
      }, { class: 'small cv-pick', 'aria-label': 'Effort', title: 'Effort: how hard the model thinks' });
      modelSel.replaceWith(m); modelSel = m;
      effortSel.replaceWith(e); effortSel = e;
    }
    modelSel.value = cur?.value || MODELS.find((m) => (chat.model || '').includes(m)) || null;
    modelSel.hidden = !modelSel.value; // claude's default, not yet named: nothing to show until it says
    effortSel.value = efforts.includes(chat.effort) ? chat.effort : null;
    effortSel.hidden = !efforts.length || !effortSel.value;
  }
  // Grows with what is typed, up to a third of the pane, so the conversation always keeps most of it.
  function fit() {
    input.style.height = 'auto';
    const most = Math.max(64, Math.round(el.clientHeight * 0.33));
    input.style.height = `${Math.min(input.scrollHeight, most)}px`;
    input.style.overflowY = input.scrollHeight > most ? 'auto' : 'hidden';
  }

  // The / and @ picker: one menu above the box, kept by the caret's token (composer.js).
  let picker = null; // { token, entries, active }
  let files = null; // { at, paths, truncated } | 'loading'
  async function loadFiles() {
    if (files === 'loading' || (files && Date.now() - files.at < FILES_FRESH)) return;
    files = 'loading';
    try {
      const r = await api.chatFiles(info.id);
      files = { at: Date.now(), paths: r.files, truncated: r.truncated };
    } catch (e) { files = null; toast(e.message, true); return; }
    showPicker();
  }
  function hidePicker() {
    picker = null;
    suggest.hidden = true;
    suggest.replaceChildren();
    input.removeAttribute('aria-activedescendant');
  }
  function showPicker() {
    const token = input.selectionStart === input.selectionEnd ? tokenAt(input.value, input.selectionStart) : null;
    if (!token) { hidePicker(); return; }
    let entries;
    let note = null;
    if (token.kind === '/') {
      const commands = slashCommands.length ? slashCommands : knownCommands;
      entries = matchCommands(commands, token.query);
      if (!commands.length) note = 'The commands arrive with Claude\'s first reply';
      else if (!entries.length) note = 'No command matches';
    } else if (token.kind === '#') {
      entries = matchItems(state.items, token.query, { isClosed: isDone }).filter((it) => !attached.some((a) => a.key === it.key));
      if (!token.query) note = 'Type an id or words of a title';
      else if (!entries.length) note = 'No item matches';
    } else {
      if (!files || files === 'loading' || Date.now() - files.at > FILES_FRESH) loadFiles();
      entries = files && files !== 'loading' ? matchFiles(files.paths, token.query) : [];
      if (!files || files === 'loading') note = 'Looking at the files…';
      else if (!entries.length) note = files.truncated ? 'No match among the first files listed' : 'No file matches';
    }
    const keyOf = (v) => (typeof v === 'string' ? v : v.key);
    const same = picker && picker.token.kind === token.kind && picker.entries.map(keyOf).join('\n') === entries.map(keyOf).join('\n');
    picker = { token, entries, active: same ? Math.min(picker.active, entries.length - 1) : 0 };
    const head = token.kind === '/' ? 'Commands' : token.kind === '#' ? `Attach an item of ${state.vault?.name || 'the vault'}`
      : `Files in ${shortPath(info.cwd, '').split('/').filter(Boolean).pop() || info.cwd}`;
    suggest.replaceChildren(h('div', { class: 'cv-sug-head' }, head), ...entries.map((value, i) => {
      if (token.kind === '#') {
        return h('div', { class: `cv-sug${i === picker.active ? ' active' : ''}`, role: 'option', id: `${suggest.id}-${i}`,
          'aria-selected': String(i === picker.active), onmousedown: (e) => { e.preventDefault(); pick(i); },
          onmousemove: () => { if (picker && picker.active !== i) { picker.active = i; paintActive(); } } },
        typeIcon(value.type, 14), h('span', { class: 'cv-sug-name' }, value.title), value.id ? h('span', { class: 'cv-sug-dir' }, value.id) : null);
      }
      const folder = value.endsWith('/');
      const cut = value.replace(/\/$/, '').lastIndexOf('/');
      const body = token.kind === '/' ? [h('span', { class: 'cv-sug-name cv-cmd' }, `/${value}`)]
        : [icon(folder ? 'folder' : 'file', 14), h('span', { class: 'cv-sug-name' }, value.slice(cut + 1)),
          cut > 0 ? h('span', { class: 'cv-sug-dir' }, value.slice(0, cut + 1)) : null];
      return h('div', { class: `cv-sug${i === picker.active ? ' active' : ''}`, role: 'option', id: `${suggest.id}-${i}`,
        'aria-selected': String(i === picker.active),
        onmousedown: (e) => { e.preventDefault(); pick(i); }, onmousemove: () => { if (picker && picker.active !== i) { picker.active = i; paintActive(); } } }, ...body);
    }), ...(note ? [h('div', { class: 'cv-sug-note' }, note)] : []));
    suggest.hidden = false;
    paintActive();
  }
  function paintActive() {
    suggest.querySelectorAll('.cv-sug').forEach((row, i) => {
      const on = i === picker.active;
      row.classList.toggle('active', on);
      row.setAttribute('aria-selected', String(on));
      if (on) { row.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', row.id); }
    });
  }
  function pick(i) {
    const value = picker?.entries[i];
    if (value == null) return;
    if (picker.token.kind === '#') { attach(value); return; }
    const out = insertPick(input.value, picker.token, input.selectionStart, value);
    input.value = out.text;
    input.setSelectionRange(out.caret, out.caret);
    input.focus();
    fit();
    paintSend();
    showPicker(); // a folder picked: what is in it
    if (picker && !value.endsWith('/')) hidePicker();
  }
  function attach(it) {
    const out = dropToken(input.value, picker.token, input.selectionStart);
    input.value = out.text;
    input.setSelectionRange(out.caret, out.caret);
    hidePicker();
    attachItem(it);
    input.focus();
    fit();
  }
  /** An item for the next message, as a chip: from the # picker, or the item the session was just moved to. */
  function attachItem(it) {
    if (attached.some((a) => a.key === it.key)) return;
    if (attached.length >= ITEMS_MAX) toast(`At most ${ITEMS_MAX} items go with one message`, true);
    else attached.push({ key: it.key, id: it.id || '', title: it.title, type: it.type });
    paintChips();
  }
  // The /, @ and # buttons: as if typed at the caret (a / only starts a message).
  function typeTrigger(ch) {
    input.focus();
    if (ch === '/') {
      if (!input.value.startsWith('/')) input.value = `/${input.value}`;
      input.setSelectionRange(1, 1);
    } else {
      const at = input.selectionStart;
      const pad = at > 0 && !/\s/.test(input.value[at - 1]) ? ' ' : '';
      input.setRangeText(`${pad}${ch}`, at, input.selectionEnd, 'end');
    }
    fit();
    showPicker();
  }

  input.addEventListener('input', () => { fit(); showPicker(); paintSend(); });
  input.addEventListener('click', showPicker);
  input.addEventListener('blur', hidePicker);
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addImages(files); }
  });
  composer.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer?.items || [])].some((it) => it.kind === 'file')) return;
    e.preventDefault();
    composer.classList.add('drop');
  });
  composer.addEventListener('dragleave', (e) => { if (!composer.contains(e.relatedTarget)) composer.classList.remove('drop'); });
  composer.addEventListener('drop', (e) => {
    composer.classList.remove('drop');
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    addImages(files);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && (attached.length || images.length) && input.selectionStart === 0 && input.selectionEnd === 0 && !picker) {
      if (attached.length) attached.pop(); else images.pop();
      paintChips(); return; // at the very start: the last thing attached goes
    }
    if (e.key === 'ArrowUp' && !input.value && !picker && recall()) { e.preventDefault(); return; }
    if (picker && picker.entries.length) {
      const n = picker.entries.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        picker.active = (picker.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        paintActive();
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.isComposing)) { e.preventDefault(); pick(picker.active); return; }
    }
    if (e.key === 'Escape' && picker) { e.preventDefault(); e.stopPropagation(); hidePicker(); return; }
    if (e.key === 'Escape' && !planList.hidden) { e.preventDefault(); e.stopPropagation(); planList.hidden = true; return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  });
  send.addEventListener('click', submit);
  stop.addEventListener('click', async () => { try { await api.chatInterrupt(info.id); } catch (e) { toast(e.message, true); } });

  Object.assign(view, {
    status: () => sessionStatus({ kind: 'chat', alive: !chat.ended, busy: chat.busy, pending: chat.pending, exit_code: chat.exitCode }),
    focus: () => { const card = thread.querySelector('.cv-perm button.cv-opt, .cv-perm button.primary'); (card || input).focus({ preventScroll: true }); },
    destroy: () => { source.close(); el.remove(); },
    attachItem,
    cwdLabel: () => shortPath(info.cwd, ''),
  });
  return view;
}

export const statusLabel = (status) => STATUSES[status]?.label || status;
export const statusTone = (status) => STATUSES[status]?.tone || 'muted';
