"""The AI tab's Add existing session: Claude Code conversations started elsewhere (Terminal, Claude Desktop, the VS Code /
Cursor extension) read from their transcripts, added to an item by id, and one of an item's sessions starred as main."""
import json
import os
import re
import tempfile
import time
import unittest
from unittest import mock

import server
from tm.launch import recent_sessions, session_facts, session_folders, transcript_path
from tm.store import Store, StoreError, clean_claude_sessions

A = '0f1e2d3c-4b5a-4978-8a6b-00000000000a'
B = '0f1e2d3c-4b5a-4978-8a6b-00000000000b'
C = '0f1e2d3c-4b5a-4978-8a6b-00000000000c'


class AddedSessionsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = os.path.join(self.tmp.name, 'claude')
        self.cwd = os.path.join(self.tmp.name, 'repo')
        os.makedirs(self.cwd)
        env = mock.patch.dict(os.environ, {'CLAUDE_CONFIG_DIR': self.cfg})
        env.start()
        self.addCleanup(env.stop)
        self.addCleanup(self.tmp.cleanup)
        self.vault = os.path.join(self.tmp.name, 'vault')
        os.makedirs(self.vault)
        self.s = Store(self.vault)

    def transcript(self, sid, lines, cwd=None, mtime=None):
        folder = os.path.join(self.cfg, 'projects', re.sub(r'[^A-Za-z0-9]', '-', cwd or self.cwd))  # as Claude Code names it
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, f'{sid}.jsonl')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(''.join((l if isinstance(l, str) else json.dumps(l)) + '\n' for l in lines))
        if mtime:
            os.utime(path, (mtime, mtime))
        return path

    def user(self, text, **extra):
        return {'type': 'user', 'cwd': self.cwd, 'entrypoint': 'cli', 'timestamp': '2026-11-06T07:04:30.518Z',
                'sessionId': A, 'message': {'role': 'user', 'content': text}, **extra}

    def test_a_transcript_says_where_it_ran_what_it_is_called_and_who_started_it(self):
        path = self.transcript(A, [
            {'type': 'queue-operation'}, 'not json',
            self.user('<command-name>/clear</command-name>', isMeta=True),
            self.user([{'type': 'text', 'text': '<system-reminder>x</system-reminder>'}, {'type': 'text', 'text': ' Fix   the\nlogin '}]),
            {'type': 'ai-title', 'aiTitle': 'Login fix'},
        ])
        f = session_facts(path)
        self.assertEqual((f['id'], f['cwd'], f['source'], f['title']), (A, self.cwd, 'cli', 'Login fix'))
        self.assertRegex(f['started'], r'^2026-11-0\dT\d\d:\d\d$')
        # a /rename wins over Claude's own title, the last one given; with neither, the first thing asked
        self.transcript(A, [self.user('Fix the login'), {'type': 'custom-title', 'customTitle': 'old'},
                            {'type': 'ai-title', 'aiTitle': 'Login fix'}, {'type': 'custom-title', 'customTitle': 'Login, take 2'}])
        self.assertEqual(session_facts(path)['title'], 'Login, take 2')
        self.transcript(A, [self.user('Fix the login')])
        self.assertEqual(session_facts(path)['title'], 'Fix the login')
        # nothing said, or no folder: nothing to resume
        self.transcript(B, [{'type': 'queue-operation'}])
        self.assertIsNone(session_facts(transcript_path(B, '')))

    def test_a_long_transcript_is_read_at_both_ends(self):
        path = self.transcript(A, [self.user('Start'), *[{'type': 'assistant', 'pad': 'x' * 1000}] * 200,
                                   {'type': 'custom-title', 'customTitle': 'Renamed at the end'}])
        self.assertGreater(os.path.getsize(path), 128 * 1024)
        self.assertEqual(session_facts(path)['title'], 'Renamed at the end')

    def test_the_newest_come_first_and_the_empty_ones_are_left_out(self):
        now = time.time()
        self.transcript(A, [self.user('old')], mtime=now - 100)
        self.transcript(B, [self.user('new', entrypoint='claude-desktop')], cwd=os.path.join(self.tmp.name, 'other'), mtime=now)
        self.transcript(C, [{'type': 'queue-operation'}], mtime=now + 10)
        self.assertEqual([(f['id'], f['source']) for f in recent_sessions()], [(B, 'claude-desktop'), (A, 'cli')])
        self.assertEqual(len(recent_sessions(limit=1)), 1)

    def test_the_folders_it_ran_in_and_all_of_one_folders_sessions(self):
        now = time.time()
        other = os.path.join(self.tmp.name, 'other.app')
        self.transcript(A, [self.user('old one')], mtime=now - 1000)
        self.transcript(B, [self.user('newer')], mtime=now - 10)
        self.transcript(C, [{**self.user('elsewhere'), 'cwd': other}], cwd=other, mtime=now)
        folders = session_folders()
        self.assertEqual([(f['cwd'], f['count']) for f in folders], [(other, 1), (self.cwd, 2)])  # the last written first
        self.assertEqual([f['id'] for f in recent_sessions(cwd=self.cwd)], [B, A])
        self.assertEqual([f['id'] for f in recent_sessions(cwd=other)], [C])  # its name on disk lost the dot: read back
        self.assertEqual(recent_sessions(cwd=os.path.join(self.tmp.name, 'nowhere')), [])
        self.assertEqual([f['id'] for f in server.recent_claude_sessions(self.s, self.cwd)['sessions']], [B, A])

    def test_one_added_by_id_takes_its_folder_and_title_from_its_transcript(self):
        self.s.create('task', 'T')
        self.transcript(A, [self.user('Fix the login', entrypoint='claude-vscode')])
        it = server.add_existing_claude(self.s, 'TSK-0001', A.upper())
        entry = it['fields']['claude_sessions'][0]
        self.assertEqual({k: entry[k] for k in ('id', 'cwd', 'instruction', 'source')},
                         {'id': A, 'cwd': self.cwd, 'instruction': 'Fix the login', 'source': 'claude-vscode'})
        self.assertEqual(self.s.claude_session('TSK-0001', A)['cwd'], self.cwd)  # what a resume runs from
        with self.assertRaises(StoreError) as cm:  # once per item
            server.add_existing_claude(self.s, 'TSK-0001', A)
        self.assertEqual(cm.exception.status, 409)
        for bad in (B, 'x; rm -rf ~', ''):  # no transcript of it on this computer
            with self.subTest(bad=bad), self.assertRaises(StoreError) as cm:
                server.add_existing_claude(self.s, 'TSK-0001', bad)
            self.assertEqual(cm.exception.status, 404)
        listed = server.recent_claude_sessions(self.s)['sessions']
        self.assertEqual([(f['id'], f['listed_on']) for f in listed], [(A, 'TSK-0001')])

    def test_one_session_of_an_item_is_its_main_one(self):
        self.s.create('task', 'T')
        for sid in (A, B):
            self.s.add_claude_session('TSK-0001', {'id': sid, 'cwd': self.cwd})
        self.assertEqual([s.get('main') for s in self.s.set_main_claude_session('TSK-0001', B)['fields']['claude_sessions']], [None, True])
        self.assertEqual([s.get('main') for s in self.s.set_main_claude_session('TSK-0001', A)['fields']['claude_sessions']], [True, None])
        with self.assertRaises(StoreError) as cm:
            self.s.set_main_claude_session('TSK-0001', C)
        self.assertEqual(cm.exception.status, 404)
        # only a true main is kept; where one came from is kept, cut short
        kept = clean_claude_sessions([{'id': A, 'cwd': '/x', 'main': 'yes', 'source': 'cli' + 'x' * 60}])[0]
        self.assertNotIn('main', kept)
        self.assertEqual(len(kept['source']), 40)


if __name__ == '__main__':
    unittest.main()
