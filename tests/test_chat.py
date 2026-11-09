"""The dock's chat: claude -p in stream-json (a scripted stand-in, tests/fixtures/fake_claude.py), its messages kept
and fanned out, permission requests answered, interrupt, modes, the end; and a transcript read back as history."""
import base64
import json
import os
import queue
import shutil
import sys
import tempfile
import time
import unittest
from unittest import mock

from tm import chat as tchat
from tm.store import StoreError
from tm.transcript import history

FAKE = [sys.executable, os.path.join(os.path.dirname(__file__), 'fixtures', 'fake_claude.py')]


def until(q, pred, timeout=10):
    """Messages from the queue up to the first that matches `pred` (included); fails if it does not come."""
    got, deadline = [], time.time() + timeout
    while time.time() < deadline:
        try:
            msg = q.get(timeout=0.2)
        except queue.Empty:
            continue
        if msg is None:
            break
        got.append(msg)
        if pred(msg):
            return got
    raise AssertionError(f'not found within {timeout}s; got {[m.get("type") for m in got]}')


def until_all(q, *preds, timeout=10):
    """Messages from the queue until each of `preds` has matched one, whatever their order. (Our own events come before
    claude's reply to them — test_our_own_event_comes_before_claudes_reply checks that — but the other tests do not
    lean on it.)"""
    got, left, deadline = [], list(preds), time.time() + timeout
    while left and time.time() < deadline:
        try:
            msg = q.get(timeout=0.2)
        except queue.Empty:
            continue
        if msg is None:
            break
        got.append(msg)
        left = [p for p in left if not p(msg)]
    if left:
        raise AssertionError(f'not all found within {timeout}s; got {[m.get("type") for m in got]}')
    return got


def is_result(m):
    return m.get('type') == 'result'


def is_answer(m):
    return m.get('type') == 'tm_answer'


def first(got, type_):
    """The first message of a type."""
    return next(m for m in got if m.get('type') == type_)


def last_text(got):
    """The text of claude's last answer."""
    return [m for m in got if m.get('type') == 'assistant'][-1]['message']['content'][0]['text']


PNG = base64.b64encode(b'\x89PNG\r\n\x1a\n' + b'\0' * 40).decode()


class ChatTest(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.mkdtemp(prefix='tm chat ')
        self.addCleanup(shutil.rmtree, self.work, True)
        self.log = os.path.join(self.work, 'stdin.ndjson')
        self.env = {**os.environ, 'FAKE_CLAUDE_LOG': self.log}
        self.chats = tchat.Chats()
        self.addCleanup(self.chats.close_all)

    def open(self, cid='c1', prompt=None, mode='default', history=()):
        argv = [*FAKE, *tchat.chat_flags(mode), '--session-id', cid]
        return self.chats.open(cid, argv, self.work, self.env, 'demo', 'TSK-1', mode, '', prompt, history)

    def sent(self):
        """What the chat wrote to claude's stdin (after the argv line)."""
        with open(self.log, encoding='utf-8') as f:
            return [json.loads(line) for line in f][1:]

    def requests_until(self, *want, timeout=10):
        """The control requests sent to claude, once every one in `want` is among them. What we write reaches the
        stand-in's log when it reads it, a moment later; wait for those requests, not for a count, since claude is also
        asked things of its own at the start (initialize, settings, context usage)."""
        deadline = time.time() + timeout
        while True:
            reqs = [m['request'] for m in self.sent() if m.get('type') == 'control_request']
            if all(w in reqs for w in want) or time.time() > deadline:
                return reqs
            time.sleep(0.02)

    def answered(self):
        """The last answer to a permission request the chat sent to claude."""
        return [m for m in self.sent() if m.get('type') == 'control_response'][-1]['response']['response']

    def test_a_turn_keeps_the_conversation_and_drops_the_noise(self):
        chat = self.open(prompt='hello')
        _, q = chat.subscribe()
        got = until(q, is_result)
        types = [m['type'] for m in got]
        self.assertNotIn('rate_limit_event', types)  # noise, dropped
        self.assertFalse(any(m.get('subtype') == 'hook_started' for m in got))
        self.assertIn('stream_event', types)  # partial text: passed on live…
        snapshot, _ = chat.subscribe()
        self.assertNotIn('stream_event', [m['type'] for m in snapshot])  # …never kept
        self.assertEqual(snapshot[0], {'type': 'tm_user', 'text': 'hello'})  # our own message, first
        init = next(m for m in snapshot if m.get('subtype') == 'init')
        self.assertNotIn('tools', init)  # slimmed
        self.assertEqual(init['permissionMode'], 'default')
        self.assertEqual(snapshot[-2]['message']['content'][0]['text'], 'echo: hello')
        self.assertFalse(chat.info()['busy'])
        first = self.sent()[0]
        self.assertEqual((first['type'], first['request']['subtype']), ('control_request', 'initialize'))
        self.assertEqual(self.sent()[1]['message'], {'role': 'user', 'content': 'hello'})

    def test_allow_always_adds_claudes_rules_to_this_session_only(self):
        chat = self.open(prompt='tool please')
        _, q = chat.subscribe()
        req = until(q, lambda m: m.get('type') == 'control_request')[-1]
        self.assertEqual(chat.info()['pending'], 1)
        chat.answer(req['request_id'], 'allow', always=True)
        got = until_all(q, is_result, is_answer)
        self.assertEqual(first(got, 'tm_answer'), {'type': 'tm_answer', 'request_id': 'perm-1', 'behavior': 'allow', 'always': True})
        self.assertEqual(first(got, 'user')['message']['content'][0]['content'], 'ran')
        response = self.answered()
        self.assertEqual(response['updatedInput'], {'command': 'touch x.txt'})
        self.assertEqual(response['updatedPermissions'], [{'type': 'addRules', 'rules': [{'toolName': 'Bash', 'ruleContent': 'touch x.txt'}],
                                                           'behavior': 'allow', 'destination': 'session'}])  # not localSettings
        self.assertEqual(chat.info()['pending'], 0)
        with self.assertRaises(StoreError) as cm:  # answered once
            chat.answer('perm-1', 'allow')
        self.assertEqual(cm.exception.status, 409)

    def test_our_own_event_comes_before_claudes_reply(self):
        """claude may answer before our write to it has returned, and its reply is read meanwhile: here the window is
        widened (a pause after each line of ours, in which the stand-in answers). Our tm_user still comes before the turn
        it starts and our tm_answer before the tool runs, in what is kept and in what is passed on live."""
        write = tchat.Chat._write

        def slow(chat, obj):
            write(chat, obj)
            if obj.get('type') in ('user', 'control_response'):
                time.sleep(0.4)

        with mock.patch.object(tchat.Chat, '_write', slow):
            chat = self.open()
            _, q = chat.subscribe()
            chat.send('tool please')
            live = until(q, lambda m: m.get('type') == 'control_request')
            chat.answer(live[-1]['request_id'], 'allow')
            live += until_all(q, is_result, is_answer)
        snapshot, _ = chat.subscribe()
        for got in (snapshot, live):
            types = [m['type'] for m in got]
            self.assertLess(types.index('tm_user'), types.index('system'), types)  # before the turn's init
            self.assertLess(types.index('tm_user'), types.index('control_request'), types)
            self.assertLess(types.index('tm_answer'), types.index('user'), types)  # before the tool's result
        self.assertEqual(snapshot[0]['type'], 'tm_user')

    def test_an_answer_that_cannot_be_written_changes_nothing(self):
        chat = self.open(prompt='tool please')
        _, q = chat.subscribe()
        req = until(q, lambda m: m.get('type') == 'control_request')[-1]
        with mock.patch.object(tchat.Chat, '_write', side_effect=StoreError(409, 'this chat is not taking input')):
            with self.assertRaises(StoreError):
                chat.answer(req['request_id'], 'allow')
            with self.assertRaises(StoreError):
                chat.send('again')
        self.assertEqual(chat.info()['pending'], 1)  # still to answer
        self.assertTrue(chat.info()['busy'])  # the first turn's, still running
        snapshot, _ = chat.subscribe()
        self.assertNotIn('tm_answer', [m['type'] for m in snapshot])
        self.assertEqual([m for m in snapshot if m['type'] == 'tm_user'], [{'type': 'tm_user', 'text': 'tool please'}])
        chat.answer(req['request_id'], 'allow')  # and it can be answered once the write goes through
        until_all(q, is_result, is_answer)

    def test_deny_sends_the_reason(self):
        chat = self.open(prompt='tool please')
        _, q = chat.subscribe()
        req = until(q, lambda m: m.get('type') == 'control_request')[-1]
        with self.assertRaises(StoreError):
            chat.answer(req['request_id'], 'maybe')
        chat.answer(req['request_id'], 'deny', message='not now')
        got = until_all(q, is_result, is_answer)
        self.assertEqual(first(got, 'user')['message']['content'][0],{'type': 'tool_result', 'tool_use_id': 'toolu_1', 'content': 'not now', 'is_error': True})
        self.assertEqual(self.answered(), {'behavior': 'deny', 'message': 'not now'})

    def test_interrupt_ends_the_turn(self):
        chat = self.open(prompt='slow count')
        _, q = chat.subscribe()
        until(q, lambda m: m.get('type') == 'stream_event')
        self.assertTrue(chat.info()['busy'])
        chat.interrupt()
        got = until(q, is_result)
        self.assertEqual(got[-1]['subtype'], 'error_during_execution')
        self.assertFalse(chat.info()['busy'])

    def test_an_interrupt_marks_its_requests_before_claude_ends_the_turn(self):
        """As test_our_own_event_comes_before_claudes_reply, for an interrupt with a permission card open: the card is
        marked interrupted before claude's interrupted result, kept and live; and it is no longer pending."""
        write = tchat.Chat._write

        def slow(chat, obj):
            write(chat, obj)
            if (obj.get('request') or {}).get('subtype') == 'interrupt':
                time.sleep(0.4)

        chat = self.open(prompt='tool please')
        _, q = chat.subscribe()
        live = until(q, lambda m: m.get('type') == 'control_request')
        with mock.patch.object(tchat.Chat, '_write', slow):
            chat.interrupt()
            live += until_all(q, is_result, is_answer)
        snapshot, _ = chat.subscribe()
        for got in (snapshot, live):
            types = [m['type'] for m in got]
            self.assertLess(types.index('tm_answer'), types.index('result'), types)
        self.assertEqual(first(snapshot, 'tm_answer'), {'type': 'tm_answer', 'request_id': 'perm-1', 'behavior': 'interrupted'})
        self.assertEqual(first(snapshot, 'result')['subtype'], 'error_during_execution')
        self.assertEqual(chat.info()['pending'], 0)

    def test_mode_and_model_are_control_requests(self):
        chat = self.open(prompt='hi', mode='plan')
        _, q = chat.subscribe()
        until(q, is_result)
        self.assertEqual(chat.info()['mode'], 'plan')
        chat.set_mode('acceptEdits')
        chat.set_model('opus')
        until(q, lambda m: m.get('type') == 'tm_model')
        self.assertEqual((chat.info()['mode'], chat.info()['model']), ('acceptEdits', 'opus'))
        with self.assertRaises(StoreError):
            chat.set_mode('bypassPermissions')  # not on the list
        with self.assertRaises(StoreError):
            chat.set_model('sonnet')  # not among the models this claude listed
        mode, model = {'subtype': 'set_permission_mode', 'mode': 'acceptEdits'}, {'subtype': 'set_model', 'model': 'opus'}
        reqs = self.requests_until(mode, model)
        self.assertIn(mode, reqs)
        self.assertIn(model, reqs)

    def test_the_models_claude_lists_and_the_effort_it_applies(self):
        chat = self.open(prompt='hi')
        _, q = chat.subscribe()
        until(q, lambda m: m.get('type') == 'tm_effort')  # asked once claude has answered initialize
        info = chat.info()
        self.assertEqual([(m['value'], m['label']) for m in info['models']][:3],
                         [('opus', 'Opus 9.9'), ('claude-haiku-1-0', 'Haiku 1.0'), ('claude-sonnet-8-1', 'Sonnet 8.1')])
        self.assertEqual(info['models'][0]['efforts'], ['low', 'medium', 'high', 'xhigh', 'max'])
        self.assertEqual(info['models'][1]['efforts'], [])  # it takes none
        self.assertEqual(info['effort'], 'high')
        chat.set_model('opus')
        chat.set_effort('low')
        self.assertEqual(chat.info()['effort'], 'low')
        with self.assertRaises(StoreError):
            chat.set_effort('turbo')
        chat.set_model('claude-haiku-1-0')
        with self.assertRaises(StoreError):
            chat.set_effort('low')  # Haiku 1.0 takes no effort level
        effort = {'subtype': 'apply_flag_settings', 'settings': {'effortLevel': 'low'}}
        self.assertIn(effort, self.requests_until(effort))  # in memory, no settings file

    def test_the_effort_holds_across_a_change_of_model(self):
        chat = self.open(prompt='hi')
        settled = []
        chat.on_settings = lambda model, effort: settled.append((model, effort))
        _, q = chat.subscribe()
        until(q, lambda m: m.get('type') == 'tm_effort')
        self.assertEqual(chat.info()['effort'], 'high')  # what claude applies when none was set
        # Without our effort, claude would give Sonnet its own default (medium): the session's High goes on with it.
        chat.set_model('claude-sonnet-8-1')
        got = until(q, lambda m: m.get('type') == 'tm_settings')[-1]
        self.assertEqual(got, {'type': 'tm_settings', 'model': 'claude-sonnet-8-1', 'effort': 'high'})
        self.assertEqual(settled[-1], ('claude-sonnet-8-1', 'high'))
        # Extra high on Opus, then a model without it: the nearest below.
        chat.set_model('opus')
        until(q, lambda m: m.get('type') == 'tm_settings')
        chat.set_effort('xhigh')
        self.assertEqual(until(q, lambda m: m.get('type') == 'tm_settings')[-1]['effort'], 'xhigh')
        chat.set_model('claude-sonnet-8-1')
        self.assertEqual(until(q, lambda m: m.get('type') == 'tm_settings')[-1]['effort'], 'high')
        self.assertEqual(chat.info()['effort'], 'high')
        # A model that takes none: no effort shown, none recorded.
        chat.set_model('claude-haiku-1-0')
        self.assertEqual(until(q, lambda m: m.get('type') == 'tm_settings')[-1]['effort'], '')
        self.assertEqual((chat.info()['effort'], settled[-1]), ('', ('claude-haiku-1-0', '')))
        # The change is in the conversation a reload gets back.
        kept, _ = chat.subscribe()
        self.assertEqual(len([m for m in kept if m.get('type') == 'tm_settings']), 5)

    def test_a_model_claude_refuses_is_undone_and_said(self):
        chat = self.open(prompt='hi')
        settled = []
        chat.on_settings = lambda model, effort: settled.append((model, effort))
        _, q = chat.subscribe()
        until(q, lambda m: m.get('type') == 'tm_effort')
        chat.set_model('opus')
        until(q, lambda m: m.get('type') == 'tm_settings')
        chat.set_model('claude-gone-0-1')  # listed, but this account cannot use it
        got = until(q, lambda m: m.get('type') == 'tm_notice')
        self.assertEqual([m['model'] for m in got if m.get('type') == 'tm_model'], ['claude-gone-0-1', 'opus'])
        self.assertEqual(got[-1], {'type': 'tm_notice', 'tone': 'error', 'text': "Claude did not switch models: Model 'claude-gone-0-1' not found"})
        self.assertEqual(chat.info()['model'], 'opus')
        self.assertEqual(settled, [('opus', 'high')])  # nothing recorded for the refused one

    def test_claudes_answer_to_a_change_finds_the_change_made(self):
        """claude may answer a set_model or an apply_flag_settings before our write of it has returned, and the reader
        acts on that answer at once (seen on CI under load): here the window is widened, a pause after each such line
        of ours, in which the stand-in answers. The answer still finds the new model — the session's effort goes on
        with it, not claude's default for the model — a refused one still ends on the model it had, and our own events
        come before what claude's answer leads to."""
        write = tchat.Chat._write

        def slow(chat, obj):
            write(chat, obj)
            if (obj.get('request') or {}).get('subtype') in ('set_model', 'apply_flag_settings'):
                time.sleep(0.4)

        chat = self.open(prompt='hi')
        settled = []
        chat.on_settings = lambda model, effort: settled.append((model, effort))
        _, q = chat.subscribe()
        until(q, lambda m: m.get('type') == 'tm_effort')
        with mock.patch.object(tchat.Chat, '_write', slow):
            chat.set_model('claude-sonnet-8-1')
            got = until(q, lambda m: m.get('type') == 'tm_settings')
            self.assertEqual(got[-1], {'type': 'tm_settings', 'model': 'claude-sonnet-8-1', 'effort': 'high'})
            types = [m['type'] for m in got]
            self.assertLess(types.index('tm_model'), types.index('tm_settings'), types)
            chat.set_effort('max')
            got = until(q, lambda m: m.get('type') == 'tm_settings')
            self.assertEqual([m['effort'] for m in got if m['type'] == 'tm_effort'], ['max', 'max'])  # ours, then claude's
            chat.set_model('claude-gone-0-1')  # refused: back to the one it had
            got = until(q, lambda m: m.get('type') == 'tm_notice')
            self.assertEqual([m['model'] for m in got if m.get('type') == 'tm_model'], ['claude-gone-0-1', 'claude-sonnet-8-1'])
        self.assertEqual((chat.info()['model'], chat.info()['effort']), ('claude-sonnet-8-1', 'max'))
        self.assertEqual(settled, [('claude-sonnet-8-1', 'high'), ('claude-sonnet-8-1', 'max')])

    def test_effort_for_a_model(self):
        self.assertEqual(tchat.effort_for('xhigh', ['low', 'medium', 'high', 'max']), 'high')
        self.assertEqual(tchat.effort_for('low', ['medium', 'high']), 'medium')  # none below: its lowest
        self.assertEqual(tchat.effort_for('max', ['low', 'max']), 'max')
        self.assertEqual(tchat.effort_for('high', []), '')  # it takes none
        self.assertEqual(tchat.effort_for('', ['low', 'high']), '')  # none set: claude's default for the model

    def test_attached_items_go_to_claude_and_show_as_chips(self):
        chat = self.open()
        _, q = chat.subscribe()
        chat.send('look at these', [{'id': 'TSK-9', 'title': 'Fix "it"', 'type': 'task', 'context': '# TSK-9 · Fix\n- Status: Open'}])
        got = until(q, lambda m: m.get('type') == 'tm_user')
        self.assertEqual(got[-1], {'type': 'tm_user', 'text': 'look at these', 'items': [{'id': 'TSK-9', 'title': 'Fix "it"', 'type': 'task'}]})
        until(q, is_result)
        content = [m for m in self.sent() if m.get('type') == 'user'][-1]['message']['content']
        self.assertTrue(content.startswith('look at these\n\n<attached-items>'))
        self.assertIn('<item ref="TSK-9 · Fix \'it\'">\n# TSK-9 · Fix\n- Status: Open\n</item>', content)
        self.assertEqual(tchat.split_items(content), ('look at these', [{'id': 'TSK-9', 'title': "Fix 'it'", 'type': ''}]))
        chat.send('', [{'id': 'TSK-1', 'title': 'Only', 'type': 'task', 'context': 'x'}])  # items alone are a message
        with self.assertRaises(StoreError):
            chat.send('  ', [])

    def test_a_question_is_answered_with_one_answer_per_question(self):
        chat = self.open(prompt='ask me')
        _, q = chat.subscribe()
        req = until(q, lambda m: m.get('type') == 'control_request')[-1]
        self.assertEqual(req['request']['tool_name'], 'AskUserQuestion')
        rid = req['request_id']
        for bad in (None, {}, {'Which color?': '  '}, {'Which color?': 'Red', 'Other?': 'x'}, {'Which color?': 'x' * 5000}):
            with self.assertRaises(StoreError, msg=bad):
                chat.answer(rid, 'allow', answers=bad)
        chat.answer(rid, 'allow', answers={'Which color?': ' Blue '})
        got = until_all(q, is_result, is_answer)
        self.assertEqual(first(got, 'tm_answer'), {'type': 'tm_answer', 'request_id': rid, 'behavior': 'allow', 'always': False,
                                  'answers': {'Which color?': 'Blue'}})
        response = self.answered()
        self.assertEqual(response['updatedInput']['answers'], {'Which color?': 'Blue'})
        self.assertEqual(len(response['updatedInput']['questions']), 1)  # the input as it was, plus the answers
        self.assertEqual(last_text(got), 'you chose Blue')

    def test_a_plan_approved_goes_on_in_the_mode_chosen_or_asks_before_edits(self):
        chat = self.open(prompt='plan it', mode='plan')
        _, q = chat.subscribe()
        req = until(q, lambda m: m.get('type') == 'control_request')[-1]
        self.assertEqual(req['request']['tool_name'], 'ExitPlanMode')
        with self.assertRaises(StoreError):
            chat.answer(req['request_id'], 'allow', mode='plan')  # not back into plan
        chat.answer(req['request_id'], 'allow', mode='acceptEdits')
        got = until_all(q, is_result, is_answer)
        self.assertEqual(got[0], {'type': 'tm_mode', 'mode': 'acceptEdits'})  # put before the line to claude: first
        self.assertEqual(first(got, 'tm_answer')['mode'], 'acceptEdits')
        self.assertEqual(self.answered()['updatedPermissions'],
                         [{'type': 'setMode', 'mode': 'acceptEdits', 'destination': 'session'}])
        self.assertEqual(chat.info()['mode'], 'acceptEdits')
        chat.set_mode('auto')
        chat.set_mode('plan')
        chat.send('plan again')
        req = until(q, lambda m: m.get('type') == 'control_request')[-1]
        chat.answer(req['request_id'], 'allow')  # no mode named: Ask before edits, not the auto it had before
        until(q, is_result)
        self.assertEqual(chat.info()['mode'], 'default')
        self.assertEqual(self.answered()['updatedPermissions'][0]['mode'], 'default')

    def test_a_plan_denied_keeps_claude_planning_with_the_message(self):
        chat = self.open(prompt='plan it', mode='plan')
        _, q = chat.subscribe()
        req = until(q, lambda m: m.get('type') == 'control_request')[-1]
        chat.answer(req['request_id'], 'deny', message='use b.txt')
        got = until_all(q, is_result, is_answer)
        self.assertEqual(first(got, 'tm_answer')['message'], 'use b.txt')
        self.assertEqual(last_text(got), 'planning: use b.txt')
        self.assertEqual(chat.info()['mode'], 'plan')

    def test_a_subagent_keeps_its_parent_and_its_partial_text_is_dropped(self):
        chat = self.open(prompt='agent go')
        _, q = chat.subscribe()
        got = until(q, is_result)
        subs = [m for m in got if m.get('parent_tool_use_id') == 'toolu_a']
        self.assertEqual([m['type'] for m in subs], ['user', 'assistant', 'user', 'assistant'])
        self.assertFalse(any(m['type'] == 'stream_event' and m.get('parent_tool_use_id') for m in got))

    def test_images_go_as_blocks_and_only_their_thumbnail_is_kept(self):
        chat = self.open()
        _, q = chat.subscribe()
        thumb = 'data:image/jpeg;base64,AAAA'
        chat.send('what is this', images=[{'data': PNG, 'thumb': thumb}, {'data': PNG, 'thumb': 'javascript:x'}])
        got = until_all(q, is_result, lambda m: m.get('type') == 'tm_user')
        self.assertEqual(first(got, 'tm_user'), {'type': 'tm_user', 'text': 'what is this',
                                                 'images': [{'media_type': 'image/png', 'thumb': thumb}, {'media_type': 'image/png'}]})
        self.assertEqual(last_text(got), 'images: 2')
        content = [m for m in self.sent() if m.get('type') == 'user'][-1]['message']['content']
        self.assertEqual(content[0], {'type': 'text', 'text': 'what is this'})
        self.assertEqual(content[1]['source'], {'type': 'base64', 'media_type': 'image/png', 'data': PNG})
        chat.send('', images=[{'data': PNG}])  # an image alone is a message
        until(q, is_result)
        self.assertEqual([m for m in self.sent() if m.get('type') == 'user'][-1]['message']['content'][0]['type'], 'image')
        gif = base64.b64encode(b'GIF89a' + b'\0' * 10).decode()
        webp = base64.b64encode(b'RIFF\0\0\0\0WEBPVP8 ').decode()
        self.assertEqual([k['media_type'] for k in tchat.image_blocks([{'data': gif}, {'data': webp}])[1]], ['image/gif', 'image/webp'])
        for bad, status in (([{'data': 'not base64!'}], 400), ([{'data': base64.b64encode(b'%PDF-1.4').decode()}], 400),
                            ([{'data': PNG}] * (tchat.IMAGES_MAX + 1), 400), ([{'data': 'A' * (tchat.IMAGE_MAX + 4)}], 413), ([{}], 400)):
            with self.assertRaises(StoreError) as cm:
                tchat.image_blocks(bad)
            self.assertEqual(cm.exception.status, status)

    def test_the_context_is_asked_after_each_turn_and_a_compaction_is_kept(self):
        chat = self.open(prompt='hello')
        _, q = chat.subscribe()
        until(q, lambda m: m.get('type') == 'tm_context')
        self.assertEqual(chat.info()['window'], {'used': 2000, 'max': 200000, 'percent': 1})
        chat.send('/compact')
        got = until(q, lambda m: m.get('type') == 'tm_context')
        self.assertTrue(any(m.get('subtype') == 'compact_boundary' for m in got))
        snapshot, _ = chat.subscribe()
        self.assertTrue(any(m.get('subtype') == 'compact_boundary' for m in snapshot))  # kept
        self.assertFalse(any(m.get('type') == 'tm_context' for m in snapshot))  # live only: info() has it

    def test_long_tool_results_are_cut(self):
        chat = self.open(prompt='long output')
        _, q = chat.subscribe()
        got = until(q, is_result)
        text = first(got, 'user')['message']['content'][0]['content']  # the tool's output (our tm_user may sit anywhere)
        self.assertLess(len(text), tchat.TEXT_MAX + 100)
        self.assertIn('more characters', text)

    def test_close_ends_it_and_it_stays_listed_until_closed(self):
        chat = self.open(prompt='hi')
        _, q = chat.subscribe()
        until(q, is_result)
        self.assertIs(self.open(), chat)  # live: handed back, no second process
        chat.kill()
        self.assertFalse(chat.alive)
        rest = until(q, lambda m: m.get('type') == 'tm_exit')
        self.assertEqual(rest[-1]['exit_code'], 0)
        self.assertFalse(self.chats.list()[0]['alive'])
        with self.assertRaises(StoreError) as cm:
            chat.send('more')
        self.assertEqual(cm.exception.status, 409)
        self.assertIsNone(self.chats.live('c1'))
        self.chats.close('c1')
        with self.assertRaises(StoreError):
            self.chats.get('c1')

    def test_a_resume_starts_with_its_history(self):
        past = [{'type': 'tm_user', 'text': 'before'}]
        chat = self.open('c2', history=past)
        snapshot, _ = chat.subscribe()
        self.assertEqual(snapshot, past)

    def test_flags_and_a_missing_command(self):
        self.assertIn('--permission-prompt-tool', tchat.chat_flags())
        self.assertEqual(tchat.chat_flags('plan')[-2:], ['--permission-mode', 'plan'])
        with self.assertRaises(ValueError):
            tchat.chat_flags('bypassPermissions')
        with self.assertRaises(StoreError) as cm:
            self.chats.open('c3', ['no-such-claude-binary'], self.work, self.env)
        self.assertIn('not found in the PATH', str(cm.exception))


class SessionFilesTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        for rel in ('README.md', 'src/app.py', 'src/lib/util.py', '.hidden/secret.txt', 'node_modules/x/index.js', 'ignored.log'):
            os.makedirs(os.path.dirname(os.path.join(self.root, rel)), exist_ok=True)
            with open(os.path.join(self.root, rel), 'w') as f:
                f.write('x')

    def test_a_plain_folder_is_walked_without_hidden_or_heavy_folders(self):
        paths, truncated = tchat.session_files(self.root)
        self.assertEqual(paths, ['README.md', 'ignored.log', 'src/', 'src/app.py', 'src/lib/', 'src/lib/util.py'])
        self.assertFalse(truncated)
        self.assertEqual(tchat.session_files(self.root, limit=2), (['README.md', 'ignored.log'], True))

    @unittest.skipUnless(shutil.which('git'), 'git is not installed')
    def test_a_checkout_lists_what_git_lists(self):
        import subprocess
        subprocess.run(['git', 'init', '-q'], cwd=self.root, check=True)
        with open(os.path.join(self.root, '.gitignore'), 'w') as f:
            f.write('*.log\nnode_modules/\n.hidden/\n')
        paths, _ = tchat.session_files(os.path.join(self.root, 'src'))  # a folder inside it: relative to that folder
        self.assertEqual(paths, ['app.py', 'lib/', 'lib/util.py'])
        paths, _ = tchat.session_files(self.root)
        self.assertNotIn('ignored.log', paths)
        self.assertIn('.gitignore', paths)  # git lists it; the walk would not


class TranscriptTest(unittest.TestCase):
    def test_only_the_conversation_is_read_back(self):
        work = tempfile.mkdtemp(prefix='tm transcript ')
        self.addCleanup(shutil.rmtree, work, True)
        path = os.path.join(work, 's.jsonl')
        lines = [
            {'type': 'queue-operation'},
            {'type': 'attachment', 'message': None},
            {'type': 'user', 'isMeta': True, 'message': {'role': 'user', 'content': 'meta'}},
            {'type': 'user', 'message': {'role': 'user', 'content': '<command-name>/clear</command-name>'}},
            {'type': 'user', 'message': {'role': 'user', 'content': 'Fix the bug'}},
            {'type': 'assistant', 'message': {'role': 'assistant', 'content': [{'type': 'tool_use', 'id': 't1', 'name': 'Read', 'input': {}}]}},
            {'type': 'user', 'message': {'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': 't1', 'content': 'x' * 30000}]}},
            {'type': 'assistant', 'isSidechain': True, 'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': 'sub'}]}},
            {'type': 'user', 'message': {'role': 'user', 'content': [{'type': 'text', 'text': '[Request interrupted by user]'}]}},
            {'type': 'user', 'message': {'role': 'user', 'content': [{'type': 'text', 'text': 'With a file'}, {'type': 'image'}]}},
            {'type': 'user', 'message': {'role': 'user', 'content': tchat.with_items('See', [{'id': 'TSK-2', 'title': 'Two', 'context': 'c'}])}},
            {'type': 'user', 'message': {'role': 'user', 'content': [{'type': 'image', 'source': {'media_type': 'image/png', 'data': 'AAAA'}}]}},
        ]
        with open(path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(json.dumps(x) for x in lines) + '\nnot json\n')
        got = history(path)
        self.assertEqual([m['type'] for m in got], ['tm_user', 'assistant', 'user', 'tm_answer', 'tm_user', 'tm_user', 'tm_user'])
        self.assertEqual(got[6], {'type': 'tm_user', 'text': '', 'images': [{'media_type': 'image/png'}]})  # no copy of it kept
        self.assertEqual(got[5], {'type': 'tm_user', 'text': 'See', 'items': [{'id': 'TSK-2', 'title': 'Two', 'type': ''}]})  # chips again
        self.assertEqual(got[0]['text'], 'Fix the bug')
        self.assertLess(len(got[2]['message']['content'][0]['content']), tchat.TEXT_MAX + 100)
        self.assertEqual(got[3]['behavior'], 'interrupted')
        self.assertEqual((got[4]['text'], got[4]['images']), ('With a file', [{'media_type': ''}]))
        self.assertEqual(history(path, limit=4)[0]['type'], 'tm_answer')
        self.assertEqual(history(os.path.join(work, 'missing.jsonl')), [])
        self.assertEqual(history(None), [])


if __name__ == '__main__':
    unittest.main()
