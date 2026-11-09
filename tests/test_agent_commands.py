"""The Agents section: the commands of the agent folders in Settings (tm/commands.py) and running one (server.py)."""
import contextlib
import io
import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

import server
from tm import agentruns, commands
from tm.store import StoreError
from tests.test_vaults import make_vault


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


class ScanTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix='tm agents ')
        self.addCleanup(shutil.rmtree, self.root, True)
        cmds = os.path.join(self.root, '.claude', 'commands')
        write(os.path.join(cmds, 'triage.md'), '---\ndescription: Triage  the   inbox\nargument-hint: "[--since 14]"\n'
                                                'allowed-tools: Read, Bash(git add *, git commit *), Grep\n'
                                                'disable-model-invocation: true\n---\nDo it with $ARGUMENTS.\n')
        write(os.path.join(cmds, 'dev', 'start.md'), '---\ndescription: Start\nallowed-tools: [Read, Edit]\n---\nBody\n')
        write(os.path.join(cmds, 'plain.md'), 'No frontmatter at all.\n')
        write(os.path.join(cmds, 'broken.md'), '---\ndescription: [unclosed\n---\nStill a command.\n')
        write(os.path.join(cmds, 'notes.txt'), 'not a command')
        write(os.path.join(cmds, '.hidden', 'secret.md'), 'hidden')
        write(os.path.join(cmds, 'bad name!.md'), 'skipped: not a name Claude Code can type')

    def test_commands_are_named_by_their_path_with_their_fields(self):
        got = {c['name']: c for c in commands.scan(self.root)}
        self.assertEqual(sorted(got), ['broken', 'dev:start', 'plain', 'triage'])
        t = got['triage']
        self.assertEqual(t['description'], 'Triage the inbox')
        self.assertEqual(t['argument_hint'], '[--since 14]')
        self.assertEqual(t['allowed_tools'], ['Read', 'Bash(git add *, git commit *)', 'Grep'])
        self.assertTrue(t['disable_model_invocation'])
        self.assertEqual(t['file'], '.claude/commands/triage.md')
        self.assertEqual((got['dev:start']['ns'], got['dev:start']['allowed_tools']), ('dev', ['Read', 'Edit']))
        self.assertEqual(got['dev:start']['file'], '.claude/commands/dev/start.md')
        self.assertEqual(got['plain']['description'], '')

    def test_a_folder_without_commands_has_none(self):
        empty = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, empty, True)
        self.assertEqual(commands.scan(empty), [])
        self.assertIsNone(commands.read(empty, 'triage'))

    def test_a_linked_commands_folder_is_followed_once(self):
        """An app links the commands of the system that builds it: read through the link, and a loop ends."""
        app = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, app, True)
        os.makedirs(os.path.join(app, '.claude'))
        os.symlink(os.path.join(self.root, '.claude', 'commands'), os.path.join(app, '.claude', 'commands'))
        os.symlink(os.path.join(self.root, '.claude', 'commands'), os.path.join(self.root, '.claude', 'commands', 'dev', 'loop'))
        names = [c['name'] for c in commands.scan(app)]
        self.assertEqual(sorted(names), ['broken', 'dev:start', 'plain', 'triage'])

    def test_read_gives_the_body_and_only_a_listed_name(self):
        got = commands.read(self.root, 'triage')
        self.assertEqual(got['body'], 'Do it with $ARGUMENTS.\n')
        for name in ('../triage', 'dev/start', '/etc/passwd', '', 'nope', 'dev:start:x'):
            self.assertIsNone(commands.read(self.root, name), name)
        self.assertEqual(commands.read(self.root, 'dev:start')['body'], 'Body\n')

    def test_the_folder_id_is_stable_and_short(self):
        self.assertEqual(commands.dir_id(self.root), commands.dir_id(self.root + '/'))
        self.assertRegex(commands.dir_id(self.root), r'^[0-9a-f]{8}$')


class AgentRoutesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='tm agents ')
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.vault = make_vault(os.path.join(self.tmp, 'vault'))
        self.agents = os.path.join(self.tmp, 'my agents')
        write(os.path.join(self.agents, '.claude', 'commands', 'dev', 'status.md'), '---\ndescription: Status\n---\nShow $ARGUMENTS\n')
        self.cfg = os.path.join(self.tmp, 'config.json')
        with open(self.cfg, 'w', encoding='utf-8') as f:
            json.dump({'root': self.vault, 'default_vault': 'a', 'agent_dirs': [self.agents], 'agent_dir_names': {self.agents: 'Mine'},
                       'vaults': [{'id': 'a', 'name': 'A', 'path': self.vault, 'structure': 'folders'}]}, f)
        for patcher in (mock.patch.object(server, 'CONFIG_PATH', self.cfg),):
            patcher.start()
            self.addCleanup(patcher.stop)
        quiet = contextlib.redirect_stdout(io.StringIO())
        quiet.__enter__()
        self.addCleanup(quiet.__exit__, None, None, None)
        self.app = server.App()
        patcher = mock.patch.object(server, 'APP', self.app)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.id = commands.dir_id(self.agents)

    def test_the_folders_are_listed_with_their_commands(self):
        got = server.list_agents()['dirs']
        self.assertEqual([(d['id'], d['name'], d['exists']) for d in got], [(self.id, 'Mine', True)])
        self.assertEqual([c['name'] for c in got[0]['commands']], ['dev:status'])
        self.assertEqual(server.agent_command(self.id, 'dev:status')['command']['body'], 'Show $ARGUMENTS\n')

    def test_a_folder_is_picked_by_id_only(self):
        for bad in (self.agents, '../x', '', None, 'deadbeef'):
            with self.assertRaises(StoreError) as cm:
                server.agent_dir(bad)
            self.assertEqual(cm.exception.status, 404)
        with self.assertRaises(StoreError) as cm:
            server.agent_command(self.id, 'nope')
        self.assertEqual(cm.exception.status, 404)

    def test_a_folder_that_is_gone_is_listed_but_not_used(self):
        shutil.rmtree(self.agents)
        self.assertEqual(server.list_agents()['dirs'][0]['exists'], False)
        with self.assertRaises(StoreError) as cm:
            server.agent_dir(self.id)
        self.assertEqual(cm.exception.status, 409)

    def test_settings_refuse_a_folder_that_does_not_exist(self):
        with self.assertRaises(StoreError):
            self.app.set_config({'agent_dirs': [self.agents, os.path.join(self.tmp, 'nowhere')]})
        self.app.set_config({'agent_dirs': [self.agents + '/', self.agents], 'agent_dir_names': {self.agents: '  My   agents ', '/x': 'gone'}})
        self.assertEqual(self.app.config['agent_dirs'], [self.agents])
        self.assertEqual(self.app.config['agent_dir_names'], {self.agents: 'My agents'})

    def test_the_message_is_the_command_and_its_arguments_as_text(self):
        self.assertEqual(server.agent_message('dev:status'), '/dev:status')
        self.assertEqual(server.agent_message('dev:status', ' STY-1 "a b"\n$(rm -rf ~) `x` '), '/dev:status STY-1 "a b" $(rm -rf ~) `x`')
        with self.assertRaises(StoreError):
            server.agent_message('x', 'a' * (server.AGENT_ARGS_MAX + 1))

    def test_a_run_starts_a_chat_in_the_folder_and_records_it(self):
        chat = mock.Mock()
        chat.info.return_value = {'id': 'x'}
        with mock.patch.object(server, '_spawn_chat', return_value=chat) as spawn:
            out = server.run_agent(self.app.store, self.id, 'dev:status', 'STY-1 $(x)', 'plan', 'haiku', '')
        (session_id, flags, cwd, label, key, mode, model, prompt), kw = spawn.call_args
        self.assertEqual((cwd, key, mode, model, prompt), (os.path.realpath(self.agents), None, 'plan', 'haiku', '/dev:status STY-1 $(x)'))
        self.assertEqual(flags[:2], ['--model', 'haiku'])
        self.assertIn('--session-id', flags)
        self.assertEqual(out['session_id'], session_id)
        self.assertEqual(self.app.store.global_claude_sessions()['sessions'], [])  # not a vault's: the computer's list
        runs = server.agent_runs(self.id, 'dev:status')['runs']
        self.assertEqual([(r['id'], r['cwd'], r['args'], r['mode'], r['model'], r['target'], r['live']) for r in runs],
                         [(session_id, os.path.realpath(self.agents), 'STY-1 $(x)', 'plan', 'haiku', 'here', False)])
        self.assertTrue(os.path.isfile(os.path.join(self.tmp, server.AGENT_RUNS)))  # next to config.json
        with self.assertRaises(StoreError):
            server.run_agent(self.app.store, self.id, '../dev:status')
        with self.assertRaises(StoreError):
            server.run_agent(self.app.store, self.id, 'dev:status', model='rm -rf')
        with self.assertRaises(StoreError):
            server.run_agent(self.app.store, self.id, 'dev:status', mode='bypassPermissions')

    def test_a_run_resumes_from_the_list_of_runs_and_is_forgotten(self):
        chat = mock.Mock()
        chat.info.return_value = {'id': 'x'}
        with mock.patch.object(server, '_spawn_chat', return_value=chat):
            sid = server.run_agent(self.app.store, self.id, 'dev:status', 'STY-2', '', '', '')['session_id']
        found, flags = server._resume_plan(self.app.store, None, sid)  # what the dock and Open in ▾ resume from
        self.assertEqual((found['id'], found['cwd'], flags), (sid, os.path.realpath(self.agents), ['--resume', sid]))
        with self.assertRaises(StoreError):
            server._resume_plan(self.app.store, 'a/nothing.md', sid)  # an item's sessions are its own
        self.assertEqual(server.forget_agent_run(sid.upper()), {'forgotten': sid})
        self.assertEqual(server.agent_runs()['runs'], [])
        with self.assertRaises(StoreError) as cm:
            server.forget_agent_run(sid)
        self.assertEqual(cm.exception.status, 404)

    def test_open_in_terminal_records_the_run_and_elsewhere_does_not(self):
        with mock.patch.object(server, '_open_terminal', return_value={'launched': True}) as term, \
                mock.patch.object(server, 'open_targets', return_value=[{'key': 'terminal', 'label': 'Terminal'}, {'key': 'cursor', 'label': 'Cursor'}]):
            out = server.launch_agent(self.id, 'dev:status', 'STY-3', 'acceptEdits', 'haiku', '', 'terminal')
            cwd, flags, prompt = term.call_args[0]
            self.assertEqual((cwd, prompt), (os.path.realpath(self.agents), '/dev:status STY-3'))
            self.assertEqual(flags[-2:], ['--permission-mode', 'acceptEdits'])
            with mock.patch.object(server, '_open_elsewhere', return_value={'launched': True, 'recorded': False}) as other:
                server.launch_agent(self.id, 'dev:status', 'STY-4', target='cursor')
            self.assertEqual(other.call_args, mock.call('cursor', os.path.realpath(self.agents), prompt='/dev:status STY-4'))
            with self.assertRaises(StoreError):
                server.launch_agent(self.id, 'dev:status', target='nowhere')
        runs = server.agent_runs(self.id)['runs']
        self.assertEqual([(r['id'], r['target'], r['args']) for r in runs], [(out['session_id'], 'terminal', 'STY-3')])


class RunsFileTest(unittest.TestCase):
    def test_a_broken_or_odd_file_is_no_runs_and_entries_are_cleaned(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        path = os.path.join(tmp, 'runs.json')
        self.assertEqual(agentruns.load(path), [])
        write(path, '{not json')
        self.assertEqual(agentruns.load(path), [])
        sid = '12345678-1234-4123-8123-123456789abc'
        agentruns.add(path, {'id': sid.upper(), 'cwd': '/x', 'cmd': 'a', 'args': ' one\n two ', 'junk': 1})
        agentruns.add(path, {'id': 'not-a-uuid', 'cwd': '/x'})
        agentruns.add(path, {'id': sid, 'cwd': '/y', 'cmd': 'a'})  # the same id again replaces it
        self.assertEqual(agentruns.load(path), [{'id': sid, 'at': '', 'cwd': '/y', 'args': '', 'cmd': 'a'}])
        with mock.patch.object(agentruns, 'MAX', 2):
            for i in range(3):
                agentruns.add(path, {'id': f'12345678-1234-4123-8123-12345678900{i}', 'cwd': '/x'})
            self.assertEqual(len(agentruns.load(path)), 2)

if __name__ == '__main__':
    unittest.main()
