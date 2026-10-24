import contextlib
import io
import json
import os
import shutil
import tempfile
import threading
import unittest
from datetime import datetime, timedelta
from http.server import ThreadingHTTPServer
from unittest import mock
from urllib.request import Request, urlopen

import server
from tm import journal
from tm.store import META_DIR, Store

SAMPLE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sample-vault')


class JournalTest(unittest.TestCase):
    """The activity journal (tm/journal.py): one file per day of what was done through the server, and by whom."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.meta = os.path.join(self.tmp, META_DIR)

    def test_the_same_thing_done_again_soon_is_one_entry_a_status_change_never(self):
        t0 = datetime(2026, 10, 23, 9, 0)
        edit = {'action': 'edited', 'id': 'TSK-0001', 'type': 'task', 'title': 'T', 'detail': 'description'}
        journal.record(self.meta, 'app', edit, t0)
        journal.record(self.meta, 'app', edit, t0 + timedelta(minutes=4))
        journal.record(self.meta, 'app', edit, t0 + timedelta(minutes=13))  # 9 minutes after the last one
        journal.record(self.meta, 'app', edit, t0 + timedelta(minutes=40))  # too late: a new entry
        status = {**edit, 'detail': 'status: ToDo → Done'}
        journal.record(self.meta, 'app', status, t0 + timedelta(minutes=41))
        journal.record(self.meta, 'app', status, t0 + timedelta(minutes=42))
        entries = journal.read_day(self.meta, '2026-10-23')
        self.assertEqual([(e['at'], e.get('until'), e.get('count')) for e in entries],
                         [('09:00', '09:13', 3), ('09:40', None, None), ('09:41', None, None), ('09:42', None, None)])
        with open(journal.day_path(self.meta, '2026-10-23'), encoding='utf-8') as f:
            text = f.read()
        self.assertIn('type: journal', text)
        self.assertIn('- 09:00–09:13 · app · edited TSK-0001 «T» — description — ×3', text)

    def test_what_a_route_did_is_said_in_words(self):
        before = {'id': 'TSK-0001', 'type': 'task', 'title': 'T', 'body_rev': 'a', 'fields': {'status': 'ToDo', 'labels': [], 'updated_at': 'x'}}
        after = {'id': 'TSK-0001', 'type': 'task', 'title': 'T', 'body_rev': 'b', 'fields': {'status': 'Done', 'labels': ['x'], 'updated_at': 'y'}}
        e = journal.describe('/api/item/update', {'key': 'TSK-0001', 'body': 'new'}, before, after)
        self.assertEqual((e['action'], e['detail']), ('edited', 'labels, status: ToDo → Done, description'))
        self.assertIsNone(journal.describe('/api/item/update', {'key': 'TSK-0001'}, before, before))  # nothing changed
        self.assertEqual(journal.describe('/api/item/comment', {'key': 'TSK-0001', 'text': 'Looks good'}, before, {})['detail'], 'Looks good')
        for quiet in ('/api/pins', '/api/sidebar', '/api/board', '/api/today', '/api/files/order', '/api/statuses'):
            self.assertIsNone(journal.describe(quiet, {}, None, {}), quiet)
        self.assertEqual(journal.actor_of(None), 'api')
        self.assertEqual(journal.actor_of('claude:1234-abcd'), 'claude:1234-abcd')
        self.assertEqual(journal.actor_of('bad actor!'), 'api')


class JournalOverHttpTest(unittest.TestCase):
    """Only the server writes the journal: the page's requests are `app`'s, a Store used in-process (a sync, a
    command) writes nothing to it."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.root = os.path.join(self.tmp, 'vault')
        shutil.copytree(SAMPLE, self.root)
        cfg = os.path.join(self.tmp, 'config.json')
        with open(cfg, 'w', encoding='utf-8') as f:
            json.dump({'root': self.root, 'default_vault': 'v', 'vaults': [{'id': 'v', 'name': 'V', 'path': self.root, 'structure': 'folders'}]}, f)
        patcher = mock.patch.object(server, 'CONFIG_PATH', cfg)
        patcher.start()
        self.addCleanup(patcher.stop)
        quiet = contextlib.redirect_stdout(io.StringIO())
        quiet.__enter__()
        self.addCleanup(quiet.__exit__, None, None, None)
        app = server.App()
        patcher = mock.patch.object(server, 'APP', app)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.base = f'http://127.0.0.1:{self.httpd.server_address[1]}'
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)

    def post(self, path, body, actor='app'):
        headers = {'Content-Type': 'application/json', 'X-Task-Manager': '1', 'X-TM-Vault': 'v', **({'X-TM-Actor': actor} if actor else {})}
        with urlopen(Request(self.base + path, data=json.dumps(body).encode(), headers=headers)) as res:
            return json.loads(res.read())

    def entries(self):
        return journal.read_day(os.path.join(self.root, META_DIR), datetime.now().strftime('%Y-%m-%d'))

    def test_the_pages_actions_are_journaled_as_app_and_the_rest_as_api(self):
        made = self.post('/api/item/create', {'type': 'task', 'subject': 'Write the plan'})
        self.post('/api/item/update', {'key': made['key'], 'values': {'status': 'Done'}})
        self.post('/api/item/comment', {'key': made['key'], 'text': 'Done today'}, actor=None)
        self.post('/api/pins', {'items': [made['id']]})
        got = [(e['actor'], e['action'], e.get('id'), e.get('detail')) for e in self.entries()]
        self.assertEqual(got[0], ('app', 'created', made['id'], None))
        self.assertEqual(got[1][:3], ('app', 'edited', made['id']))
        self.assertIn('status: ', got[1][3])
        self.assertEqual(got[2], ('api', 'commented', made['id'], 'Done today'))
        self.assertEqual(len(got), 3)  # pinning is not work

    def test_a_store_used_in_process_writes_no_journal(self):
        Store(self.root).create('task', 'By a sync')
        self.assertEqual(self.entries(), [])
        self.assertFalse(os.path.exists(os.path.join(self.root, META_DIR, journal.JOURNAL_DIR)))


if __name__ == '__main__':
    unittest.main()
