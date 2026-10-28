import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STATUSES, apply, build, currentModel, editDiff, emptyChat, kTokens, modelOptions, questionAnswers, sessionStatus, shortPath, subagentSummary,
  toolTarget } from '../../static/js/chat-model.js';

const assistant = (content, extra = {}) => ({ type: 'assistant', message: { content }, ...extra });
const delta = (text) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
const toolResult = (id, content, isError = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });
const permission = (id) => ({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'touch x' }, description: 'Create x' } });

describe('the chat model (chat-model.js)', () => {
  it('puts a subagent\'s messages under its call, never in the thread', () => {
    const sub = { parent_tool_use_id: 'a1' };
    const chat = build([
      assistant([{ type: 'tool_use', id: 'a1', name: 'Agent', input: { description: 'Count' } }]),
      { type: 'user', ...sub, message: { content: [{ type: 'text', text: 'the prompt it was given' }] } },
      { ...delta('sub partial'), ...sub },
      assistant([{ type: 'tool_use', id: 'g1', name: 'Glob', input: { pattern: '*.txt' } }], sub),
      assistant([{ type: 'tool_use', id: 'g2', name: 'TodoWrite', input: { todos: [{ status: 'pending' }] } }], sub),
      { ...toolResult('g1', 'a.txt'), ...sub },
      assistant([{ type: 'text', text: '2 files' }], sub),
      assistant([{ type: 'text', text: 'lost' }], { parent_tool_use_id: 'nobody' }),
      toolResult('a1', '2 files'),
    ]);
    assert.deepEqual(chat.items.map((i) => i.kind), ['tool']);
    const agent = chat.items[0];
    assert.deepEqual(agent.children.map((c) => [c.kind, c.name || c.text, c.done]), [['tool', 'Glob', true], ['tool', 'TodoWrite', false], ['text', '2 files', undefined]]);
    assert.equal(agent.done, true);
    assert.equal(chat.plan, null); // a subagent's plan is not the session's
    assert.deepEqual(subagentSummary(agent.children), { tools: 2, running: 'TodoWrite' });
    assert.deepEqual(subagentSummary([]), { tools: 0, running: '' });
  });

  it('gives a question and a plan their own form, and keeps what was answered', () => {
    const ask = (id, tool, input) => ({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: tool, input } });
    const chat = build([ask('q', 'AskUserQuestion', { questions: [{ question: 'Color?' }] }), ask('p', 'ExitPlanMode', { plan: '# Do it' }), permission('b')]);
    assert.deepEqual(chat.items.map((i) => i.form), ['question', 'plan', '']);
    assert.equal(chat.pending, 3);
    apply(chat, { type: 'tm_answer', request_id: 'q', behavior: 'allow', answers: { 'Color?': 'Red' } });
    apply(chat, { type: 'tm_answer', request_id: 'p', behavior: 'allow', mode: 'acceptEdits' });
    assert.deepEqual(chat.items[0].answers, { 'Color?': 'Red' });
    assert.equal(chat.items[1].mode, 'acceptEdits');
    assert.equal(chat.pending, 1);
    assert.equal(toolTarget('AskUserQuestion', { questions: [{ question: 'Color?' }] }), 'Color?');
    assert.equal(toolTarget('ExitPlanMode', { plan: '## Plan\n1. a' }), 'Plan');
  });

  it('answers each question with a label, several joined, or what was typed in Other', () => {
    const qs = [{ question: 'One?' }, { question: 'Many?', multiSelect: true }];
    assert.equal(questionAnswers(qs, [['A'], []], ['', '']), null); // the second has no answer yet
    assert.deepEqual(questionAnswers(qs, [['A'], ['X', 'Y']], ['', '']), { 'One?': 'A', 'Many?': 'X, Y' });
    assert.deepEqual(questionAnswers(qs, [['A'], ['X']], ['  mine ', '']), { 'One?': 'mine', 'Many?': 'X' });
    assert.deepEqual(questionAnswers([], [], []), {});
  });

  it('keeps thinking that has text, a compaction, the context window, and a message sent mid-turn', () => {
    const chat = build([
      { type: 'tm_user', text: 'go', images: [{ media_type: 'image/png', thumb: 'data:image/jpeg;base64,AA' }] },
      assistant([{ type: 'thinking', thinking: '' }, { type: 'thinking', thinking: 'Let me see' }, { type: 'text', text: 'ok' }]),
      { type: 'tm_user', text: 'and also' },
      { type: 'result', subtype: 'success' },
      { type: 'system', subtype: 'compact_boundary', compact_metadata: { pre_tokens: 53000, post_tokens: 24000 } },
      { type: 'tm_context', window: { used: 24000, max: 1000000, percent: 2 } },
      { type: 'tm_user', text: 'after' },
    ]);
    assert.deepEqual(chat.items.map((i) => i.kind), ['user', 'thinking', 'text', 'user', 'notice', 'user']);
    assert.equal(chat.items[0].images.length, 1);
    assert.deepEqual(chat.items.filter((i) => i.kind === 'user').map((i) => i.queued), [false, true, false]);
    assert.equal(chat.items[4].text, 'Conversation compacted (53k → 24k tokens)');
    assert.equal(chat.context, 24000);
    assert.deepEqual(chat.window, { used: 24000, max: 1000000, percent: 2 });
    assert.deepEqual([kTokens(0), kTokens(950), kTokens(53380), kTokens(1000000), kTokens(1250000)], ['', '950', '53k', '1M', '1.3M']);
  });

  it('streams text, then the full message replaces it', () => {
    const chat = build([{ type: 'tm_user', text: 'hi' }, delta('He'), delta('llo')]);
    assert.deepEqual(chat.items.map((i) => i.kind), ['user', 'text']);
    assert.equal(chat.items[1].text, 'Hello');
    assert.equal(chat.items[1].partial, true);
    assert.equal(chat.busy, true);
    apply(chat, assistant([{ type: 'text', text: 'Hello there' }]));
    assert.deepEqual(chat.items.map((i) => [i.kind, i.text, i.partial]), [['user', 'hi', undefined], ['text', 'Hello there', false]]);
  });

  it('pairs a tool call with its result, and keeps the plan of TodoWrite', () => {
    const chat = build([
      assistant([{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a/b.js' } }]),
      assistant([{ type: 'tool_use', id: 't2', name: 'TodoWrite', input: { todos: [{ status: 'completed' }, { status: 'pending' }] } }]),
      toolResult('t1', [{ type: 'text', text: 'line 1' }, { type: 'text', text: 'line 2' }]),
      toolResult('t9', 'for no call'),
    ]);
    const read = chat.items[0];
    assert.equal(read.result, 'line 1\nline 2');
    assert.equal(read.done, true);
    assert.equal(chat.items[1].done, false);
    assert.deepEqual({ done: chat.plan.done, total: chat.plan.total }, { done: 1, total: 2 });
  });

  it('counts a permission request until it is answered', () => {
    const chat = build([permission('p1'), permission('p2')]);
    assert.equal(chat.pending, 2);
    apply(chat, { type: 'tm_answer', request_id: 'p1', behavior: 'allow', always: true });
    apply(chat, { type: 'tm_answer', request_id: 'p1', behavior: 'deny' }); // answered once: ignored
    assert.equal(chat.pending, 1);
    assert.deepEqual([chat.items[0].answer, chat.items[0].always], ['allow', true]);
  });

  it('ends a turn on its result: cost, the context of the last request, and an error when it failed', () => {
    const chat = build([{ type: 'tm_user', text: 'x' },
      { type: 'assistant', message: { content: [], usage: { input_tokens: 2, cache_read_input_tokens: 100, output_tokens: 8 } } }, delta('par'),
      { type: 'result', subtype: 'success', total_cost_usd: 0.25, usage: { input_tokens: 4, cache_read_input_tokens: 500, output_tokens: 20 } }]);
    assert.equal(chat.busy, false);
    assert.equal(chat.cost, 0.25);
    assert.equal(chat.context, 110); // not the result's: that one adds up every request of the turn
    assert.deepEqual(chat.items.map((i) => i.kind), ['user']); // a partial with no full message after it is dropped
    apply(chat, { type: 'result', subtype: 'error_max_turns' });
    assert.equal(chat.items.at(-1).tone, 'error');
    apply(chat, { type: 'result', subtype: 'error_during_execution' }); // an interrupt: its own notice says so
    assert.equal(chat.items.length, 2);
  });

  it('follows the mode and the model, and an interrupt', () => {
    const chat = build([{ type: 'system', subtype: 'init', permissionMode: 'plan', model: 'claude-x' }, { type: 'tm_mode', mode: 'acceptEdits' },
      { type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
      { type: 'tm_answer', request_id: null, behavior: 'interrupted' }]);
    assert.deepEqual([chat.mode, chat.model], ['acceptEdits', 'claude-x']);
    assert.deepEqual(chat.items.map((i) => i.text), ['Interrupted', 'Interrupted']);
  });

  it('ends: open permission cards close, and an error code says why', () => {
    const chat = build([permission('p1'), { type: 'tm_exit', exit_code: 1, stderr: 'a\nb\nInvalid API key' }]);
    assert.equal(chat.ended, true);
    assert.equal(chat.pending, 0);
    assert.equal(chat.items[0].answer, 'interrupted');
    assert.match(chat.items[1].text, /code 1: .*Invalid API key/);
    assert.equal(build([{ type: 'tm_exit', exit_code: 0 }]).items[0].text, 'Session closed');
  });

  it('a resumed history does not count as working', () => {
    const chat = build([assistant([{ type: 'text', text: 'old' }], { history: true })]);
    assert.equal(chat.busy, false);
    assert.deepEqual(apply(emptyChat(), null).items, []);
  });
});

describe('a tool call on one line (toolTarget)', () => {
  it('names the file, the command, the pattern', () => {
    assert.equal(toolTarget('Read', { file_path: '/w/static/js/a.js' }, '/w'), 'static/js/a.js');
    assert.equal(toolTarget('Edit', { file_path: '/elsewhere/a.js' }, '/w'), '/elsewhere/a.js');
    assert.equal(toolTarget('Bash', { command: 'npm test\n&& echo' }), 'npm test');
    assert.equal(toolTarget('Grep', { pattern: 'TODO', path: '/w/tm' }, '/w'), 'TODO in tm');
    assert.equal(toolTarget('TodoWrite', { todos: [{ status: 'completed' }, { status: 'in_progress' }] }), '1/2');
    assert.equal(toolTarget('mcp__x__y', { n: 3, q: 'first\nsecond' }), 'first');
    assert.equal(shortPath('/w/', '/w'), '/w/');
  });
});

describe('what an edit changes (editDiff)', () => {
  it('keeps shared lines as context and counts the rest', () => {
    const d = editDiff('Edit', { old_string: 'a\nb\nc\nold\nz', new_string: 'a\nb\nc\nnew\nnewer\nz' });
    assert.deepEqual(d.lines, [
      { sign: ' ', text: 'b' }, { sign: ' ', text: 'c' },
      { sign: '-', text: 'old' }, { sign: '+', text: 'new' }, { sign: '+', text: 'newer' },
      { sign: ' ', text: 'z' },
    ]);
    assert.deepEqual([d.add, d.del], [2, 1]);
  });

  it('a Write is all new, several edits are separated, other tools have none', () => {
    assert.deepEqual(editDiff('Write', { content: 'x\ny' }).lines.map((l) => l.sign), ['+', '+']);
    const multi = editDiff('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] });
    assert.deepEqual(multi.lines.map((l) => l.sign + l.text), ['-a', '+b', ' …', '-c', '+d']);
    assert.equal(editDiff('Bash', { command: 'ls' }), null);
  });
});

describe('what a session shows in the dock\'s list (sessionStatus)', () => {
  it('a permission card waiting wins over working', () => {
    assert.equal(sessionStatus({ kind: 'chat', alive: true, busy: true, pending: 1 }), 'needs_you');
    assert.equal(sessionStatus({ kind: 'chat', alive: true, busy: false, pending: 2 }), 'needs_you');
  });

  it('a chat is working during a turn, and your turn after it', () => {
    assert.equal(sessionStatus({ kind: 'chat', alive: true, busy: true, pending: 0 }), 'working');
    assert.equal(sessionStatus({ kind: 'chat', alive: true, busy: false, pending: 0 }), 'idle');
  });

  it('a terminal only says whether it runs', () => {
    assert.equal(sessionStatus({ kind: 'term', alive: true, busy: true, pending: 3 }), 'terminal');
    assert.equal(sessionStatus({ kind: 'term', alive: false, exit_code: 0 }), 'ended');
  });

  it('an end with a code other than 0 is a failure; an unknown code is just ended', () => {
    assert.equal(sessionStatus({ kind: 'chat', alive: false, exit_code: 0 }), 'ended');
    assert.equal(sessionStatus({ kind: 'chat', alive: false, exit_code: null }), 'ended');
    assert.equal(sessionStatus({ kind: 'chat', alive: false, exit_code: 1, pending: 1 }), 'failed');
    assert.equal(sessionStatus({ kind: 'term', alive: false, exit_code: -15 }), 'failed'); // killed by a signal
    assert.equal(sessionStatus(undefined), 'ended');
  });

  it('every status it gives has its dot and words', () => {
    for (const s of ['needs_you', 'working', 'idle', 'terminal', 'failed', 'ended']) assert.ok(STATUSES[s]?.label && STATUSES[s]?.tone, s);
  });

  it('follows a chat through a turn', () => {
    const status = (chat) => sessionStatus({ kind: 'chat', alive: !chat.ended, busy: chat.busy, pending: chat.pending, exit_code: chat.exitCode });
    const chat = build([{ type: 'tm_user', text: 'go' }, delta('…')]);
    assert.equal(status(chat), 'working');
    apply(chat, permission('p1'));
    assert.equal(status(chat), 'needs_you');
    apply(chat, { type: 'tm_answer', request_id: 'p1', behavior: 'allow' });
    assert.equal(status(chat), 'working');
    apply(chat, { type: 'result', subtype: 'success' });
    assert.equal(status(chat), 'idle');
    apply(chat, { type: 'tm_exit', exit_code: 2 });
    assert.equal(status(chat), 'failed');
  });
});

describe('the model and effort menus', () => {
  const models = [
    { value: 'default', label: 'Default (recommended)', description: 'Fable 5.1', resolved: 'claude-fable-5-1', efforts: ['low', 'high'] },
    { value: 'fable', label: 'Fable 5.1', description: 'For your toughest challenges', resolved: 'claude-fable-5-1', efforts: ['low', 'high'] },
    { value: 'claude-haiku-4-5', label: 'Haiku 4.5', description: 'Fastest', resolved: 'claude-haiku-4-5', efforts: [] },
  ];
  it('names each model with its version, the default with the one it is', () => {
    assert.deepEqual(modelOptions(models), [['default', 'Default (Fable 5.1)'], ['fable', 'Fable 5.1'], ['claude-haiku-4-5', 'Haiku 4.5']]);
    assert.deepEqual(modelOptions([], ['opus']), [['opus', 'Opus']]); // before claude has listed them
  });

  it('finds the model a session runs by alias or full id, an alias before the default', () => {
    assert.equal(currentModel(models, 'claude-fable-5-1').value, 'fable');
    assert.equal(currentModel(models, 'default').value, 'default');
    assert.equal(currentModel(models, 'claude-haiku-4-5').efforts.length, 0);
    assert.equal(currentModel(models, 'gpt'), null);
  });

  it('follows the models, the effort and what a message carried', () => {
    const chat = build([{ type: 'tm_models', models }, { type: 'tm_effort', effort: 'low' },
      { type: 'tm_user', text: 'see', items: [{ id: 'TSK-1', title: 'One', type: 'task' }] }]);
    assert.equal(chat.models.length, 3);
    assert.equal(chat.effort, 'low');
    assert.deepEqual(chat.items[0].attached, [{ id: 'TSK-1', title: 'One', type: 'task' }]);
  });
});
