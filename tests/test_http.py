"""HTTP contract: the payloads static/js/api.js sends must be what server.py reads."""
import base64
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from unittest import mock
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

import server
from tm.store import DEFAULT_FOLDERS, Store


class HttpTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.base = f'http://127.0.0.1:{cls.httpd.server_address[1]}'
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.saved_store = server.APP.store

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        server.APP.store = cls.saved_store

    def setUp(self):
        # A fresh vault per test: the trash tests empty the trash, and ids are asserted.
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        server.APP.store = Store(tmp.name)

    def request(self, path, body=None, header=True):
        """→ (status, json). Never raises on an HTTP error status."""
        # The page names its vault in every request (api.js); these tests use the default one, set up above.
        headers = {'Content-Type': 'application/json', 'X-TM-Vault': server.APP.config['default_vault']}
        if header:
            headers['X-Task-Manager'] = '1'
        req = Request(self.base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            with urlopen(req) as res:
                return res.status, json.loads(res.read())
        except HTTPError as e:
            with e:
                return e.code, json.loads(e.read())

    def call(self, path, body=None, header=True):
        status, out = self.request(path, body, header)
        self.assertEqual(status, 200, out)
        return out

    def test_a_request_body_too_large_is_refused_unread(self):
        with mock.patch.object(server, 'JSON_MAX', 64):
            self.assertEqual(self.request('/api/item/create', {'type': 'note', 'subject': 'x' * 200, 'values': {}, 'body': ''})[0], 413)
        self.assertEqual(self.request('/api/item/create', {'type': 'note', 'subject': 'Small', 'values': {}, 'body': ''})[0], 200)

    def test_create_with_the_payload_api_js_sends(self):
        # Mirrors api.create(type, subject, values, body) in static/js/api.js
        out = self.call('/api/item/create', {'type': 'note', 'subject': 'Loose idea', 'values': {}, 'body': ''})
        self.assertEqual(out['title'], 'Loose idea')
        self.assertEqual(out['fields']['subject'], 'Loose idea')
        upd = self.call('/api/item/update', {'key': out['id'], 'values': {'labels': ['x']}, 'body': 'hi'})
        self.assertEqual((upd['fields']['labels'], upd['body']), (['x'], 'hi'))

    def test_pins_round_trip(self):
        # Mirrors api.pins() / api.savePins(items) in static/js/api.js
        self.assertEqual(self.call('/api/pins'), {'items': []})
        note = self.call('/api/item/create', {'type': 'note', 'subject': 'Pin me', 'values': {}, 'body': ''})
        self.assertEqual(self.call('/api/pins', {'items': [note['id']]}), {'items': [note['id']]})
        self.assertEqual(self.call('/api/pins')['items'], [note['id']])
        self.call('/api/pins', {'items': []})

    def test_sidebar_round_trip(self):
        # Mirrors api.sidebar() / api.saveSidebar(items) in static/js/api.js
        self.assertEqual(self.call('/api/sidebar'), {'items': []})
        ini = self.call('/api/item/create', {'type': 'initiative', 'subject': 'Order me', 'values': {}, 'body': ''})
        self.assertEqual(self.call('/api/sidebar', {'items': [ini['id']]}), {'items': [ini['id']]})
        self.assertEqual(self.call('/api/sidebar')['items'], [ini['id']])

    def test_post_without_header_is_refused(self):
        self.assertEqual(self.request('/api/item/create', {'type': 'note', 'subject': 'x'}, header=False)[0], 403)

    def test_update_with_a_stale_base_is_a_409_with_the_current_revs(self):
        note = self.call('/api/item/create', {'type': 'note', 'subject': 'Doc', 'values': {}, 'body': 'v1'})
        saved = self.call('/api/item/update', {'key': note['id'], 'values': {}, 'body': 'v2', 'base_body_rev': note['body_rev']})
        self.assertNotEqual(saved['body_rev'], note['body_rev'])  # the answer carries the next base
        code, out = self.request('/api/item/update', {'key': note['id'], 'values': {}, 'body': 'v3', 'base_body_rev': note['body_rev']})
        self.assertEqual(code, 409)
        self.assertEqual((out['rev'], out['body_rev']), (saved['rev'], saved['body_rev']))
        self.assertIn('changed on disk', out['error'])
        code, out = self.request('/api/item/update', {'key': note['id'], 'values': {'labels': ['x']}, 'base_rev': note['rev']})
        self.assertEqual(code, 409)
        self.assertEqual(self.call(f"/api/item?key={note['id']}")['body'], 'v2')

    # ── trash and Claude routes ──────────────────────────────────────────────
    def test_trash_and_claude_routes_need_the_header(self):
        note = self.call('/api/item/create', {'type': 'note', 'subject': 'Keep me'})
        trashed = self.call('/api/item/delete', {'key': note['id']})['trashed']
        with mock.patch.object(server.subprocess, 'run') as run:
            for path, body in (('/api/trash/restore', {'trashed': trashed}), ('/api/trash/purge', {'trashed': trashed}),
                               ('/api/trash/empty', {}), ('/api/item/restore', {'trashed': trashed, 'to': 'notes/x.md'}),
                               ('/api/item/claude/preview', {'key': note['id']}), ('/api/item/claude', {'key': note['id']}),
                               ('/api/claude/resume', {'session_id': 'x'}), ('/api/claude/forget', {'index': 0}),
                               ('/api/term/open', {'instruction': 'x'}), ('/api/term/input', {'id': 'x', 'data': 'x'}),
                               ('/api/term/close', {'id': 'x'})):
                with self.subTest(path=path):
                    self.assertEqual(self.request(path, body, header=False)[0], 403)
        run.assert_not_called()
        self.assertEqual([e['trashed'] for e in self.call('/api/trash')['entries']], [trashed])  # nothing happened

    def test_trash_round_trip(self):
        a = self.call('/api/item/create', {'type': 'task', 'subject': 'A'})
        b = self.call('/api/item/create', {'type': 'task', 'subject': 'B'})
        c = self.call('/api/item/create', {'type': 'note', 'subject': 'C'})
        for it in (a, b, c):
            self.call('/api/item/delete', {'key': it['id']})
        entries = self.call('/api/trash')['entries']
        self.assertEqual(sorted(e['id'] for e in entries), ['NOTE-0001', 'TSK-0001', 'TSK-0002'])
        by_id = {e['id']: e['trashed'] for e in entries}
        self.assertEqual(self.call('/api/trash/restore', {'trashed': by_id['TSK-0001']})['id'], 'TSK-0001')
        self.assertEqual(self.call('/api/trash/purge', {'trashed': by_id['TSK-0002']}), {'purged': by_id['TSK-0002'], 'attachments': 0})
        self.assertEqual(self.call('/api/trash/empty', {}), {'purged': 1, 'attachments': 0, 'files': 0})
        self.assertEqual(self.call('/api/trash'), {'entries': [], 'attachments': 0, 'files': []})
        self.assertEqual([i['id'] for i in self.call('/api/items')['items']], ['TSK-0001'])

    def test_trash_routes_refuse_paths_outside_the_trash(self):
        live = self.call('/api/item/create', {'type': 'note', 'subject': 'Live'})
        for path in ('/api/trash/purge', '/api/trash/restore'):
            for trashed, status in ((live['path'], 404), ('notes/nothing.md', 404), ('../outside.md', None), ('', None)):
                with self.subTest(path=path, trashed=trashed):
                    code, out = self.request(path, {'trashed': trashed})
                    self.assertIn(code, (status,) if status else (400, 404))
                    self.assertIn('error', out)
        self.assertEqual(self.call(f"/api/item?key={live['id']}")['title'], 'Live')  # the live item is untouched

    def test_restore_to_an_invalid_target_is_refused(self):
        note = self.call('/api/item/create', {'type': 'note', 'subject': 'Back'})
        trashed = self.call('/api/item/delete', {'key': note['id']})['trashed']
        for to in ('notes/back.txt', '.task-manager/back.md', '.task-manager/trash/back.md', '../back.md', ''):
            with self.subTest(to=to):
                code, out = self.request('/api/item/restore', {'trashed': trashed, 'to': to})
                self.assertEqual(code, 400, out)
        self.assertEqual([e['id'] for e in self.call('/api/trash')['entries']], ['NOTE-0001'])  # not lost
        self.assertEqual(self.call('/api/item/restore', {'trashed': trashed, 'to': note['path']})['id'], 'NOTE-0001')

    def test_claude_refuses_a_model_or_effort_outside_the_lists(self):
        note = self.call('/api/item/create', {'type': 'note', 'subject': 'Ask Claude'})
        preview = self.call('/api/item/claude/preview', {'key': note['id'], 'model': 'opus', 'effort': 'high'})
        self.assertIn('Ask Claude', preview['prompt'])
        self.assertEqual(preview['flags'], ['--model', 'opus', '--effort', 'high'])
        with mock.patch.object(server.subprocess, 'run') as run:
            for body in ({'model': 'gpt-5'}, {'model': 'opus; rm -rf ~'}, {'effort': 'extreme'},
                         {'model': '--dangerously-skip-permissions'}):
                for path in ('/api/item/claude/preview', '/api/item/claude'):
                    with self.subTest(path=path, body=body):
                        code, out = self.request(path, {'key': note['id'], **body})
                        self.assertEqual(code, 400, out)  # the value is checked before anything else, on any platform
        run.assert_not_called()  # nothing was launched

    def test_claude_without_an_item_is_just_the_prompt(self):
        preview = self.call('/api/item/claude/preview', {'key': None, 'instruction': '  Tidy the vault  '})
        self.assertEqual(preview['prompt'], 'Tidy the vault')  # no item block, no default instruction
        self.assertEqual(preview['cwd_source'], 'project')
        self.assertEqual(preview['cwd'], os.path.realpath(server.APP_DIR))
        with mock.patch.object(server.subprocess, 'run') as run:
            code, out = self.request('/api/item/claude', {'key': None, 'instruction': '   '})
        self.assertEqual(code, 400, out)  # nothing to send: refused on any platform
        run.assert_not_called()

    def test_the_folder_a_launch_picks_must_be_a_saved_one(self):
        note = self.call('/api/item/create', {'type': 'note', 'subject': 'Pick a folder'})
        with mock.patch.dict(server.APP.config, {'claude_paths': [self.root], 'claude_cwd': ''}):
            picked = self.call('/api/item/claude/preview', {'key': note['id'], 'cwd': self.root + '/'})
            self.assertEqual((picked['cwd'], picked['cwd_source']), (os.path.realpath(self.root), 'chosen'))
            auto = self.call('/api/item/claude/preview', {'key': note['id'], 'cwd': ''})
            self.assertEqual(auto['cwd_source'], 'project')  # '' is the automatic choice, not an error
            with mock.patch.object(server.subprocess, 'run') as run:
                for cwd in (os.path.expanduser('~'), '/etc', self.root + '/../', 'x; rm -rf ~'):
                    for path in ('/api/item/claude/preview', '/api/item/claude'):
                        with self.subTest(path=path, cwd=cwd):
                            self.assertEqual(self.request(path, {'key': note['id'], 'cwd': cwd})[0], 400)
            run.assert_not_called()
        with mock.patch.dict(server.APP.config, {'claude_paths': [self.root + '/gone'], 'claude_cwd': ''}):
            self.assertEqual(self.request('/api/item/claude/preview', {'key': note['id'], 'cwd': self.root + '/gone'})[0], 409)

    def test_clean_paths_puts_the_default_first_without_repeats(self):
        self.assertEqual(server.clean_paths(['~/x/', '/a', '/a', '', None], '/d'), [os.path.expanduser('~/x'), '/a', '/d'])
        self.assertEqual(server.clean_paths(['/d', '/a'], '/d'), ['/d', '/a'])  # the order given is kept
        self.assertEqual(server.clean_paths(None, ''), [])
        self.assertEqual(server.clean_paths('not a list', '/d/'), ['/d'])

    def test_clean_names_keeps_one_line_names_of_saved_folders(self):
        names = {'~/x/': '  My   repo ', '/a': '', '/gone': 'Gone', '/d': None}
        self.assertEqual(server.clean_names(names, [os.path.expanduser('~/x'), '/a', '/d']), {os.path.expanduser('~/x'): 'My repo'})
        self.assertEqual(server.clean_names('not a dict', ['/a']), {})
        self.assertEqual(server.clean_names({'': ' This app '}, []), {'': 'This app'})  # '': the project folder

    def test_the_preview_names_a_folder_with_a_public_name(self):
        with mock.patch.dict(server.APP.config, {'claude_paths': [self.root], 'claude_cwd': self.root,
                                                 'claude_path_names': {self.root: 'Vault'}}):
            out = self.call('/api/item/claude/preview', {'key': None, 'instruction': 'hi', 'cwd': self.root})
            self.assertEqual(out['cwd_name'], 'Vault')
        with mock.patch.dict(server.APP.config, {'claude_paths': [self.root], 'claude_cwd': self.root, 'claude_path_names': {}}):
            self.assertEqual(self.call('/api/item/claude/preview', {'key': None, 'instruction': 'hi'})['cwd_name'], '')
        with mock.patch.dict(server.APP.config, {'claude_paths': [], 'claude_cwd': '', 'claude_path_names': {'': 'This app'}}):
            self.assertEqual(self.call('/api/item/claude/preview', {'key': None, 'instruction': 'hi'})['cwd_name'], 'This app')

    # ── the dock: claude in a pty inside the server ──────────────────────────
    def _sse(self, res, until, timeout=10):
        """Events from an open stream until one named `until` arrives (→ list of (name, payload))."""
        out, name, data = [], None, ''
        deadline = time.time() + timeout
        while time.time() < deadline:
            line = res.readline().decode('utf-8')
            if not line:
                break
            line = line.rstrip('\n')
            if line.startswith('event:'):
                name = line[6:].strip()
            elif line.startswith('data:'):
                data += line[5:].strip()
            elif line == '' and name:
                out.append((name, json.loads(data)))
                if name == until:
                    return out
                name, data = None, ''
        self.fail(f'no {until!r} event; got {[n for n, _ in out]}')

    def test_the_dock_runs_claude_in_a_pty_and_streams_it(self):
        if sys.platform == 'win32' or not shutil.which('sh'):
            self.skipTest('needs a pty and sh')
        fake = os.path.join(self.root, 'fake claude.sh')  # a space: the command goes through shlex, the path must survive it
        with open(fake, 'w') as f:
            f.write('#!/bin/sh\nprintf "ARGS:%s\\n" "$*"\nread -r line\necho "got $line"\n')
        os.chmod(fake, 0o700)
        self.addCleanup(server.TERMS.close_all)
        task = self.call('/api/item/create', {'type': 'task', 'subject': 'Dock me'})
        with mock.patch.dict(server.APP.config, {'claude_command': f"'{fake}'", 'claude_model': ''}):
            out = self.call('/api/term/open', {'key': task['id'], 'instruction': 'Hello dock', 'cols': 90, 'rows': 20})
            tid = out['term']['id']
            self.assertEqual(tid, out['session_id'])
            self.assertTrue(out['term']['alive'])
            self.assertEqual((out['term']['cols'], out['term']['rows']), (90, 20))
            self.assertEqual([s['id'] for s in out['item']['fields']['claude_sessions']], [tid])  # recorded like a Terminal.app launch
            self.assertEqual(self.call('/api/term/list')['terms'][0]['label'], 'TSK-0001 · Dock me')
            with urlopen(Request(f'{self.base}/api/term/stream?id={tid}'), timeout=10) as res:
                self.assertTrue(res.headers['Content-Type'].startswith('text/event-stream'))
                events = self._sse(res, 'snapshot')
                text = base64.b64decode(events[-1][1]['data']).decode('utf-8', 'replace')
                while 'Hello dock' not in text:  # the snapshot may predate the script's output, and the pty may split it in chunks
                    text += ''.join(base64.b64decode(p['data']).decode('utf-8', 'replace') for n, p in self._sse(res, 'data') if n == 'data')
                self.assertIn(f'--session-id {tid} --name TSK-0001 · Dock me', text)  # the flags reached the process
                self.assertIn('# TSK-0001 · Dock me', text)  # and so did the prompt, as one argument
                self.assertIn('Hello dock', text)
                self.call('/api/term/input', {'id': tid, 'data': 'bye\n'})
                events = self._sse(res, 'exit')
                text = ''.join(base64.b64decode(p['data']).decode('utf-8', 'replace') for n, p in events if n == 'data')
                self.assertIn('got bye', text)
                self.assertEqual(events[-1][1]['exit_code'], 0)
            self.assertFalse(self.call('/api/term/list')['terms'][0]['alive'])
            self.assertEqual(self.request('/api/term/input', {'id': tid, 'data': 'x'})[0], 409)  # ended: no more input
            # A resume reuses the record (folder, id) and starts a new process under the same id.
            back = self.call('/api/term/resume', {'key': task['id'], 'session_id': tid, 'cols': 80, 'rows': 24})
            self.assertEqual(back['term']['id'], tid)
            self.assertTrue(back['term']['alive'])
            again = self.call('/api/term/resume', {'key': task['id'], 'session_id': tid})  # already running: handed back
            self.assertEqual(again['term']['started'], back['term']['started'])
            self.assertEqual(self.call('/api/term/resize', {'id': tid, 'cols': 132, 'rows': 50}), {'cols': 132, 'rows': 50})
            self.assertIn('closed', self.call('/api/term/close', {'id': tid}))
            self.assertEqual(self.request('/api/term/close', {'id': tid})[0], 404)
            self.assertEqual(self.request('/api/term/input', {'id': tid, 'data': 'x'})[0], 404)
            self.assertEqual(self.request(f'/api/term/stream?id={tid}')[0], 404)
            self.assertEqual(self.request('/api/term/resume', {'key': task['id'], 'session_id': 'not-recorded'})[0], 404)
            self.assertEqual(self.request('/api/term/open', {'key': None, 'instruction': ''})[0], 400)  # nothing to send

    def test_the_dock_runs_claude_as_a_chat_and_hands_it_to_the_terminal(self):
        if sys.platform == 'win32' or not shutil.which('sh'):
            self.skipTest('needs a pty and sh')
        fake = os.path.join(os.path.dirname(__file__), 'fixtures', 'fake_claude.py')
        log = os.path.join(self.root, 'stdin.ndjson')
        self.addCleanup(server.CHATS.close_all)
        self.addCleanup(server.TERMS.close_all)
        task = self.call('/api/item/create', {'type': 'task', 'subject': 'Chat me'})
        config = {'claude_command': f"'{sys.executable}' '{fake}'", 'claude_model': ''}
        with mock.patch.dict(server.APP.config, config), mock.patch.dict(os.environ, {'FAKE_CLAUDE_LOG': log}):
            out = self.call('/api/chat/open', {'key': task['id'], 'instruction': 'Hello chat', 'mode': 'plan'})
            cid = out['chat']['id']
            self.assertEqual(cid, out['session_id'])
            self.assertEqual(out['chat']['label'], 'TSK-0001 · Chat me')
            self.assertEqual([s['id'] for s in out['item']['fields']['claude_sessions']], [cid])  # recorded like the others
            self.assertEqual(self.request('/api/chat/open', {'key': None, 'instruction': '', 'mode': 'yolo'})[0], 400)
            listed = self.call('/api/chat/list')
            self.assertEqual(listed['chats'][0]['id'], cid)
            self.assertIn('acceptEdits', listed['modes'])
            files = self.call(f'/api/chat/files?id={cid}')  # the composer's @: the files of the session's folder
            self.assertEqual(files['truncated'], False)
            self.assertTrue(files['files'] and all(not p.startswith('/') for p in files['files']))
            with urlopen(Request(f'{self.base}/api/chat/stream?id={cid}'), timeout=10) as res:
                events = self._sse(res, 'snapshot')
                msgs = events[-1][1]['events']
                self.assertIn('# TSK-0001 · Chat me', msgs[0]['text'])  # the prompt went in as the first message
                while not any(m.get('type') == 'result' for m in msgs):
                    msgs += [p for n, p in self._sse(res, 'msg') if n == 'msg']
                self.call('/api/chat/send', {'id': cid, 'text': 'tool now'})
                msgs = [p for n, p in self._sse(res, 'msg') if n == 'msg']
                while not any(m.get('type') == 'control_request' for m in msgs):
                    msgs += [p for n, p in self._sse(res, 'msg') if n == 'msg']
                req = next(m for m in msgs if m.get('type') == 'control_request')
                self.call('/api/chat/permission', {'id': cid, 'request_id': req['request_id'], 'behavior': 'allow'})
                self.assertEqual(self.request('/api/chat/permission', {'id': cid, 'request_id': req['request_id'], 'behavior': 'allow'})[0], 409)
                self.assertEqual(self.call('/api/chat/control', {'id': cid, 'mode': 'acceptEdits'})['mode'], 'acceptEdits')
                self.assertEqual(self.request('/api/chat/control', {'id': cid, 'model': 'gpt'})[0], 400)
                self.assertEqual(self.call('/api/chat/control', {'id': cid, 'effort': 'low'})['effort'], 'low')
                # A vault item attached: its context is built from its file, in the vault the page names.
                self.call('/api/chat/send', {'id': cid, 'text': 'see this', 'items': [task['id']], 'vault': server.APP.config['default_vault']})
                msgs = []
                while not any(m.get('type') == 'tm_user' for m in msgs):
                    msgs += [p for n, p in self._sse(res, 'msg') if n == 'msg']
                user = next(m for m in msgs if m.get('type') == 'tm_user')
                self.assertEqual(user['items'], [{'id': task['id'], 'title': 'Chat me', 'type': 'task'}])
                self.assertEqual(self.request('/api/chat/send', {'id': cid, 'text': 'x', 'items': ['TSK-9999'], 'vault': server.APP.config['default_vault']})[0], 404)
                # An image: as blocks for claude, a thumbnail for the chat; then a question answered from its card.
                png = base64.b64encode(b'\x89PNG\r\n\x1a\n' + b'\0' * 20).decode()
                self.call('/api/chat/send', {'id': cid, 'text': 'look', 'images': [{'data': png, 'thumb': 'data:image/jpeg;base64,AA'}]})
                self.assertEqual(self.request('/api/chat/send', {'id': cid, 'text': '', 'images': [{'data': 'eA=='}]})[0], 400)
                self.call('/api/chat/send', {'id': cid, 'text': 'ask me'})
                msgs = []
                while not any(m.get('type') == 'control_request' for m in msgs):
                    msgs += [p for n, p in self._sse(res, 'msg') if n == 'msg']
                self.assertEqual(next(m for m in msgs if m.get('type') == 'tm_user')['images'],
                                 [{'media_type': 'image/png', 'thumb': 'data:image/jpeg;base64,AA'}])
                req = next(m for m in msgs if m.get('type') == 'control_request')
                body = {'id': cid, 'request_id': req['request_id'], 'behavior': 'allow'}
                self.assertEqual(self.request('/api/chat/permission', body)[0], 400)  # a question needs its answers
                self.call('/api/chat/permission', {**body, 'answers': {'Which color?': 'Red'}})
                msgs = []
                while not any(m.get('type') == 'tm_answer' for m in msgs):
                    msgs += [p for n, p in self._sse(res, 'msg') if n == 'msg']
                self.assertEqual(next(m for m in msgs if m.get('type') == 'tm_answer')['answers'], {'Which color?': 'Red'})
                # The terminal takes the same session over: the chat ends first (one driver at a time).
                term = self.call('/api/term/resume', {'key': task['id'], 'session_id': cid, 'cols': 80, 'rows': 24})
                self.assertEqual(term['term']['id'], cid)
                self.assertEqual(self._sse(res, 'exit')[-1][0], 'exit')
            self.assertEqual(self.call('/api/chat/list')['chats'], [])  # handed over: the session is a terminal now
            self.assertEqual(self.request('/api/chat/send', {'id': cid, 'text': 'x'})[0], 404)
            # And back: the chat resumes (the stand-in has no transcript, so it starts with no history).
            back = self.call('/api/chat/resume', {'key': task['id'], 'session_id': cid})
            self.assertTrue(back['chat']['alive'])
            self.assertEqual(self.call('/api/term/list')['terms'], [])  # and the terminal handed it back
            again = self.call('/api/chat/resume', {'key': task['id'], 'session_id': cid})  # already running: handed back
            self.assertEqual(again['chat']['started'], back['chat']['started'])
            self.assertIn('closed', self.call('/api/chat/close', {'id': cid}))
            self.assertEqual(self.request('/api/chat/close', {'id': cid})[0], 404)
            self.assertEqual(self.request(f'/api/chat/stream?id={cid}')[0], 404)
            self.assertEqual(self.request('/api/chat/send', {'id': cid, 'text': 'x'}, header=False)[0], 403)  # CSRF guard
        with open(log, encoding='utf-8') as f:
            argv = json.loads(f.readline())['argv']
        self.assertEqual(argv[argv.index('--permission-mode') + 1], 'plan')
        self.assertIn('--session-id', argv)

    def test_a_session_changes_the_item_it_is_about(self):
        if sys.platform == 'win32':
            self.skipTest('needs a pipe-driven child process')
        fake = os.path.join(os.path.dirname(__file__), 'fixtures', 'fake_claude.py')
        self.addCleanup(server.CHATS.close_all)
        task = self.call('/api/item/create', {'type': 'task', 'subject': 'Move me here'})
        self.call('/api/item/create', {'type': 'prompt', 'subject': 'P'})
        vault = server.APP.config['default_vault']
        with mock.patch.dict(server.APP.config, {'claude_command': f"'{sys.executable}' '{fake}'", 'claude_model': ''}):
            chat = self.call('/api/chat/open', {'key': None, 'instruction': 'Tidy the vault', 'mode': 'default'})['chat']
        cid = chat['id']
        self.assertEqual((chat['key'], chat['vault']), (None, vault))  # the vault its record is in
        sessions = lambda key: [s['id'] for s in (self.call(f'/api/item?key={quote(key)}')['fields'].get('claude_sessions') or [])]
        listed = lambda: [s['id'] for s in self.call('/api/claude/sessions')['sessions']]
        self.assertEqual(listed(), [cid])

        out = self.call('/api/claude/associate', {'session_id': cid, 'from_key': None, 'to_key': task['key']})
        self.assertEqual((out['session']['key'], out['session']['label']), (task['key'], 'TSK-0001 · Move me here'))
        self.assertEqual((listed(), sessions(task['key'])), ([], [cid]))  # in the item's history now
        self.assertEqual(server.CHATS.get(cid).label, 'TSK-0001 · Move me here')  # the dock's list reads it from here
        out = self.call('/api/claude/associate', {'session_id': cid, 'from_key': task['key'], 'to_key': None})
        self.assertEqual((out['session']['key'], out['session']['label']), (None, 'Tidy the vault'))
        self.assertEqual((listed(), sessions(task['key'])), ([cid], []))
        self.assertEqual(self.request('/api/claude/associate', {'session_id': cid, 'from_key': None, 'to_key': 'PRM-0001'})[0], 400)
        server.CHATS.get(cid).vault = 'another-vault'
        self.assertEqual(self.request('/api/claude/associate', {'session_id': cid, 'from_key': None, 'to_key': task['key']})[0], 409)
        server.CHATS.close(cid)
        # A history row's Move…: the dock does not run it, the record moves all the same.
        self.call('/api/claude/associate', {'session_id': cid, 'from_key': None, 'to_key': task['key']})
        self.assertEqual(sessions(task['key']), [cid])
        self.assertEqual(self.request('/api/claude/associate', {'session_id': '0f1e2d3c-4b5a-4978-8a6b-00000000000f',
                                                                'from_key': None, 'to_key': task['key']})[0], 404)
        self.assertEqual(self.request('/api/claude/associate', {'session_id': cid, 'from_key': task['key'], 'to_key': None},
                                      header=False)[0], 403)

    def test_the_dock_needs_the_command_on_the_path(self):
        with mock.patch.dict(server.APP.config, {'claude_command': 'no-such-claude-binary-xyz'}):
            code, out = self.request('/api/term/open', {'key': None, 'instruction': 'hi'})
        self.assertEqual(code, 500)
        self.assertIn('not found in the PATH', out['error'])
        self.assertEqual(self.call('/api/claude/sessions'), {'sessions': []})  # a failed start records nothing

    def _script_opened(self, run):
        """The .command file the mocked `open -a Terminal <script>` was given (still there: nothing ran it)."""
        args = run.call_args[0][0]
        self.assertEqual(args[:2], ['open', '-a'])
        self.addCleanup(shutil.rmtree, os.path.dirname(args[3]), True)
        with open(args[3], encoding='utf-8') as f:
            return f.read()

    def test_a_launch_records_a_session_that_resume_reopens(self):
        if sys.platform != 'darwin':
            self.skipTest('launching is macOS only')
        task = self.call('/api/item/create', {'type': 'task', 'subject': 'Fix it'})
        with mock.patch.object(server.subprocess, 'run') as run:
            out = self.call('/api/item/claude', {'key': task['id'], 'instruction': 'Write the tests first\nthen the code', 'model': 'opus'})
            script = self._script_opened(run)
        sid = out['session_id']
        self.assertRegex(sid, r'^[0-9a-f-]{36}$')
        self.assertIn(f'--session-id {sid} --name', script)
        self.assertIn('TSK-0001', script)  # the name Claude lists it under
        self.assertIn('"$prompt"', script)
        kept = out['item']['fields']['claude_sessions']
        self.assertEqual([(s['id'], s['instruction'], s['model']) for s in kept], [(sid, 'Write the tests first', 'opus')])
        self.assertEqual(self.call(f"/api/item?key={task['id']}")['fields']['claude_sessions'], kept)  # on the file
        # Resume: the id and the folder come from the record, the script carries no prompt.
        with mock.patch.object(server.subprocess, 'run') as run:
            back = self.call('/api/claude/resume', {'key': task['id'], 'session_id': sid})
            script = self._script_opened(run)
        self.assertEqual((back['session_id'], back['cwd']), (sid, kept[0]['cwd']))
        self.assertIn(f'--resume {sid}', script)
        self.assertNotIn('$prompt', script)
        self.assertNotIn('--model', script)
        with mock.patch.object(server.subprocess, 'run') as run:
            self.assertEqual(self.request('/api/claude/resume', {'key': task['id'], 'session_id': '0f1e2d3c-4b5a-4978-8a6b-000000000000'})[0], 404)
            self.assertEqual(self.request('/api/claude/resume', {'key': task['id'], 'session_id': 'x; rm -rf ~'})[0], 404)
        run.assert_not_called()
        self.assertEqual(self.call('/api/claude/forget', {'key': task['id'], 'index': 0})['fields']['claude_sessions'], [])

    def test_a_global_launch_is_listed_and_resumable(self):
        if sys.platform != 'darwin':
            self.skipTest('launching is macOS only')
        self.assertEqual(self.call('/api/claude/sessions'), {'sessions': []})
        with mock.patch.object(server.subprocess, 'run') as run:
            out = self.call('/api/item/claude', {'key': None, 'instruction': 'Tidy the vault'})
            script = self._script_opened(run)
        self.assertNotIn('item', out)
        self.assertIn(f"--session-id {out['session_id']} --name 'Tidy the vault'", script)
        listed = self.call('/api/claude/sessions')['sessions']
        self.assertEqual([(s['id'], s['instruction'], s['cwd']) for s in listed], [(out['session_id'], 'Tidy the vault', out['cwd'])])
        with mock.patch.object(server.subprocess, 'run') as run:
            back = self.call('/api/claude/resume', {'session_id': out['session_id']})
            self.assertIn(f"--resume {out['session_id']}", self._script_opened(run))
        self.assertEqual(back['cwd'], out['cwd'])
        self.assertEqual(self.call('/api/claude/forget', {'index': 0}), {'sessions': []})
        self.assertEqual(self.request('/api/claude/forget', {'index': 0})[0], 404)

    ALL_TARGETS = [{'key': 'terminal', 'label': 'Terminal'}, {'key': 'desktop', 'label': 'Claude Desktop'},
                   {'key': 'cursor', 'label': 'Cursor'}, {'key': 'antigravity', 'label': 'Antigravity'}]

    def test_open_in_desktop_cursor_or_antigravity(self):
        """Open in ▾: a new session there is not recorded; a recorded one is resumed there; nothing else is a target."""
        if sys.platform != 'darwin':
            self.skipTest('launching is macOS only')
        task = self.call('/api/item/create', {'type': 'task', 'subject': 'Fix it'})
        with mock.patch.object(server, 'open_targets', return_value=self.ALL_TARGETS), \
                mock.patch.object(server.time, 'sleep'), mock.patch.object(server.subprocess, 'run') as run:
            out = self.call('/api/item/claude', {'key': task['id'], 'instruction': 'Plan it', 'target': 'cursor'})
            cmds = [c[0][0] for c in run.call_args_list]
            self.assertEqual(cmds[0], ['open', '-a', 'Cursor', out['cwd']])
            self.assertTrue(cmds[1][1].startswith('cursor://anthropic.claude-code/open?prompt='))
            self.assertEqual((out['target'], out['recorded']), ('cursor', False))
            self.assertFalse(self.call(f"/api/item?key={task['id']}")['fields'].get('claude_sessions'))  # not recorded

            run.reset_mock()
            self.call('/api/item/claude', {'key': task['id'], 'target': 'desktop'})
            self.assertTrue(run.call_args[0][0][1].startswith('claude://code/new?folder='))
            self.assertEqual(self.request('/api/item/claude', {'key': task['id'], 'target': 'vim'})[0], 400)

            # A recorded session (a Terminal launch), resumed in Antigravity and in Claude Desktop.
            sid = self.call('/api/item/claude', {'key': task['id']})['session_id']
            run.reset_mock()
            self.call('/api/claude/resume', {'key': task['id'], 'session_id': sid, 'target': 'antigravity'})
            cmds = [c[0][0] for c in run.call_args_list]
            self.assertEqual(cmds[0][:3], ['open', '-a', 'Antigravity'])
            self.assertEqual(cmds[1], ['open', f'antigravity://anthropic.claude-code/open?session={sid}'])
            run.reset_mock()
            run.return_value = mock.Mock(returncode=0, stdout='', stderr='')
            self.call('/api/claude/resume', {'key': task['id'], 'session_id': sid, 'target': 'desktop'})
            self.assertEqual(run.call_args[0][0][-3:], ['--desktop', '--resume', sid])
            # Still running in the dock: not handed to Desktop.
            with mock.patch.object(server.TERMS, 'get', return_value=mock.Mock(alive=True)):
                self.assertEqual(self.request('/api/claude/resume', {'key': task['id'], 'session_id': sid, 'target': 'desktop'})[0], 409)

    def test_a_desktop_handover_that_fails_answers_500_with_what_claude_said(self):
        """`claude --desktop --resume` exiting non-zero (or not starting) is an error with its message, not a silent ok."""
        if sys.platform != 'darwin':
            self.skipTest('launching is macOS only')
        task = self.call('/api/item/create', {'type': 'task', 'subject': 'Fix it'})
        with mock.patch.object(server.subprocess, 'run'):
            sid = self.call('/api/item/claude', {'key': task['id']})['session_id']
        body = {'key': task['id'], 'session_id': sid, 'target': 'desktop'}
        with mock.patch.object(server, 'open_targets', return_value=self.ALL_TARGETS), \
                mock.patch.object(server.subprocess, 'run') as run:
            run.return_value = mock.Mock(returncode=1, stdout='', stderr='Error: Claude Desktop is not signed in\n')
            code, out = self.request('/api/claude/resume', body)
            self.assertEqual(code, 500)
            self.assertIn('Claude Desktop is not signed in', out['error'])
            self.assertEqual(run.call_args[0][0][-3:], ['--desktop', '--resume', sid])
            run.side_effect = FileNotFoundError('claude')
            code, out = self.request('/api/claude/resume', body)
            self.assertEqual(code, 500)
            self.assertIn('could not hand it to Claude Desktop', out['error'])

    def test_statuses_round_trip(self):
        # Mirrors api.statuses() / api.saveStatuses(types, colors, remap) in Settings → Item type status
        cfg = self.call('/api/statuses')
        task = next(t for t in cfg['types'] if t['type'] == 'task')
        self.assertEqual([g for g, _ in cfg['groups']], ['not_started', 'in_progress', 'closed'])
        self.call('/api/item/create', {'type': 'task', 'subject': 'In review', 'values': {'status': 'Review'}, 'body': ''})
        rows = [{'name': 'InQA' if r['name'] == 'Review' else r['name'], 'group': r['group']} for r in task['statuses']]
        status, out = self.request('/api/statuses', {'types': {'task': rows}, 'colors': {}})
        self.assertEqual((status, out['stranded']), (409, {'Tasks': {'Review': 1}}))
        self.assertEqual(self.request('/api/statuses', {'types': {'task': rows[:1]}})[0], 400)  # nothing closes
        out = self.call('/api/statuses', {'types': {'task': rows}, 'colors': {'InQA': '#00aa88'}, 'remap': {'task': {'Review': 'InQA'}}})
        self.assertEqual(out['moved'], 1)
        public = self.call('/api/structure')
        self.assertEqual(public['colors'], {'InQA': '#00aa88'})
        self.assertEqual(next(t for t in public['types'] if t['name'] == 'task')['groups']['InQA'], 'in_progress')

    def test_exports_round_trip(self):
        # Mirrors api.exports / exportVersion / deleteExport and the download link in Settings → Export
        app = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, app)
        with open(os.path.join(app, 'server.py'), 'w') as f:
            f.write('#')
        with open(os.path.join(self.root, 'note.md'), 'w') as f:
            f.write('hi')
        with mock.patch.object(server, 'APP_DIR', app):
            rec = self.call('/api/exports', {'note': 'n', 'kind': 'vault'})
            self.assertTrue(rec['name'].startswith('vault-'))
            listing = self.call('/api/exports')
            self.assertEqual(([r['name'] for r in listing['exports']], listing['from'], listing['installed']), ([rec['name']], app, False))
            url = f"{self.base}/api/exports/file?name={rec['name']}"
            with urlopen(Request(url)) as res:
                self.assertEqual(res.headers['Content-Type'], 'application/zip')
                self.assertIn(rec['name'], res.headers['Content-Disposition'])
                self.assertTrue(res.read().startswith(b'PK'))
            with self.assertRaises(HTTPError) as cross:  # another site's link or <img>: refused
                urlopen(Request(url, headers={'Sec-Fetch-Site': 'cross-site'}))
            self.assertEqual(cross.exception.code, 403)
            cross.exception.close()
            with self.assertRaises(HTTPError) as bad:
                urlopen(Request(f'{self.base}/api/exports/file?name=../config.json'))
            self.assertEqual(bad.exception.code, 404)
            bad.exception.close()
            self.assertEqual(self.request('/api/exports', {'kind': 'people'})[0], 404)
            self.call('/api/exports/delete', {'name': rec['name']})
            self.assertEqual(self.call('/api/exports')['exports'], [])

    def test_docs_roots_and_a_first_root_made_in_one_go(self):
        self.assertEqual(self.call('/api/docs/roots')['containers'][-1], {'project': None, 'title': '', 'path': 'docs', 'exists': False,
                                                                          'archived': False, 'roots': []})
        self.assertEqual(self.request('/api/files/mkdir', {'path': 'docs/Producto'})[0], 404)  # docs/ is not there yet
        self.call('/api/files/mkdir', {'path': 'docs/Producto', 'parents': True})
        self.assertEqual(self.call('/api/docs/roots')['containers'][-1]['roots'], ['Producto'])

    def test_reveal_selects_the_zip_in_finder_and_nothing_else(self):
        app = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, app)
        with open(os.path.join(app, 'server.py'), 'w') as f:
            f.write('#')
        with open(os.path.join(self.root, 'note.md'), 'w') as f:
            f.write('hi')
        with mock.patch.object(server, 'APP_DIR', app), mock.patch.object(server.subprocess, 'run') as run:
            rec = self.call('/api/exports', {'kind': 'vault'})
            run.reset_mock()  # the export itself may ask git
            out = self.call('/api/exports/reveal', {'name': rec['name']})
            path = os.path.realpath(os.path.join(app, 'versions', rec['name']))
            self.assertEqual(out, {'revealed': path})  # a zip is selected, never opened
            self.assertEqual(run.call_args.args[0], ['open', '-R', path] if sys.platform == 'darwin' else ['xdg-open', os.path.dirname(path)])
            run.reset_mock()
            for bad in ('../config.json', 'nope.zip', None):
                with self.subTest(bad=bad):
                    self.assertGreaterEqual(self.request('/api/exports/reveal', {'name': bad})[0], 400)
            run.assert_not_called()
    def test_the_installed_app_starts_claude_in_its_checkout(self):
        checkout, installed = os.path.realpath(tempfile.mkdtemp()), os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, checkout)
        self.addCleanup(shutil.rmtree, installed)
        for d in (checkout, installed):
            with open(os.path.join(d, 'server.py'), 'w') as f:
                f.write('#')
        with open(os.path.join(installed, 'install.json'), 'w') as f:
            json.dump({'source': checkout}, f)
        with mock.patch.object(server, 'APP_DIR', installed), \
                mock.patch.dict(server.APP.config, {'claude_cwd': '', 'claude_path_names': {'': 'This app'}}):
            preview = self.call('/api/item/claude/preview', {'key': None, 'instruction': 'hi'})
        self.assertEqual((preview['cwd'], preview['cwd_source'], preview['cwd_name']), (checkout, 'project', 'This app'))

    def test_the_installed_app_exports_its_checkout(self):
        checkout, installed = tempfile.mkdtemp(), tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, checkout, True)  # removed by the test itself
        self.addCleanup(shutil.rmtree, installed)
        with open(os.path.join(self.root, 'note.md'), 'w') as f:
            f.write('hi')
        for d in (checkout, installed):
            with open(os.path.join(d, 'server.py'), 'w') as f:
                f.write('#')
        with open(os.path.join(installed, 'install.json'), 'w') as f:
            json.dump({'source': checkout}, f)
        with mock.patch.object(server, 'APP_DIR', installed):
            rec = self.call('/api/exports', {'kind': 'system'})
            self.assertTrue(os.path.isfile(os.path.join(checkout, 'versions', rec['name'])))
            listing = self.call('/api/exports')
            self.assertEqual((listing['from'], listing['installed']), (checkout, True))
            shutil.rmtree(checkout)  # its checkout gone: only a vault, kept in the copy
            status, out = self.request('/api/exports', {'kind': 'agents'})
            self.assertEqual(status, 409)
            self.assertIn('only a vault', out['error'])
            rec = self.call('/api/exports', {'kind': 'vault'})
            self.assertTrue(os.path.isfile(os.path.join(installed, 'versions', rec['name'])))

    def test_an_unexpected_error_still_answers_json(self):
        with mock.patch.object(server.APP.store, 'trash', side_effect=AttributeError('boom')), \
                mock.patch.object(server.traceback, 'print_exc'):
            code, out = self.request('/api/trash')
        self.assertEqual(code, 500)
        self.assertIn('AttributeError', out['error'])
        self.assertEqual(self.call('/api/trash'), {'entries': [], 'attachments': 0, 'files': []})  # the server is still up


class ConfigTest(unittest.TestCase):
    """set_config reopens the store (cache dropped, migration re-run) only when root or folders change."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.a, self.b = os.path.join(tmp.name, 'a'), os.path.join(tmp.name, 'b')
        for root in (self.a, self.b):  # each vault has an initiative with embedded stories to migrate
            Store(root).create('initiative', 'Legacy', {'user_stories': [{'id': 'US-1', 'subject': 'Old story'}]})
            # A vault is migrated only when it matches its structure: every folder of the layout the test moves
            # it to (new tasks in todo/, so no tasks/ folder, which would be one the structure does not know).
            for folder in {**DEFAULT_FOLDERS, 'task': 'todo'}.values():
                os.makedirs(os.path.join(root, folder), exist_ok=True)
        cfg = os.path.join(tmp.name, 'config.json')
        with open(cfg, 'w', encoding='utf-8') as f:
            json.dump({'root': self.a}, f)
        patcher = mock.patch.object(server, 'CONFIG_PATH', cfg)
        patcher.start()
        self.addCleanup(patcher.stop)
        quiet = contextlib.redirect_stdout(io.StringIO())  # the migration reports what it moved
        quiet.__enter__()
        self.addCleanup(quiet.__exit__, None, None, None)
        self.cfg = cfg

    @staticmethod
    def stories(store):
        return [i for i in store.items() if i['type'] == 'story']

    def test_saved_folders_must_exist_and_hold_the_default(self):
        app = server.App()
        app.set_config({'claude_paths': [self.a, self.b + '/'], 'claude_cwd': self.b})
        self.assertEqual(app.config['claude_paths'], [self.a, self.b])
        self.assertEqual(app.config['claude_cwd'], self.b)
        app.set_config({'claude_paths': [self.a], 'claude_cwd': self.b})  # a default outside the list joins it
        self.assertEqual(app.config['claude_paths'], [self.a, self.b])
        app.set_config({'claude_paths': [self.a, self.b], 'claude_path_names': {self.a + '/': ' A ', '/elsewhere': 'X'}})
        self.assertEqual(app.config['claude_path_names'], {self.a: 'A'})  # tidied, and only for a saved folder
        for bad in ([self.a, os.path.join(self.a, 'missing')], ['relative/path'], [os.path.join(self.a, 'INI-0001-legacy.md')]):
            with self.assertRaises(server.StoreError) as cm:
                app.set_config({'claude_paths': bad})
            self.assertEqual(cm.exception.status, 400)
        with open(self.cfg, encoding='utf-8') as f:
            self.assertEqual(json.load(f)['claude_paths'], [self.a, self.b])  # the last good save is on disk
        # A config.json from before the list existed: its default folder becomes the one saved folder.
        with open(self.cfg, 'w', encoding='utf-8') as f:
            json.dump({'root': self.a, 'claude_cwd': self.b}, f)
        self.assertEqual(server.load_config()['claude_paths'], [self.b])

    def test_reopens_only_when_root_or_folders_change(self):
        app = server.App()
        self.assertEqual(self.stories(app.store), [])  # building the app (on import) migrates nothing
        first = app.store
        app.set_config({'work_kinds': ['Analysis', 'Coding'], 'claude_effort': 'high'})
        self.assertIs(app.store, first)
        self.assertEqual(app.config['work_kinds'], ['Analysis', 'Coding'])
        with open(self.cfg, encoding='utf-8') as f:
            self.assertEqual(json.load(f)['claude_effort'], 'high')
        app.set_config({'folders': {**app.config['folders'], 'task': 'todo'}})
        self.assertIsNot(app.store, first)
        self.assertEqual(app.store.folders['task'], 'todo')
        self.assertEqual(len(self.stories(app.store)), 1)  # a reopen migrates
        second = app.store
        app.set_config({'root': self.b})
        self.assertIsNot(app.store, second)
        self.assertEqual(app.store.root, os.path.realpath(self.b))
        self.assertEqual(len(self.stories(app.store)), 1)
        with self.assertRaises(server.StoreError):
            app.set_config({'work_kinds': []})
        self.assertEqual(app.store.root, os.path.realpath(self.b))


if __name__ == '__main__':
    unittest.main()
