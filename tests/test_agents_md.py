"""The vault's guide for agents (tm/agentsmd.py): AGENTS.md written from the vault's own structure and projects, the
owner's text around it kept byte for byte, on and off from Settings (POST /api/vault/agents) and from tools/vault.py,
written again when what it says changes — and its commands work as written. On temp copies of the samples only."""
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

import server
from tm import agentsmd
from tm.store import Store, StoreError
from tools import vault
from tools.serve_sample import copy_sample

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLE = os.path.join(APP_DIR, 'sample-vault')
LEGACY = os.path.join(APP_DIR, 'sample-vault-legacy')


class GuideBase(unittest.TestCase):
    sample, structure = SAMPLE, 'ticketing'

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='tm-agents-md-')
        self.root = copy_sample(self.sample, os.path.join(self.tmp, 'vault'))
        self.s = Store(self.root, None, self.structure, enforce_structure=True)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def path(self, name):
        return os.path.join(self.root, name)

    def read(self, name):
        with open(self.path(name), encoding='utf-8') as f:
            return f.read()

    def write(self, name, text):
        with open(self.path(name), 'w', encoding='utf-8') as f:
            f.write(text)


class RenderTest(GuideBase):
    def test_it_names_every_type_project_and_relation_kind_from_the_structure(self):
        text = agentsmd.render(self.s.agents_info(), '/Apps/TM')
        for name, t in self.s.structure.types.items():
            self.assertIn(f'| `{name}` {t.label} |', text)
        for key in ('ACME', 'MOVE', 'OPS'):
            self.assertIn(f'| {key} |', text)
        self.assertIn('`blocked` in `depends_on`', text)
        self.assertIn('| STY-5 |', text, 'a real ref of the type, as the vault draws it')
        self.assertIn("python3 /Apps/TM/tools/vault.py overview", text)
        self.assertTrue(text.startswith(agentsmd.START) and text.rstrip().endswith(agentsmd.END))

    def test_the_same_vault_gives_the_same_text_with_no_date_in_it(self):
        a = agentsmd.render(self.s.agents_info(), '/Apps/TM')
        self.assertEqual(a, agentsmd.render(self.s.agents_info(), '/Apps/TM'))
        self.assertIsNone(re.search(r'20\d\d-\d\d-\d\d', a))

    def test_a_path_with_spaces_is_quoted_for_the_shell(self):
        self.assertIn("python3 '/Apps/Task Manager/tools/vault.py' check", agentsmd.render(self.s.agents_info(), '/Apps/Task Manager'))


class MergeTest(unittest.TestCase):
    BLOCK = f'{agentsmd.START}\n# Generated\n{agentsmd.END}\n'

    def test_the_owners_text_around_the_block_stays_byte_for_byte(self):
        mine = '# My notes\n\nKeep replies short.\n'
        merged = agentsmd.merge(mine, self.BLOCK)
        self.assertTrue(merged.startswith(mine))
        self.assertEqual(agentsmd.strip(merged), mine)
        around = f'Before\n\n{self.BLOCK}\nAfter, by hand.\n'
        newer = agentsmd.merge(around, self.BLOCK.replace('Generated', 'Generated again'))
        self.assertEqual(newer, around.replace('Generated', 'Generated again'))
        self.assertEqual(agentsmd.merge(newer, self.BLOCK), around)

    def test_an_empty_file_is_the_block_and_a_file_without_one_is_left_as_it_is(self):
        self.assertEqual(agentsmd.merge('', self.BLOCK), self.BLOCK)
        self.assertEqual(agentsmd.strip(self.BLOCK), '')
        self.assertEqual(agentsmd.strip('no block\n'), 'no block\n')
        self.assertIsNone(agentsmd.block_of('no block'))
        self.assertEqual(agentsmd.block_of(f'x\n{self.BLOCK}y\n'), self.BLOCK)


class OnOffTest(GuideBase):
    def test_on_writes_both_files_and_the_vault_still_matches_without_a_warning(self):
        status = self.s.set_agents_md(True, APP_DIR)
        self.assertEqual(status, {'on': True, 'file': 'AGENTS.md', 'claude': True})
        self.assertEqual(self.read('CLAUDE.md'), '@AGENTS.md\n')
        check = self.s.check()
        self.assertTrue(check['ok'])
        self.assertEqual([w for w in check['warnings'] if w['path'] in ('AGENTS.md', 'CLAUDE.md')], [])
        self.assertFalse(any(it['path'] in ('AGENTS.md', 'CLAUDE.md') for it in self.s.items()))

    def test_the_owners_files_are_kept_and_off_takes_away_only_what_on_added(self):
        self.write('AGENTS.md', '# Mine\n')
        self.write('CLAUDE.md', 'Talk like a pirate.\n')
        self.s.set_agents_md(True, APP_DIR)
        self.assertEqual(self.read('CLAUDE.md'), 'Talk like a pirate.\n', 'its own CLAUDE.md is never touched')
        self.assertTrue(self.read('AGENTS.md').startswith('# Mine\n'))
        self.assertFalse(self.s.set_agents_md(False, APP_DIR)['on'])
        self.assertEqual(self.read('AGENTS.md'), '# Mine\n')
        self.assertEqual(self.read('CLAUDE.md'), 'Talk like a pirate.\n')

    def test_off_on_a_guide_alone_sends_both_files_to_the_trash(self):
        self.s.set_agents_md(True, APP_DIR)
        self.s.set_agents_md(False, APP_DIR)
        self.assertFalse(os.path.exists(self.path('AGENTS.md')) or os.path.exists(self.path('CLAUDE.md')))
        self.assertEqual(len([n for n in os.listdir(os.path.join(self.root, '.task-manager', 'trash', 'files')) if not n.endswith('.json')]), 2)

    def test_refresh_writes_only_when_what_it_says_changed(self):
        self.assertFalse(self.s.refresh_agents_md(APP_DIR), 'a vault without the guide is left alone')
        self.assertFalse(os.path.exists(self.path('AGENTS.md')))
        self.s.set_agents_md(True, APP_DIR)
        before = os.stat(self.path('AGENTS.md'))
        self.assertFalse(self.s.refresh_agents_md(APP_DIR))
        self.assertEqual(os.stat(self.path('AGENTS.md')).st_ino, before.st_ino, 'nothing changed: not written')
        self.s.create('project', 'Mobile App', {'project_key': 'MOB'})
        self.assertTrue(self.s.refresh_agents_md(APP_DIR))
        self.assertIn('| MOB | Mobile App | `Mobile App` |', self.read('AGENTS.md'))
        self.assertTrue(self.s.refresh_agents_md('/elsewhere'), 'the app moved: the commands follow it')


class LinkedGuideTest(GuideBase):
    def test_a_guide_that_is_a_link_is_never_written_through(self):
        outside = os.path.join(self.tmp, 'outside.md')
        with open(outside, 'w', encoding='utf-8') as f:
            f.write(f'not the vault\'s\n{agentsmd.START}\nold\n{agentsmd.END}\n')
        os.symlink(outside, self.path('AGENTS.md'))
        os.symlink(outside, self.path('CLAUDE.md'))
        with open(outside, encoding='utf-8') as f:
            before = f.read()
        self.assertFalse(agentsmd.is_on(self.root))
        self.assertFalse(self.s.refresh_agents_md(APP_DIR))
        with self.assertRaises(StoreError) as e:
            self.s.set_agents_md(True, APP_DIR)
        self.assertEqual(e.exception.status, 409)
        self.s.set_agents_md(False, APP_DIR)
        with open(outside, encoding='utf-8') as f:
            self.assertEqual(f.read(), before, 'the file the links point at is untouched')
        self.assertTrue(os.path.islink(self.path('AGENTS.md')) and os.path.islink(self.path('CLAUDE.md')))


    def test_a_dangling_claude_md_link_never_makes_its_target(self):
        target = os.path.join(self.tmp, 'elsewhere', 'made-by-the-app.md')
        os.makedirs(os.path.dirname(target))
        os.symlink(target, self.path('CLAUDE.md'))
        self.s.set_agents_md(True, APP_DIR)
        self.assertFalse(os.path.exists(target), 'nothing written where the link points')
        self.assertTrue(os.path.islink(self.path('CLAUDE.md')))
        self.assertEqual(os.listdir(os.path.dirname(target)), [], 'not even a temporary file')


class LegacyGuideTest(GuideBase):
    sample, structure = LEGACY, 'folders'

    def test_a_legacy_vault_gets_its_own_types_and_still_matches(self):
        self.s.set_agents_md(True, APP_DIR)
        text = self.read('AGENTS.md')
        self.assertIn('(Initiatives)', text)
        for name in self.s.structure.types:
            self.assertIn(f'| `{name}` ', text)
        self.assertTrue(self.s.check()['ok'])
        self.assertEqual([w for w in self.s.check()['warnings'] if w['path'] in ('AGENTS.md', 'CLAUDE.md')], [])


class ServerAndCliTest(GuideBase):
    def test_the_route_turns_it_on_and_off_and_the_status_says_so(self):
        route = server.ROUTES[('POST', '/api/vault/agents')]
        self.assertTrue(route(self.s, {}, {'on': True})['on'])
        self.assertIn(f'python3 {APP_DIR}/tools/vault.py', self.read('AGENTS.md').replace("'", ''))
        self.assertFalse(route(self.s, {}, {'on': False})['on'])

    def test_a_poke_refreshes_the_guide_after_a_quiet_moment_and_only_an_opted_in_one(self):
        refresh = server.AgentsRefresh()
        refresh.DELAY = 0.05
        refresh.poke(self.s)
        self.assertEqual(refresh._timers, {}, 'no guide: nothing scheduled')
        self.s.set_agents_md(True, APP_DIR)
        self.s.create('project', 'Mobile App', {'project_key': 'MOB'})
        refresh.poke(self.s)
        refresh.poke(self.s)  # a burst is one refresh
        self.assertEqual(len(refresh._timers), 1)
        deadline = time.time() + 10
        while '| MOB |' not in self.read('AGENTS.md') and time.time() < deadline:
            time.sleep(0.05)
        self.assertIn('| MOB |', self.read('AGENTS.md'))

    def cli(self, *argv, code=0):
        out, err = io.StringIO(), io.StringIO()
        self.assertEqual(vault.main(['-C', self.root, *argv], out=out, err=err), code, err.getvalue())
        return out.getvalue()

    def test_the_cli_prints_turns_on_and_refreshes_after_its_own_writes(self):
        self.assertIn(agentsmd.START, self.cli('agents', '--print'))
        self.assertFalse(os.path.exists(self.path('AGENTS.md')), '--print writes nothing')
        self.assertIn('No guide', self.cli('agents'))
        self.cli('agents', '--on')
        self.cli('new', 'project', 'Mobile App', '--set', 'project_key=MOB')
        self.assertIn('| MOB | Mobile App |', self.read('AGENTS.md'))
        self.cli('agents', '--off')
        self.assertFalse(os.path.exists(self.path('AGENTS.md')))

    def test_the_commands_the_guide_gives_run_as_written_from_the_vault(self):
        self.s.set_agents_md(True, APP_DIR)
        # Through a shell on purpose: what is checked is the line as an agent's shell runs it, its quoting included. The
        # line is this test's own generated text, in a temp folder.
        block = self.read('AGENTS.md').split('```bash\n', 1)[1].split('```', 1)[0]
        for name in ('overview', 'check'):
            line = next(ln for ln in block.splitlines() if re.search(rf' {name}\b', ln)).split('#')[0].strip()
            cmd = line.replace('python3 ', f'{sys.executable} ', 1)
            run = subprocess.run(cmd, shell=True, cwd=os.path.join(self.root, 'Acme Web'), capture_output=True, text=True, timeout=120)
            self.assertEqual(run.returncode, 0, f'{cmd}\n{run.stderr}')
        self.assertIn('Projects vault', subprocess.run(
            next(ln for ln in block.splitlines() if ' overview' in ln).split('#')[0].replace('python3 ', f'{sys.executable} ', 1),
            shell=True, cwd=self.root, capture_output=True, text=True, timeout=120).stdout)


if __name__ == '__main__':
    unittest.main()
