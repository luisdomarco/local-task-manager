// The dock's chat as data: the messages the server streams (tm/chat.py — claude's own stream-json, slimmed, plus our
// tm_* events) folded into what the view draws. No DOM here, so it is tested on its own (tests/js/chat-model.test.mjs).
//
// A chat is { items, pending, busy, ended, mode, model, effort, models, cost, context, window, plan }. Its items:
//   { kind: 'user', text, attached, images, queued }   a message the user sent, the vault items and images with it;
//                                                     `queued` when it went while Claude was still working
//   { kind: 'text', text, partial }             Claude's text; `partial` while it is still streaming
//   { kind: 'thinking', text }                  what Claude thought, when the model shows it (most send it empty)
//   { kind: 'tool', id, name, input, result, error, done, children }
//                                               children: what a subagent (Agent, Task) did — its own text and tools
//   { kind: 'permission', id, tool, input, description, form, answer, always, answers }   answer: null until answered;
//                                               form: 'question' (AskUserQuestion), 'plan' (ExitPlanMode) or ''
//   { kind: 'notice', text, tone }              interrupted, compacted, ended, an error
//   { kind: 'settings', model, effort }         the model or effort changed from the composer, once Claude took it
//   { kind: 'turn', model }                     the end of a turn: the model that answered it

export const emptyChat = () => ({
  items: [], pending: 0, busy: false, ended: false, exitCode: null, mode: 'default', model: '', effort: '', models: [],
  cost: 0, context: 0, window: null, plan: null, answeredBy: '',
});

const last = (chat) => chat.items[chat.items.length - 1];
const toolById = (items, id) => items.find((it) => it.kind === 'tool' && it.id === id);
// The tool calls whose permission card has a form of its own instead of Allow / Deny.
const FORMS = { AskUserQuestion: 'question', ExitPlanMode: 'plan' };
const textOf = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.map((p) => (p?.type === 'text' ? p.text : p?.type === 'image' ? '[image]' : '')).join('\n') : '');

function dropPartial(chat) {
  if (last(chat)?.kind === 'text' && last(chat).partial) chat.items.pop();
}

/** The plan Claude keeps with TodoWrite: { done, total, todos }. */
function planOf(input) {
  const todos = Array.isArray(input?.todos) ? input.todos : [];
  return { done: todos.filter((t) => t.status === 'completed').length, total: todos.length, todos };
}

/** An assistant message's blocks onto a list: the thread's, or a subagent's (`sub`: its plan is not the chat's). */
function addBlocks(chat, list, content, sub) {
  for (const block of content || []) {
    if (block.type === 'text' && block.text) list.push({ kind: 'text', text: block.text, partial: false });
    else if (block.type === 'thinking' && block.thinking) list.push({ kind: 'thinking', text: block.thinking });
    else if (block.type === 'tool_use') {
      list.push({ kind: 'tool', id: block.id, name: block.name, input: block.input || {}, result: null, error: false, done: false,
        children: [] });
      if (block.name === 'TodoWrite' && !sub) chat.plan = planOf(block.input);
    }
  }
}

/** One streamed message into the chat (changes it, and returns it). Unknown shapes are ignored. A message of a
 *  subagent (`parent_tool_use_id`: the Agent call that started it) goes under that call, never into the thread. */
export function apply(chat, msg) {
  if (!msg || typeof msg !== 'object') return chat;
  switch (msg.type) {
    case 'tm_user':
      chat.items.push({ kind: 'user', text: msg.text || '', attached: Array.isArray(msg.items) ? msg.items : [],
        images: Array.isArray(msg.images) ? msg.images : [], queued: chat.busy });
      break;
    case 'stream_event': {
      if (msg.parent_tool_use_id) break; // a subagent's text arrives whole, under its call
      const e = msg.event || {};
      if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        const tail = last(chat);
        if (tail?.kind === 'text' && tail.partial) tail.text += e.delta.text;
        else chat.items.push({ kind: 'text', text: e.delta.text, partial: true });
      }
      chat.busy = true;
      break;
    }
    case 'assistant': {
      if (msg.parent_tool_use_id) {
        const parent = toolById(chat.items, msg.parent_tool_use_id);
        if (parent) addBlocks(chat, parent.children, msg.message?.content, true);
        break;
      }
      dropPartial(chat); // the full message replaces what streamed of it
      // The context: what the last request to the model carried (a turn's `result` adds up every request of it).
      const u = msg.message?.usage;
      if (u) chat.context = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
      addBlocks(chat, chat.items, msg.message?.content, false);
      if (!msg.history) chat.busy = true;
      if (!msg.history && msg.message?.model && !msg.message.model.startsWith('<')) chat.answeredBy = msg.message.model; // not '<synthetic>'
      break;
    }
    case 'user': {
      const content = msg.message?.content;
      if (!Array.isArray(content)) break;
      const parent = msg.parent_tool_use_id ? toolById(chat.items, msg.parent_tool_use_id) : null;
      if (msg.parent_tool_use_id && !parent) break;
      for (const block of content) {
        if (block.type === 'tool_result') {
          const tool = toolById(parent ? parent.children : chat.items, block.tool_use_id);
          if (tool) Object.assign(tool, { result: textOf(block.content), error: Boolean(block.is_error), done: true });
        } else if (block.type === 'text' && !parent && String(block.text).startsWith('[Request interrupted')) {
          chat.items.push({ kind: 'notice', text: 'Interrupted', tone: 'muted' });
        }
      }
      break;
    }
    case 'control_request': {
      const r = msg.request || {};
      if (r.subtype !== 'can_use_tool') break;
      chat.items.push({ kind: 'permission', id: msg.request_id, tool: r.tool_name, input: r.input || {}, description: r.description || '',
        toolUseId: r.tool_use_id || null, form: FORMS[r.tool_name] || '', answer: null, always: false, answers: null });
      chat.pending += 1;
      break;
    }
    case 'tm_answer': {
      const p = chat.items.find((it) => it.kind === 'permission' && it.id === msg.request_id);
      if (p && !p.answer) {
        Object.assign(p, { answer: msg.behavior, always: Boolean(msg.always), answers: msg.answers || null, message: msg.message || '', mode: msg.mode || '' });
        chat.pending = Math.max(0, chat.pending - 1);
      }
      if (!msg.request_id && msg.behavior === 'interrupted') chat.items.push({ kind: 'notice', text: 'Interrupted', tone: 'muted' });
      break;
    }
    case 'result':
      dropPartial(chat);
      chat.busy = false;
      if (typeof msg.total_cost_usd === 'number') chat.cost = msg.total_cost_usd;
      if (msg.subtype && msg.subtype !== 'success' && msg.subtype !== 'error_during_execution') {
        chat.items.push({ kind: 'notice', text: `The turn ended with an error (${msg.subtype})`, tone: 'error' });
      }
      if (chat.answeredBy) chat.items.push({ kind: 'turn', model: chat.answeredBy });
      chat.answeredBy = '';
      break;
    case 'system':
      if (msg.subtype === 'init') {
        if (msg.permissionMode) chat.mode = msg.permissionMode;
        if (msg.model) chat.model = msg.model;
      } else if (msg.subtype === 'compact_boundary') {
        const m = msg.compact_metadata || {};
        const sizes = m.pre_tokens && m.post_tokens ? ` (${kTokens(m.pre_tokens)} → ${kTokens(m.post_tokens)} tokens)` : '';
        chat.items.push({ kind: 'notice', text: `Conversation compacted${sizes}`, tone: 'muted' });
        if (m.post_tokens) chat.context = m.post_tokens;
      }
      break;
    case 'tm_mode': chat.mode = msg.mode; break;
    case 'tm_model': chat.model = msg.model; break;
    case 'tm_effort': chat.effort = msg.effort; break;
    case 'tm_settings':
      chat.effort = msg.effort || '';
      chat.items.push({ kind: 'settings', model: msg.model || chat.model, effort: msg.effort || '' });
      break;
    case 'tm_notice': chat.items.push({ kind: 'notice', text: String(msg.text || ''), tone: msg.tone || 'muted' }); break;
    case 'tm_models': chat.models = Array.isArray(msg.models) ? msg.models : []; break;
    case 'tm_context': chat.window = msg.window || null; break;
    case 'tm_exit':
      dropPartial(chat);
      chat.ended = true;
      chat.busy = false;
      chat.pending = 0;
      chat.exitCode = msg.exit_code;
      for (const it of chat.items) if (it.kind === 'permission' && !it.answer) it.answer = 'interrupted';
      chat.items.push({ kind: 'notice', tone: msg.exit_code ? 'error' : 'muted',
        text: msg.exit_code ? `Claude ended with code ${msg.exit_code}${msg.stderr ? `: ${msg.stderr.split('\n').slice(-3).join(' ')}` : ''}` : 'Session closed' });
      break;
    default:
      break;
  }
  return chat;
}

export const build = (msgs) => msgs.reduce(apply, emptyChat());

/** Tokens as the composer shows them: 53k, 1.2M. */
export function kTokens(n) {
  if (!n) return '';
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/** What a subagent did, on its call's line: how many tools it ran, and what it is running now. */
export function subagentSummary(children = []) {
  const tools = children.filter((c) => c.kind === 'tool');
  const running = tools.findLast((t) => !t.done);
  return { tools: tools.length, running: running ? running.name : '' };
}

// ── the question and plan cards ──────────────────────────────────────────────
/**
 * The answers AskUserQuestion takes back (in `updatedInput.answers`): { question text: label }. `picks` holds, per
 * question, the labels chosen; `other` what was typed in its "Other" box, which wins when it is filled in. Several
 * labels (a multiSelect question) are joined with ", ". null while a question has no answer.
 */
export function questionAnswers(questions = [], picks = [], other = []) {
  const out = {};
  for (const [i, q] of questions.entries()) {
    const typed = String(other[i] || '').trim();
    const chosen = typed ? [typed] : (picks[i] || []).filter(Boolean);
    if (!chosen.length) return null;
    out[q.question] = chosen.join(', ');
  }
  return out;
}

// ── the composer's model and effort ──────────────────────────────────────────
const EFFORT_LABEL = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
export const effortLabel = (e) => EFFORT_LABEL[e] || e;

/** The entry of `models` (claude's list: { value, label, description, resolved, efforts }) a session runs, by alias
 *  or full id — an alias before `default`, which stands for one of them too. null when it is not on the list. */
export function currentModel(models, model) {
  const hits = (models || []).filter((m) => model && (m.value === model || m.resolved === model));
  return hits.find((m) => m.value !== 'default') || hits[0] || null;
}

/** A model's name with its version, for the chat's lines: from claude's list (by full id or alias) when it is on it,
 *  else read off the id ("claude-sonnet-5-5" → "Sonnet 5.5", a dated id too); anything else as it is. */
export function modelName(models, model) {
  const m = String(model || '');
  const listed = currentModel(models, m);
  if (listed && listed.value !== 'default') return listed.label;
  const id = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(m);
  return id ? `${id[1][0].toUpperCase()}${id[1].slice(1)} ${id[2]}${id[3] ? `.${id[3]}` : ''}` : m;
}

/** The model menu: [value, label] from claude's list, its version in the name ("Opus 5.5"; the default says which
 *  one it is). Before claude has listed them, the aliases the server knows, by name only. */
export function modelOptions(models, fallback = []) {
  if (!models?.length) return fallback.map((m) => [m, m[0].toUpperCase() + m.slice(1)]);
  return models.map((m) => [m.value, m.value === 'default' && m.description ? `Default (${m.description})` : m.label]);
}

// ── what a tool call shows on its one line ───────────────────────────────────
const firstLine = (s) => String(s || '').split('\n')[0];

/** A path shown relative to the session's folder when it is inside it. */
export function shortPath(path, cwd = '') {
  const p = String(path || '');
  const base = String(cwd || '').replace(/\/+$/, '');
  return (base && p.startsWith(`${base}/`) && p.slice(base.length + 1)) || p; // the folder itself stays as it is
}

/** The one thing a tool call is about: its file, command, pattern, address or description. */
export function toolTarget(name, input = {}, cwd = '') {
  switch (name) {
    case 'Read': case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit':
      return shortPath(input.file_path || input.notebook_path, cwd);
    case 'Bash': return firstLine(input.command);
    case 'Grep': return `${input.pattern || ''}${input.path ? ` in ${shortPath(input.path, cwd)}` : ''}`;
    case 'Glob': return input.pattern || '';
    case 'WebFetch': return input.url || '';
    case 'WebSearch': return input.query || '';
    case 'Task': case 'Agent': return input.description || '';
    case 'AskUserQuestion': return input.questions?.[0]?.question || '';
    case 'ExitPlanMode': return firstLine(String(input.plan || '').replace(/^#+\s*/, ''));
    case 'TodoWrite': { const p = planOf(input); return `${p.done}/${p.total}`; }
    default: {
      const s = Object.values(input).find((v) => typeof v === 'string');
      return firstLine(s);
    }
  }
}

/**
 * What an Edit or Write changes, as lines: { lines: [{ sign: ' ' | '-' | '+', text }], add, del }. Not a full diff:
 * the lines both sides share at the start and the end are kept as context (two at most), the rest is old then new.
 * null for a tool that changes no file.
 */
export function editDiff(name, input = {}) {
  let pairs;
  if (name === 'Edit') pairs = [[input.old_string, input.new_string]];
  else if (name === 'MultiEdit') pairs = (input.edits || []).map((e) => [e.old_string, e.new_string]);
  else if (name === 'Write') pairs = [['', input.content]];
  else return null;
  const out = { lines: [], add: 0, del: 0 };
  for (const [before, after] of pairs) {
    const a = before ? String(before).split('\n') : [];
    const b = after ? String(after).split('\n') : [];
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
    let tail = 0;
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
    if (out.lines.length) out.lines.push({ sign: ' ', text: '…' });
    for (const text of a.slice(Math.max(0, head - 2), head)) out.lines.push({ sign: ' ', text });
    for (const text of a.slice(head, a.length - tail)) { out.lines.push({ sign: '-', text }); out.del += 1; }
    for (const text of b.slice(head, b.length - tail)) { out.lines.push({ sign: '+', text }); out.add += 1; }
    for (const text of a.slice(a.length - tail, a.length - tail + 2)) out.lines.push({ sign: ' ', text });
  }
  return out;
}

// ── the sessions list ────────────────────────────────────────────────────────
// What each status looks like in the list: its dot (app.css .td-dot.tone-*) and its words.
export const STATUSES = {
  needs_you: { label: 'needs you', tone: 'warning' },
  working: { label: 'working', tone: 'accent' },
  idle: { label: 'your turn', tone: 'success' },
  terminal: { label: 'terminal', tone: 'muted' },
  failed: { label: 'ended with an error', tone: 'error' },
  ended: { label: 'ended', tone: 'muted' },
};

/**
 * The status of one session in the dock's list, from `{ kind: 'chat' | 'term', alive, busy, pending, exit_code }`
 * (a chat's live model, chat.js; a terminal's info, GET /api/term/list). One of the keys of STATUSES.
 *  - a permission card waiting wins over working: the turn cannot go on without you;
 *  - a terminal cannot be read, only whether it runs;
 *  - an end with a code other than 0 is a failure; an unknown code (null: the stream was lost) is just ended.
 */
export function sessionStatus(info) {
  if (!info) return 'ended';
  if (info.alive === false) return info.exit_code ? 'failed' : 'ended';
  if (info.kind === 'term') return 'terminal';
  if (info.pending > 0) return 'needs_you';
  return info.busy ? 'working' : 'idle';
}
