#!/usr/bin/env python3
"""A stand-in for `claude -p` in stream-json mode, for tests/test_chat.py and test_http.py: the shapes
tools/probe_chat_protocol.py recorded from the real CLI, scripted by what the user message says.

  any text      → init, a hook line (noise), a partial text delta, the full answer "echo: <text>", result
  "tool …"      → a Bash tool_use, then a can_use_tool request; waits for its control_response and answers
                  "ran" (allow) or the deny message, then result
  "slow …"      → starts a turn and waits for an interrupt control request, then an interrupted result
  "ask …"       → an AskUserQuestion (two options) asked with can_use_tool; answers "you chose <answer>"
  "plan …"      → an ExitPlanMode asked with can_use_tool; "approved" (allow) or "planning: <message>" (deny)
  "agent …"     → an Agent call whose subagent runs a Glob: its messages carry parent_tool_use_id; then "2 files"
  "/compact"    → a compact_boundary, then result
  with images   → "images: <n>" (content as blocks: its text, then the images)
`initialize` answers with four models (an alias and full ids, as the real one lists them: one takes no effort, one has
no Extra high, one is listed but refused by `set_model`, as a model the account cannot use is), `get_settings` with the
model and effort applied (--effort, then whatever `apply_flag_settings` set; with neither, `set_model` gives the new
model a default of its own, as the real one does), `get_context_usage` with a fixed 1%.
Every line it reads goes to $FAKE_CLAUDE_LOG (one JSON per line), and its argv as the first line."""
import json
import os
import sys

LOG = os.environ.get('FAKE_CLAUDE_LOG')
SID = 'fake'
for i, a in enumerate(sys.argv):
    if a in ('--session-id', '--resume') and i + 1 < len(sys.argv):
        SID = sys.argv[i + 1]


def log(obj):
    if LOG:
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(json.dumps(obj) + '\n')


def out(obj):
    sys.stdout.write(json.dumps(obj) + '\n')
    sys.stdout.flush()


def read():
    line = sys.stdin.readline()
    if not line:
        return None
    msg = json.loads(line)
    log(msg)
    return msg


def assistant(content):
    out({'type': 'assistant', 'session_id': SID, 'parent_tool_use_id': None,
         'message': {'id': 'msg_1', 'role': 'assistant', 'model': 'claude-fake', 'content': content}})


def ask(tool, tid, inp):
    """A tool that needs the user (can_use_tool), as the real one asks; → the response claude got back."""
    assistant([{'type': 'tool_use', 'id': tid, 'name': tool, 'input': inp}])
    out({'type': 'control_request', 'request_id': f'perm-{tid}', 'request': {
        'subtype': 'can_use_tool', 'tool_name': tool, 'display_name': tool, 'input': inp, 'tool_use_id': tid,
        'requires_user_interaction': True}})
    while True:
        ans = read()
        if ans is None:
            sys.exit(0)
        if ans.get('type') == 'control_response':
            return ans['response']['response']


def tool_result(tid, content, error=False, parent=None):
    out({'type': 'user', 'session_id': SID, 'parent_tool_use_id': parent, 'message': {'role': 'user', 'content': [
        {'type': 'tool_result', 'tool_use_id': tid, 'content': content, 'is_error': error}]}})


def result(subtype='success'):
    out({'type': 'result', 'subtype': subtype, 'session_id': SID, 'total_cost_usd': 0.01,
         'usage': {'input_tokens': 10, 'output_tokens': 5}})


log({'argv': sys.argv[1:]})
mode = sys.argv[sys.argv.index('--permission-mode') + 1] if '--permission-mode' in sys.argv else 'default'
effort = sys.argv[sys.argv.index('--effort') + 1] if '--effort' in sys.argv else 'high'
flagged = '--effort' in sys.argv  # an effort set: it holds across set_model
model = 'claude-opus-9-9'
MODELS = [
    {'value': 'opus', 'resolvedModel': 'claude-opus-9-9', 'displayName': 'Opus 9.9', 'description': 'For complex work',
     'supportsEffort': True, 'supportedEffortLevels': ['low', 'medium', 'high', 'xhigh', 'max']},
    {'value': 'claude-haiku-1-0', 'resolvedModel': 'claude-haiku-1-0', 'displayName': 'Haiku 1.0', 'description': 'Old',
     'supportsThinkingOff': True},
    {'value': 'claude-sonnet-8-1', 'resolvedModel': 'claude-sonnet-8-1', 'displayName': 'Sonnet 8.1', 'description': 'Everyday',
     'supportsEffort': True, 'supportedEffortLevels': ['low', 'medium', 'high', 'max']},
    {'value': 'claude-gone-0-1', 'resolvedModel': 'claude-gone-0-1', 'displayName': 'Gone 0.1', 'description': 'Not for this account',
     'supportsEffort': True, 'supportedEffortLevels': ['low', 'high']},
]
inited = False
while True:
    msg = read()
    if msg is None:
        break
    if msg.get('type') == 'control_request':
        req = msg['request']
        body = {}
        if req.get('subtype') == 'set_permission_mode':
            mode = req['mode']
        elif req.get('subtype') == 'initialize':
            body = {'models': MODELS, 'commands': []}
        elif req.get('subtype') == 'set_model':
            if req['model'] == 'claude-gone-0-1':
                out({'type': 'control_response', 'response': {'subtype': 'error', 'request_id': msg['request_id'],
                                                              'error': f"Model '{req['model']}' not found"}})
                continue
            model = next((m['resolvedModel'] for m in MODELS if m['value'] == req['model']), req['model'])
            body = {'model': model}
            if not flagged:
                effort = 'medium'
        elif req.get('subtype') == 'apply_flag_settings':
            effort = req['settings'].get('effortLevel', effort)
            flagged = True
        elif req.get('subtype') == 'get_settings':
            body = {'effective': {}, 'applied': {'model': model, 'effort': effort}}
        elif req.get('subtype') == 'get_context_usage':
            body = {'totalTokens': 2000, 'maxTokens': 200000, 'percentage': 1, 'categories': []}
        out({'type': 'control_response', 'response': {'subtype': 'success', 'request_id': msg['request_id'], 'response': body}})
        continue
    if msg.get('type') != 'user':
        continue
    content = msg['message']['content']
    images = 0
    if isinstance(content, list):
        images = sum(1 for b in content if b.get('type') == 'image')
        text = '\n'.join(b['text'] for b in content if b.get('type') == 'text')
    else:
        text = content
    if not inited:
        out({'type': 'system', 'subtype': 'init', 'session_id': SID, 'cwd': os.getcwd(), 'model': 'claude-fake',
             'permissionMode': mode, 'tools': ['Bash'] * 50, 'slash_commands': ['review']})
        inited = True
    out({'type': 'system', 'subtype': 'hook_started', 'hook_name': 'noise'})
    out({'type': 'rate_limit_event', 'rate_limit_info': {}})
    if images:
        assistant([{'type': 'text', 'text': f'images: {images}'}])
        result()
    elif text.startswith('ask'):
        q = {'question': 'Which color?', 'header': 'Color', 'multiSelect': False,
             'options': [{'label': 'Red', 'description': 'warm'}, {'label': 'Blue', 'description': 'cold'}]}
        r = ask('AskUserQuestion', 'toolu_q', {'questions': [q]})
        if r.get('behavior') == 'allow':
            chosen = r['updatedInput']['answers']['Which color?']
            tool_result('toolu_q', f'Your questions have been answered: "Which color?"="{chosen}".')
            assistant([{'type': 'text', 'text': f'you chose {chosen}'}])
        else:
            tool_result('toolu_q', r.get('message'), error=True)
            assistant([{'type': 'text', 'text': 'no answer'}])
        result()
    elif text.startswith('plan'):
        r = ask('ExitPlanMode', 'toolu_p', {'plan': '# Plan\n1. write c.txt', 'planFilePath': '/tmp/plan.md'})
        if r.get('behavior') == 'allow':
            tool_result('toolu_p', 'User has approved your plan.')
            assistant([{'type': 'text', 'text': 'approved'}])
        else:
            tool_result('toolu_p', r.get('message'), error=True)
            assistant([{'type': 'text', 'text': f"planning: {r.get('message')}"}])
        result()
    elif text.startswith('agent'):
        assistant([{'type': 'tool_use', 'id': 'toolu_a', 'name': 'Agent', 'input': {'description': 'Count files', 'prompt': 'count'}}])
        sub = {'session_id': SID, 'parent_tool_use_id': 'toolu_a', 'agent_id': 'a1'}
        out({'type': 'user', **sub, 'message': {'role': 'user', 'content': [{'type': 'text', 'text': 'count'}]}})
        out({'type': 'stream_event', **sub, 'event': {'type': 'content_block_delta', 'index': 0,
                                                      'delta': {'type': 'text_delta', 'text': 'sub partial'}}})
        out({'type': 'assistant', **sub, 'message': {'id': 'msg_s', 'role': 'assistant', 'model': 'claude-fake', 'content': [
            {'type': 'tool_use', 'id': 'toolu_g', 'name': 'Glob', 'input': {'pattern': '*.txt'}}]}})
        tool_result('toolu_g', 'a.txt\nb.txt', parent='toolu_a')
        out({'type': 'assistant', **sub, 'message': {'id': 'msg_s2', 'role': 'assistant', 'model': 'claude-fake', 'content': [
            {'type': 'text', 'text': '2 files'}]}})
        tool_result('toolu_a', [{'type': 'text', 'text': '2 files'}])
        assistant([{'type': 'text', 'text': 'There are 2.'}])
        result()
    elif text.startswith('/compact'):
        out({'type': 'system', 'subtype': 'compact_boundary', 'session_id': SID,
             'compact_metadata': {'trigger': 'manual', 'pre_tokens': 53000, 'post_tokens': 24000}})
        result()
    elif text.startswith('tool'):
        tid = 'toolu_1'
        assistant([{'type': 'tool_use', 'id': tid, 'name': 'Bash', 'input': {'command': 'touch x.txt'}}])
        out({'type': 'control_request', 'request_id': 'perm-1', 'request': {
            'subtype': 'can_use_tool', 'tool_name': 'Bash', 'input': {'command': 'touch x.txt'}, 'tool_use_id': tid,
            'description': 'Create x.txt', 'permission_suggestions': [
                {'type': 'addRules', 'rules': [{'toolName': 'Bash', 'ruleContent': 'touch x.txt'}],
                 'behavior': 'allow', 'destination': 'localSettings'},
                {'type': 'setMode', 'mode': 'acceptEdits', 'destination': 'session'}]}})
        while True:
            ans = read()
            if ans is None:
                sys.exit(0)
            if ans.get('type') == 'control_response':
                break
        r = ans['response']['response']
        allowed = r.get('behavior') == 'allow'
        out({'type': 'user', 'session_id': SID, 'parent_tool_use_id': None, 'message': {'role': 'user', 'content': [
            {'type': 'tool_result', 'tool_use_id': tid, 'content': 'ran' if allowed else r.get('message'), 'is_error': not allowed}]}})
        assistant([{'type': 'text', 'text': 'done' if allowed else 'not run'}])
        result()
    elif text.startswith('slow'):
        out({'type': 'stream_event', 'event': {'type': 'content_block_delta', 'index': 0,
                                               'delta': {'type': 'text_delta', 'text': 'Counting'}}})
        while True:
            ans = read()
            if ans is None:
                sys.exit(0)
            if ans.get('type') == 'control_request' and ans['request'].get('subtype') == 'interrupt':
                out({'type': 'control_response', 'response': {'subtype': 'success', 'request_id': ans['request_id'], 'response': {}}})
                break
        out({'type': 'user', 'session_id': SID, 'message': {'role': 'user', 'content': [
            {'type': 'text', 'text': '[Request interrupted by user]'}]}})
        result('error_during_execution')
    elif text.startswith('long'):
        out({'type': 'user', 'session_id': SID, 'message': {'role': 'user', 'content': [
            {'type': 'tool_result', 'tool_use_id': 't', 'content': 'x' * 50000}]}})
        result()
    else:
        out({'type': 'stream_event', 'event': {'type': 'content_block_delta', 'index': 0,
                                               'delta': {'type': 'text_delta', 'text': 'echo'}}})
        assistant([{'type': 'text', 'text': f'echo: {text}'}])
        result()
