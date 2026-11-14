"""The vault's index (tm/index.py): what the Store reads through it, what it reports as changed, what it keeps on disk,
and the routes that use it (GET /api/vault/changes, POST /api/vault/reload)."""
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import server
from tm import index as tm_index
from tm.index import ACTOR, VaultIndex, fold
from tm.store import Store

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(APP_DIR, 'tools'))
from serve_sample import SAMPLE_VAULT, copy_sample  # noqa: E402


def write(root, rel, text):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


class IndexBase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = tmp.name
        self.root = os.path.realpath(copy_sample(SAMPLE_VAULT, os.path.join(self.tmp, 'vault')))
        env = mock.patch.dict(os.environ, {'TM_CACHE_DIR': os.path.join(self.tmp, 'cache')})
        env.start()
        self.addCleanup(env.stop)
        write(self.root, 'Docs/Guides/Alpha.md', '---\ntags: [x]\n---\n# Alpha\n\nSee [[Beta]] and [[beta#Usage|the usage]].\n')
        write(self.root, 'Docs/Guides/Beta.md', '# Beta\n\nCafé con leche. Nothing links back from here.\n')
        write(self.root, 'Docs/Guides/Gamma.md', '# Gamma\n\nAlso [[ Beta ]], twice: [[Beta]].\nAnd [[Alpha]].\n')
        self.s = Store(self.root, structure='ticketing')


class ReadsTest(IndexBase):
    """What the Store answers through the index is what reading every file would answer."""

    def naive_search(self, query):
        q = fold(query)
        out = []
        for e in self.s.files()['entries']:
            if e['kind'] != 'file':
                continue
            try:
                with open(os.path.join(self.root, e['path']), 'rb') as f:
                    raw = f.read()
                if b'\x00' in raw:
                    continue
                text = raw.decode('utf-8')
            except (OSError, UnicodeDecodeError):
                continue
            out += [(e['path'], n) for n, line in enumerate(text.splitlines(), 1) if q in fold(line)][:self.s.SEARCH_PER_FILE]
        return out[:self.s.SEARCH_MAX]

    def naive_backlinks(self, rel):
        stem = os.path.splitext(os.path.basename(rel))[0]
        link = re.compile(r'\[\[\s*' + re.escape(stem) + r'\s*(?:[#|][^\]\n]*)?\]\]', re.IGNORECASE)
        out = []
        for e in self.s.files()['entries']:
            if e['kind'] == 'file' and e['path'] != rel and e['path'].lower().endswith('.md'):
                with open(os.path.join(self.root, e['path']), encoding='utf-8') as f:
                    hits = [n for n, line in enumerate(f.read().splitlines(), 1) if link.search(line)]
                if hits:
                    out.append((e['path'], hits[0], len(hits)))
        return out

    def test_search_finds_what_reading_every_file_finds(self):
        for q in ('cafe', 'BETA', 'the', 'status'):
            got = [(r['path'], r['line']) for r in self.s.search_files(q)['results']]
            self.assertEqual(got, self.naive_search(q), q)

    def test_backlinks_are_the_ones_reading_every_file_gives(self):
        for rel in ('Docs/Guides/Beta.md', 'Docs/Guides/Alpha.md', 'Docs/Guides/Gamma.md'):
            got = [(x['path'], x['line'], x['count']) for x in self.s.backlinks(rel)['links']]
            self.assertEqual(got, self.naive_backlinks(rel), rel)
        self.assertEqual({x['path']: x['count'] for x in self.s.backlinks('Docs/Guides/Beta.md')['links']},
                         {'Docs/Guides/Alpha.md': 1, 'Docs/Guides/Gamma.md': 1})  # lines that link: both of Gamma's on one

    def test_files_list_every_folder_and_file_with_hidden_ones_only_on_request(self):
        write(self.root, '.obsidian/app.json', '{}')
        shown = {e['path'] for e in self.s.files()['entries']}
        self.assertIn('Docs/Guides/Beta.md', shown)
        self.assertFalse(any(p.startswith('.') for p in shown))
        hidden = {e['path']: e for e in self.s.files(hidden=True)['entries']}
        self.assertIn('.obsidian/app.json', hidden)
        self.assertTrue(hidden['.task-manager']['sealed'])
        self.assertFalse(any(p.startswith('.task-manager/') for p in hidden))  # sealed: never walked into

    def test_a_file_written_by_another_program_is_seen_at_once_when_no_page_polls(self):
        before = len(self.s.items())
        write(self.root, 'Docs/Guides/Delta.md', '# Delta\n\n[[Beta]]\n')
        self.assertIn('Docs/Guides/Delta.md', {x['path'] for x in self.s.backlinks('Docs/Guides/Beta.md')['links']})
        task = next(it for it in self.s.items() if it['type'] == 'task')
        shutil.copy(os.path.join(self.root, task['path']), os.path.join(self.root, os.path.dirname(task['path']), 'Copy.md'))
        self.assertEqual(len(self.s.items()), before + 1)

    def test_a_file_icloud_has_not_downloaded_is_listed_but_never_read(self):
        self.s.index.watch(60)
        self.s.index.max_age = 60
        entries = self.s.index.entries()
        rel = 'Docs/Guides/Beta.md'
        entries[rel] = entries[rel]._replace(dataless=True)
        self.s.index._said.pop(rel, None)
        with mock.patch('builtins.open', side_effect=AssertionError('read')) as opened:
            self.assertIsNone(self.s.index.text(rel))
            self.assertIsNone(self.s.index.lines(rel))
        opened.assert_not_called()
        self.assertIn(rel, {e['path'] for e in self.s.files()['entries']})
        self.assertNotIn(rel, {r['path'] for r in self.s.search_files('leche')['results']})

    def test_a_symlink_out_of_the_vault_is_never_read(self):
        outside = os.path.join(self.tmp, 'secret.md')
        write(self.tmp, 'secret.md', 'top secret words\n')
        os.symlink(outside, os.path.join(self.root, 'Docs', 'link.md'))
        self.assertEqual(self.s.search_files('secret words')['results'], [])


class ChangesTest(IndexBase):
    def setUp(self):
        super().setUp()
        self.addCleanup(setattr, ACTOR, 'tab', None)
        self.s.index.watch(60)
        self.s.index.entries()  # as the route does: walk, then answer
        self.start = self.s.index.changes()  # where to start: no paths
        self.assertEqual(self.start['paths'], [])

    def since(self, exclude=None):
        self.s.index.entries(max_age=0)
        return self.s.index.changes(self.start['seq'], self.start['epoch'], exclude)

    def test_what_another_program_writes_is_reported_once_watched(self):
        write(self.root, 'Docs/Guides/Delta.md', '# Delta\n')
        os.remove(os.path.join(self.root, 'Docs/Guides/Gamma.md'))
        self.assertEqual(set(self.since()['paths']), {'Docs/Guides/Delta.md', 'Docs/Guides/Gamma.md'})

    def test_while_watched_a_read_trusts_the_last_walk_and_a_write_reads_fresh(self):
        before = len(self.s.items())
        write(self.root, 'Docs/Guides/Delta.md', '# Delta\n[[Beta]]\n')
        self.assertNotIn('Docs/Guides/Delta.md', {e['path'] for e in self.s.files()['entries']})  # within max_age
        task = self.s.create('task', 'Written through the store')
        self.assertEqual(len(self.s.items()), before + 1)  # the write walked again: its file, and Delta, are there
        self.assertIn('Docs/Guides/Delta.md', {e['path'] for e in self.s.files()['entries']})
        self.assertIn(task['path'], self.since()['paths'])

    def test_a_walk_from_before_the_mac_slept_is_not_trusted(self):
        # macOS's monotonic clock stops while the Mac sleeps: on waking, only the wall clock says hours went by.
        write(self.root, 'Docs/Guides/Delta.md', '# Delta\n')
        self.assertNotIn('Docs/Guides/Delta.md', {e['path'] for e in self.s.files()['entries']})  # within max_age
        real = tm_index.time.time
        with mock.patch.object(tm_index.time, 'time', lambda: real() + 8 * 3600):
            self.assertIn('Docs/Guides/Delta.md', {e['path'] for e in self.s.files()['entries']})
            self.assertFalse(self.s.index.watched)  # nor the poll from before the night
        with mock.patch.object(tm_index.time, 'time', lambda: real() - 60):  # a clock set back: no trust either
            self.s.index.watch(60)
            write(self.root, 'Docs/Guides/Epsilon.md', '# Epsilon\n')
            self.assertIn('Docs/Guides/Epsilon.md', {e['path'] for e in self.s.files()['entries']})

    def test_a_tab_is_not_told_of_its_own_writes(self):
        write(self.root, 'Docs/Guides/Delta.md', '# Delta\n')  # somebody else's, before the write
        ACTOR.tab = 'tab1'
        task = self.s.create('task', 'Mine')
        ACTOR.tab = None
        mine = self.since(exclude='tab1')['paths']
        self.assertNotIn(task['path'], mine)
        self.assertIn('Docs/Guides/Delta.md', mine)
        self.assertIn(task['path'], self.since(exclude='tab2')['paths'])

    def test_another_epoch_or_a_log_that_no_longer_reaches_says_more(self):
        self.assertEqual(self.s.index.changes(0, 'other')['paths'], [])
        with mock.patch.object(tm_index, 'LOG_MAX', 3):
            idx = VaultIndex(self.root, os.path.join(self.tmp, 'c.json'))
            idx.watch(60)
            idx.refresh()
            first = idx.changes()
            idx._log = tm_index.deque(maxlen=3)
            for i in range(5):
                write(self.root, f'Docs/Many/{i}.md', 'x')
            idx.refresh()
            self.assertTrue(idx.changes(first['seq'], first['epoch'])['more'])


class KeptTest(IndexBase):
    def test_what_files_link_to_is_kept_for_the_next_run(self):
        self.s.backlinks('Docs/Guides/Beta.md')
        self.assertTrue(self.s.index.save(force=True))
        with open(self.s.index.cache_file, encoding='utf-8') as f:
            kept = json.load(f)
        self.assertEqual(kept['files']['Docs/Guides/Gamma.md'][3]['link_keys'], ['alpha', 'beta'])
        again = Store(self.root, structure='ticketing')
        again.index.refresh()
        with mock.patch.object(VaultIndex, '_read', side_effect=AssertionError('read')):
            self.assertEqual(again.index.value('Docs/Guides/Gamma.md', 'link_keys', tm_index.link_keys), ['alpha', 'beta'])

    def test_a_kept_file_that_changed_since_is_read_again(self):
        self.s.backlinks('Docs/Guides/Beta.md')
        self.s.index.save(force=True)
        write(self.root, 'Docs/Guides/Gamma.md', '# Gamma\n\nNo links now, a longer text than before.\n')
        again = Store(self.root, structure='ticketing')
        self.assertEqual({x['path'] for x in again.backlinks('Docs/Guides/Beta.md')['links']}, {'Docs/Guides/Alpha.md'})

    def test_a_corrupt_or_old_kept_file_is_ignored_and_written_anew(self):
        os.makedirs(os.path.dirname(self.s.index.cache_file), exist_ok=True)
        for junk in ('{not json', json.dumps({'version': 0, 'root': self.root, 'files': {}}), '[]'):
            with open(self.s.index.cache_file, 'w', encoding='utf-8') as f:
                f.write(junk)
            s = Store(self.root, structure='ticketing')
            self.assertEqual(len(s.backlinks('Docs/Guides/Beta.md')['links']), 2)
            self.assertTrue(s.index.save(force=True))
            with open(s.index.cache_file, encoding='utf-8') as f:
                self.assertEqual(json.load(f)['version'], tm_index.VERSION)

    def test_the_kept_file_is_outside_the_vault(self):
        self.s.backlinks('Docs/Guides/Beta.md')
        self.s.index.save(force=True)
        self.assertFalse(self.s.index.cache_file.startswith(self.root))
        self.assertTrue(os.path.isfile(self.s.index.cache_file))


class RoutesTest(unittest.TestCase):
    """GET /api/vault/changes and POST /api/vault/reload, through the server."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = tmp.name
        self.root = os.path.realpath(copy_sample(SAMPLE_VAULT, os.path.join(self.tmp, 'vault')))
        cfg = os.path.join(self.tmp, 'config.json')
        with open(cfg, 'w', encoding='utf-8') as f:
            json.dump({'root': self.root, 'default_vault': 's', 'vaults': [{'id': 's', 'name': 'S', 'path': self.root, 'structure': 'ticketing'}]}, f)
        for patcher in (mock.patch.object(server, 'CONFIG_PATH', cfg),
                        mock.patch.dict(os.environ, {'TM_CACHE_DIR': os.path.join(self.tmp, 'cache')})):
            patcher.start()
            self.addCleanup(patcher.stop)
        app = mock.patch.object(server, 'APP', server.App())
        app.start()
        self.addCleanup(app.stop)
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.base = f'http://127.0.0.1:{self.httpd.server_address[1]}'
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)

    def request(self, path, body=None, header=True, tab=None):
        headers = {'Content-Type': 'application/json', 'X-TM-Vault': 's'}
        if header:
            headers['X-Task-Manager'] = '1'
        if tab:
            headers['X-TM-Tab'] = tab
        req = Request(self.base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            with urlopen(req) as res:
                return res.status, json.loads(res.read())
        except HTTPError as e:
            with e:
                return e.code, json.loads(e.read())

    def test_the_page_is_told_what_changed_but_its_own_writes(self):
        code, first = self.request('/api/vault/changes?tab=t1')
        self.assertEqual((code, first['paths']), (200, []))
        write(self.root, 'Docs/Outside.md', '# Written by another program\n')
        code, made = self.request('/api/item/create', {'type': 'task', 'subject': 'From this tab'}, tab='t1')
        self.assertEqual(code, 200, made)
        q = f"/api/vault/changes?tab=t1&since={first['seq']}&epoch={first['epoch']}"
        paths = self.request(q)[1]['paths']
        self.assertIn('Docs/Outside.md', paths)
        self.assertFalse(any(p.startswith('Tasks/') for p in paths), paths)
        other = self.request(q.replace('tab=t1', 'tab=t2'))[1]['paths']
        self.assertTrue(any(p.startswith('Tasks/') for p in other), other)

    def test_reload_from_disk_opens_the_vault_again_and_says_what_it_read(self):
        before = server.APP.store_for('s')
        _, first = self.request('/api/vault/changes')
        self.assertEqual(self.request('/api/vault/reload', {}, header=False)[0], 403)  # a POST needs the header
        code, out = self.request('/api/vault/reload', {})
        self.assertEqual(code, 200, out)
        self.assertIsNot(server.APP.store_for('s'), before)
        self.assertEqual(out['items'], len(server.APP.store_for('s').items()))
        self.assertGreater(out['files'], out['items'])
        self.assertIsInstance(out['ms'], int)
        self.assertNotEqual(self.request('/api/vault/changes')[1]['epoch'], first['epoch'])  # the page starts again

    def test_reload_waits_for_a_write_of_this_process(self):
        store = server.APP.store_for('s')
        done = []
        with store._lock:
            t = threading.Thread(target=lambda: done.append(self.request('/api/vault/reload', {})[0]))
            t.start()
            t.join(0.3)
            self.assertEqual(done, [])  # the store's lock is held: the reload waits for it
        t.join(10)
        self.assertEqual(done, [200])


if __name__ == '__main__':
    unittest.main()
