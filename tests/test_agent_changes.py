"""An agent run's Changes (tm/runchanges.py, server.py agent_run_changes / agent_run_diff), on a temp git repository."""
import os
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

import server
from tests.test_agent_commands import AgentsBase, write
from tm import agentruns, runchanges
from tm.store import StoreError

GIT_ENV = {'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@example.com', 'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@example.com',
           'GIT_CONFIG_NOSYSTEM': '1'}


def git(cwd, *args):
    subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True)


def repo(at):
    """A repository with one commit: a.txt, gone.txt, and a file it ignores."""
    os.makedirs(at)
    git(at, 'init', '-q')
    write(os.path.join(at, 'a.txt'), 'one\ntwo\n')
    write(os.path.join(at, 'gone.txt'), 'bye\n')
    write(os.path.join(at, '.gitignore'), 'ignored/\n')
    git(at, 'add', '-A')
    git(at, 'commit', '-q', '-m', 'init')
    return at


class RunChangesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='tm changes ')
        self.addCleanup(shutil.rmtree, self.tmp, True)
        patcher = mock.patch.dict(os.environ, GIT_ENV)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.repo = repo(os.path.join(self.tmp, 'repo'))

    def test_what_changed_since_the_snapshot_and_only_that(self):
        write(os.path.join(self.repo, 'a.txt'), 'one\nTWO\n')  # changed before the run: in the snapshot, not a change
        write(os.path.join(self.repo, 'was-there.txt'), 'x\n')  # untracked before the run: left out
        snap = runchanges.snapshot(self.repo)
        self.assertEqual(snap['untracked'], ['was-there.txt'])
        self.assertEqual(subprocess.run(['git', 'stash', 'list'], cwd=self.repo, capture_output=True, text=True).stdout, '')  # no stash made
        # The run:
        write(os.path.join(self.repo, 'a.txt'), 'one\nTWO\nthree\n')
        os.remove(os.path.join(self.repo, 'gone.txt'))
        write(os.path.join(self.repo, 'notes', 'new.md'), 'hello\nworld\n')
        write(os.path.join(self.repo, 'was-there.txt'), 'x\ny\n')
        write(os.path.join(self.repo, 'ignored', 'cache'), 'z\n')
        with open(os.path.join(self.repo, 'blob.bin'), 'wb') as f:
            f.write(b'\0\1\2')
        os.symlink('/dev/zero', os.path.join(self.repo, 'zero'))  # a link is never followed: it could lead to a device
        got = runchanges.changes(self.repo, snap['base'], snap['untracked'])
        self.assertEqual([(f['path'], f['status'], f['added'], f['deleted'], f['binary']) for f in got], [
            ('a.txt', 'M', 1, 0, False), ('blob.bin', 'A', None, None, True), ('gone.txt', 'D', 0, 1, False), ('notes/new.md', 'A', 2, 0, False),
            ('zero', 'A', None, None, False)])
        d = runchanges.diff(self.repo, snap['base'], snap['untracked'], 'a.txt')
        self.assertIn('+three', d['diff'])
        self.assertNotIn('-two', d['diff'])  # the change made before the run is the base, not the run's
        self.assertIn('+world', runchanges.diff(self.repo, snap['base'], snap['untracked'], 'notes/new.md')['diff'])
        for outside in ('was-there.txt', '../x', '/etc/passwd', 'ignored/cache', ''):
            self.assertIsNone(runchanges.diff(self.repo, snap['base'], snap['untracked'], outside))

    def test_a_clean_tree_snapshots_head_and_a_plain_folder_nothing(self):
        snap = runchanges.snapshot(self.repo)
        head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=self.repo, capture_output=True, text=True).stdout.strip()
        self.assertEqual(snap, {'base': head, 'untracked': []})
        plain = os.path.join(self.tmp, 'plain')
        os.makedirs(plain)
        self.assertEqual(runchanges.snapshot(plain), {})
        self.assertIsNone(runchanges.changes(plain, head))
        self.assertIsNone(runchanges.changes(self.repo, 'f' * 40))  # a snapshot git no longer has


class RunChangesRouteTest(AgentsBase):
    def test_a_run_lists_its_changes_and_diffs_only_those(self):
        with mock.patch.dict(os.environ, GIT_ENV):
            at = repo(os.path.join(self.tmp, 'repo'))
            sid = '12345678-1234-4123-8123-123456789abc'
            agentruns.add(server.runs_path(), {'id': sid, 'cwd': at, 'cmd': 'dev:status', **runchanges.snapshot(at)})
            write(os.path.join(at, 'a.txt'), 'one\n')
            got = server.agent_run_changes(sid)
            self.assertEqual((got['git'], [f['path'] for f in got['files']]), (True, ['a.txt']))
            self.assertIn('-two', server.agent_run_diff(sid, 'a.txt')['diff'])
            with self.assertRaises(StoreError) as cm:
                server.agent_run_diff(sid, 'gone.txt')
            self.assertEqual(cm.exception.status, 404)
            plain = '12345678-1234-4123-8123-000000000001'
            agentruns.add(server.runs_path(), {'id': plain, 'cwd': self.tmp, 'cmd': 'dev:status'})
            self.assertEqual(server.agent_run_changes(plain), {'git': False, 'files': []})
            with self.assertRaises(StoreError):
                server.agent_run_changes('12345678-1234-4123-8123-000000000009')


if __name__ == '__main__':
    unittest.main()
