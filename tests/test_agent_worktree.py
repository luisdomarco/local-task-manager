"""An agent run in a worktree of its own (tm/runworktree.py, server.py where='worktree'), on temp git repositories."""
import os
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

import server
from tests.test_agent_changes import GIT_ENV, git
from tests.test_agent_commands import AgentsBase, write
from tm import commands, runworktree
from tm.store import StoreError

COMMAND = '---\ndescription: Touch\n---\nWrite $ARGUMENTS\n'


def branches(repo):
    out = subprocess.run(['git', 'branch', '--format=%(refname:short)'], cwd=repo, capture_output=True, text=True).stdout
    return sorted(out.split())


class RunWorktreeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix='tm worktree '))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        patcher = mock.patch.dict(os.environ, GIT_ENV)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.repo = os.path.join(self.tmp, 'repo')
        write(os.path.join(self.repo, 'agents', '.claude', 'commands', 'qa', 'touch.md'), COMMAND)
        write(os.path.join(self.repo, 'README.md'), 'hi\n')
        git(self.repo, 'init', '-q')
        git(self.repo, 'add', '-A')
        git(self.repo, 'commit', '-q', '-m', 'init')
        self.folder = os.path.join(self.repo, 'agents')  # an agent folder inside the repository
        self.cmd = commands.find(self.folder, 'qa:touch')

    def test_a_worktree_on_its_own_branch_where_the_folder_is(self):
        wt = runworktree.create(self.folder, self.cmd, 'qa:touch')
        self.assertTrue(wt['worktree'].startswith(os.path.join(self.repo, '.claude', 'worktrees', 'agents-')))
        self.assertRegex(wt['branch'], r'^agents/qa-touch-[0-9a-f]{6}$')
        self.assertEqual(wt['cwd'], os.path.join(wt['worktree'], 'agents'))
        self.assertTrue(os.path.isfile(os.path.join(wt['cwd'], '.claude', 'commands', 'qa', 'touch.md')))
        self.assertIn(wt['branch'], branches(self.repo))
        # Taken away clean; then one with changes is kept unless forced; the branches stay.
        runworktree.remove(wt['worktree'])
        self.assertFalse(os.path.exists(wt['worktree']))
        other = runworktree.create(self.folder, self.cmd, 'qa:touch')
        write(os.path.join(other['cwd'], 'new.txt'), 'x\n')
        with self.assertRaises(runworktree.WorktreeError) as cm:
            runworktree.remove(other['worktree'])
        self.assertTrue(cm.exception.dirty)
        self.assertTrue(os.path.isdir(other['worktree']))
        runworktree.remove(other['worktree'], force=True)
        self.assertFalse(os.path.exists(other['worktree']))
        self.assertIn(wt['branch'], branches(self.repo))
        self.assertIn(other['branch'], branches(self.repo))
        runworktree.remove(other['worktree'])  # gone already: nothing to do

    def test_only_a_committed_command_gets_a_worktree(self):
        write(self.cmd, COMMAND + 'More\n')  # changed and not committed
        with self.assertRaisesRegex(runworktree.WorktreeError, 'not committed'):
            runworktree.create(self.folder, self.cmd, 'qa:touch')
        new = os.path.join(self.folder, '.claude', 'commands', 'qa', 'new.md')
        write(new, COMMAND)  # never committed
        with self.assertRaisesRegex(runworktree.WorktreeError, 'not committed'):
            runworktree.create(self.folder, new, 'qa:new')
        plain = os.path.join(self.tmp, 'plain')
        write(os.path.join(plain, '.claude', 'commands', 'x.md'), COMMAND)
        with self.assertRaisesRegex(runworktree.WorktreeError, 'not in a git repository'):
            runworktree.create(plain, os.path.join(plain, '.claude', 'commands', 'x.md'), 'x')
        self.assertFalse(os.path.exists(os.path.join(self.repo, '.claude', 'worktrees')))  # nothing made on the way

    def test_commands_reached_through_a_committed_link(self):
        shared = os.path.join(self.tmp, 'shared commands')  # outside the repository, as this tree links its .claude
        write(os.path.join(shared, 'hello.md'), COMMAND)
        linked = os.path.join(self.repo, 'linked')
        os.makedirs(os.path.join(linked, '.claude'))
        os.symlink(shared, os.path.join(linked, '.claude', 'commands'))
        cmd = commands.find(linked, 'hello')
        with self.assertRaisesRegex(runworktree.WorktreeError, 'not committed'):  # the link itself not committed yet
            runworktree.create(linked, cmd, 'hello')
        git(self.repo, 'add', '-A')
        git(self.repo, 'commit', '-q', '-m', 'link')
        wt = runworktree.create(linked, cmd, 'hello')
        self.assertTrue(os.path.isfile(os.path.join(wt['cwd'], '.claude', 'commands', 'hello.md')))


class WorktreeRunTest(AgentsBase):
    def setUp(self):
        super().setUp()
        patcher = mock.patch.dict(os.environ, GIT_ENV)
        patcher.start()
        self.addCleanup(patcher.stop)
        git(self.agents, 'init', '-q')
        git(self.agents, 'add', '-A')
        git(self.agents, 'commit', '-q', '-m', 'init')

    def test_a_run_in_a_worktree_is_recorded_with_it_and_it_is_taken_away(self):
        chat = mock.Mock(stopped=False, last_result=None, busy=False, pending={})
        chat.info.return_value = {'id': 'x'}
        with mock.patch.object(server, '_spawn_chat', return_value=chat) as spawn:
            sid = server.run_agent(self.app.store, self.id, 'dev:status', 'STY-1', '', '', '', 'worktree')['session_id']
        cwd = spawn.call_args[0][2]
        run = server.agent_runs()['runs'][0]
        self.assertEqual((run['cwd'], run['worktree']), (cwd, cwd))  # the folder is the repository's root
        self.assertTrue(run['branch'].startswith('agents/dev-status-'))
        self.assertTrue(server.list_agents()['dirs'][0]['git'])
        write(os.path.join(cwd, 'scratch.txt'), 'x\n')
        self.assertEqual(server.remove_run_worktree(sid)['dirty'], True)  # asked first
        self.assertTrue(os.path.isdir(cwd))
        self.assertEqual(server.remove_run_worktree(sid, True), {'removed': True, 'branch': run['branch']})
        self.assertFalse(os.path.exists(cwd))
        self.assertIn('removed_ts', server.agent_runs()['runs'][0])

    def test_open_in_starts_in_a_worktree_too(self):
        targets = [{'key': 'terminal', 'label': 'Terminal'}, {'key': 'cursor', 'label': 'Cursor'}]
        with mock.patch.object(server, '_open_terminal', return_value={'launched': True}) as term, \
                mock.patch.object(server, 'open_targets', return_value=targets):
            out = server.launch_agent(self.id, 'dev:status', 'STY-3', target='terminal', where='worktree')
            with mock.patch.object(server, '_open_elsewhere', side_effect=StoreError(502, 'Cursor is not there')):
                with self.assertRaises(StoreError):
                    server.launch_agent(self.id, 'dev:status', target='cursor', where='worktree')
        run = server.agent_runs()['runs'][0]
        self.assertEqual((run['id'], run['cwd']), (out['session_id'], term.call_args[0][0]))
        self.assertTrue(run['worktree'].startswith(os.path.join(os.path.realpath(self.agents), '.claude', 'worktrees')))
        self.assertEqual(os.listdir(os.path.join(self.agents, '.claude', 'worktrees')), [os.path.basename(run['worktree'])])  # Cursor's went

    def test_a_worktree_is_dropped_when_its_run_cannot_start(self):
        with mock.patch.object(server, '_spawn_chat', side_effect=StoreError(500, 'no claude')):
            with self.assertRaises(StoreError):
                server.run_agent(self.app.store, self.id, 'dev:status', '', '', '', '', 'worktree')
        self.assertEqual(os.listdir(os.path.join(self.agents, '.claude', 'worktrees')), [])
        with self.assertRaises(StoreError) as cm:
            server.run_agent(self.app.store, self.id, 'dev:status', where='elsewhere')
        self.assertEqual(cm.exception.status, 400)


if __name__ == '__main__':
    unittest.main()
