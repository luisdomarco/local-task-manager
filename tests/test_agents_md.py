"""The vault's guide for agents (tm/agentsmd.py): AGENTS.md written from the vault's own structure and projects, the
owner's text around it kept byte for byte, on and off from Settings (POST /api/vault/agents) and from tools/vault.py,
written again when what it says changes — and its commands work as written. On temp copies of the samples only.

The CLI it names is the vault's own shim; that, and how it resolves the app, is tests/test_vault_shim.py (SUP-407)."""
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
from tm import agentsmd, vaultshim
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
        text = agentsmd.render(self.s.agents_info())
        for name, t in self.s.structure.types.items():
            self.assertIn(f'| `{name}` {t.label} |', text)
        for key in ('ACME', 'MOVE', 'OPS'):
            self.assertIn(f'| {key} |', text)
        self.assertIn('`blocked` in `depends_on`', text)
        self.assertIn('| STY-5 |', text, 'a real ref of the type, as the vault draws it')
        self.assertIn(f'python3 {vaultshim.REL} overview', text)
        self.assertTrue(text.startswith(agentsmd.START) and text.rstrip().endswith(agentsmd.END))

    def test_the_same_vault_gives_the_same_text_with_no_date_in_it(self):
        a = agentsmd.render(self.s.agents_info())
        self.assertEqual(a, agentsmd.render(self.s.agents_info()))
        self.assertIsNone(re.search(r'20\d\d-\d\d-\d\d', a))

    def test_who_work_is_handed_to_is_told_only_where_the_vault_has_it(self):
        """Responsible starts off in every vault: the guide says nothing about it until the owner turns it on."""
        self.assertNotIn('--set responsible=', agentsmd.render(self.s.agents_info()))
        self.s.save_vault_settings({'enabled_features': ['responsible']})
        text = agentsmd.render(self.s.agents_info())
        self.assertIn('--set responsible="<name>"', text)
        self.s.save_vault_settings({'disabled_features': ['contacts']})  # it names a contact: off with Contacts
        self.assertNotIn('--set responsible=', agentsmd.render(self.s.agents_info()))

    def test_the_cli_is_named_relative_to_the_vault_so_no_path_needs_quoting(self):
        """It used to be the writing app's absolute path, shell-quoted for a folder with spaces in it (`/Apps/Task
        Manager/…`). A path relative to the vault is the same everywhere and has nothing to quote."""
        text = agentsmd.render(self.s.agents_info())
        self.assertIn(f'python3 {vaultshim.REL} check', text)
        self.assertNotIn("'", text.split('```bash\n', 1)[1].split('```', 1)[0])


class FormatsTest(GuideBase):
    """The guide teaches the vault's formats from what the vault has: its bases, its architectures, its boards."""

    def test_each_base_says_what_a_note_needs_to_be_in_it(self):
        text = agentsmd.render(self.s.agents_info())
        self.assertIn('## Indexes (Obsidian Bases)', text)
        self.assertIn('| `Docs/Library/Library.base` | By topic, Cards, Repos | in `Docs/Library` · `topic` | `topic` | '
                      '`score`, `website`, `blurb`, `tool` |', text)
        self.assertIn('never edit a base, or a hand-written list in a note, to add a note to it', text)

    def test_a_base_by_file_class_names_the_value_and_one_that_cannot_be_read_says_so(self):
        os.makedirs(self.path('Docs/Links'))
        self.write('Docs/Links/Links.base', 'filters:\n  and:\n    - \'fileClass == "Bookmarks"\'\n    - file.hasTag("ai")\n'
                   'views:\n  - type: table\n    name: All\n    groupBy:\n      property: category\n'
                   '    order: [file.name, category, url, related_tool]\n')
        self.write('Docs/Links/Broken.base', 'views: [\n')
        text = agentsmd.render(self.s.agents_info())
        self.assertIn('| `Docs/Links/Links.base` | All | `#ai` · `fileClass: Bookmarks` | `category` | `category`, `url`, '
                      '`related_tool` |', text)
        self.assertRegex(text, r'\| `Docs/Links/Broken.base` \| — \| \(cannot be read: .+\) \| — \| — \|')

    def test_a_negated_filter_is_drawn_as_what_keeps_a_note_out(self):
        os.makedirs(self.path('Docs/Systems'))
        self.write('Docs/Systems/Systems.base', 'filters:\n  and:\n    - file.inFolder("Docs/Systems")\n'
                   '    - \'!file.inFolder("Docs/Systems/_template")\'\n'
                   'views:\n  - type: table\n    name: All\n    order: [file.name]\n')
        text = agentsmd.render(self.s.agents_info())
        self.assertIn('| `Docs/Systems/Systems.base` | All | in `Docs/Systems` · '
                      'not in `Docs/Systems/_template` | — | — |', text)

    def test_architectures_and_entities_come_from_the_structure(self):
        text = agentsmd.render(self.s.agents_info())
        self.assertIn('## Agentic systems: architectures and entities', text)
        self.assertIn('| `skill` | N2 | yes | `ski-` |', text)
        self.assertIn('| `gate` | N5 | proposed | — |', text)
        self.assertIn('`AP-1` is an anti-pattern', text)
        self.assertIn("never set it", text)

    def test_boards_are_listed_with_their_columns(self):
        self.s.save_custom_board('week', columns=[{'id': 'uncategorized', 'name': 'Uncategorized'}, {'id': 'w', 'name': 'Waiting'}])
        text = agentsmd.render(self.s.agents_info())
        self.assertIn('| `week` | Uncategorized, Waiting |', text)
        self.assertIn('never in the item\'s file', text)

    def test_a_legacy_vault_has_no_architecture_section(self):
        self.assertIsNone(Store(copy_sample(LEGACY, os.path.join(self.tmp, 'legacy')), None, 'folders').agents_info()['agentic'])


class FormatsCliTest(GuideBase):
    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        code = vault.main(['-C', self.root, *argv], out=out, err=err)
        return code, out.getvalue(), err.getvalue()

    def test_base_prints_a_views_rows_grouped(self):
        code, out, _ = self.run_cli('base', 'Docs/Library/Library.base')
        self.assertEqual(code, 0)
        self.assertIn('4 results · views: By topic, Cards, Repos', out)
        self.assertIn('| **Books** (2) |', out)
        code, out, _ = self.run_cli('base', 'Docs/Library/Library.base', '--view', 'Repos')
        self.assertIn('1 results', out)
        self.assertEqual(self.run_cli('base', 'Docs/Library/Library.base', '--view', 'Nope')[0], 1)

    def test_board_places_a_card_by_column_name_and_takes_it_off(self):
        self.s.save_custom_board('week', columns=[{'id': 'uncategorized', 'name': 'Uncategorized'}, {'id': 'w', 'name': 'Waiting'}])
        it = next(i for i in self.s.items() if i['type'] == 'story')
        before = self.read(it['path'])
        code, out, _ = self.run_cli('board', 'week', '--place', f"{it['ref']}=waiting")
        self.assertEqual(code, 0)
        self.assertIn(f"- Waiting (`w`): {it['ref']}", out)
        self.assertEqual(self.read(it['path']), before, 'a card placed never writes the item')
        code, out, _ = self.run_cli('board', 'week', '--place', f"{it['ref']}=")
        self.assertIn('- Waiting (`w`): —', out)
        code, _, err = self.run_cli('board', 'week', '--place', f"{it['ref']}=Nowhere")
        self.assertEqual(code, 1)
        self.assertIn('has no column', err)
        self.assertIn('week: Uncategorized, Waiting', self.run_cli('board')[1])


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
        status = self.s.set_agents_md(True)
        self.assertEqual(status, {'on': True, 'file': 'AGENTS.md', 'claude': True})
        self.assertEqual(self.read('CLAUDE.md'), '@AGENTS.md\n')
        check = self.s.check()
        self.assertTrue(check['ok'])
        self.assertEqual([w for w in check['warnings'] if w['path'] in ('AGENTS.md', 'CLAUDE.md')], [])
        self.assertFalse(any(it['path'] in ('AGENTS.md', 'CLAUDE.md') for it in self.s.items()))

    def test_the_owners_files_are_kept_and_off_takes_away_only_what_on_added(self):
        self.write('AGENTS.md', '# Mine\n')
        self.write('CLAUDE.md', 'Talk like a pirate.\n')
        self.s.set_agents_md(True)
        self.assertEqual(self.read('CLAUDE.md'), 'Talk like a pirate.\n', 'its own CLAUDE.md is never touched')
        self.assertTrue(self.read('AGENTS.md').startswith('# Mine\n'))
        self.assertFalse(self.s.set_agents_md(False)['on'])
        self.assertEqual(self.read('AGENTS.md'), '# Mine\n')
        self.assertEqual(self.read('CLAUDE.md'), 'Talk like a pirate.\n')

    def test_off_on_a_guide_alone_sends_both_files_to_the_trash(self):
        self.s.set_agents_md(True)
        self.s.set_agents_md(False)
        self.assertFalse(os.path.exists(self.path('AGENTS.md')) or os.path.exists(self.path('CLAUDE.md')))
        self.assertEqual(len([n for n in os.listdir(os.path.join(self.root, '.task-manager', 'trash', 'files')) if not n.endswith('.json')]), 2)

    def test_refresh_writes_only_when_what_it_says_changed(self):
        self.assertFalse(self.s.refresh_agents_md(), 'a vault without the guide is left alone')
        self.assertFalse(os.path.exists(self.path('AGENTS.md')))
        self.assertFalse(os.path.exists(vaultshim.path(self.root)), 'and gets no shim either')
        self.s.set_agents_md(True)
        self.assertTrue(os.path.isfile(vaultshim.path(self.root)), 'on puts the CLI the block names in the vault')
        os.remove(vaultshim.path(self.root))
        before = os.stat(self.path('AGENTS.md'))
        self.assertFalse(self.s.refresh_agents_md())
        self.assertEqual(os.stat(self.path('AGENTS.md')).st_ino, before.st_ino, 'nothing changed: not written')
        self.assertTrue(os.path.isfile(vaultshim.path(self.root)), 'a shim that went missing comes back on a refresh')
        self.s.create('project', 'Mobile App', {'project_key': 'MOB'})
        self.assertTrue(self.s.refresh_agents_md())
        self.assertIn('| MOB | Mobile App | `Mobile App` |', self.read('AGENTS.md'))
        self.assertFalse(self.s.refresh_agents_md(), 'the same text whichever copy of the app writes it (SUP-407)')
        self.s.set_agents_md(False)
        self.assertFalse(os.path.exists(vaultshim.path(self.root)), 'off takes the shim away too')


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
        self.assertFalse(self.s.refresh_agents_md())
        with self.assertRaises(StoreError) as e:
            self.s.set_agents_md(True)
        self.assertEqual(e.exception.status, 409)
        self.s.set_agents_md(False)
        with open(outside, encoding='utf-8') as f:
            self.assertEqual(f.read(), before, 'the file the links point at is untouched')
        self.assertTrue(os.path.islink(self.path('AGENTS.md')) and os.path.islink(self.path('CLAUDE.md')))


    def test_a_dangling_claude_md_link_never_makes_its_target(self):
        target = os.path.join(self.tmp, 'elsewhere', 'made-by-the-app.md')
        os.makedirs(os.path.dirname(target))
        os.symlink(target, self.path('CLAUDE.md'))
        self.s.set_agents_md(True)
        self.assertFalse(os.path.exists(target), 'nothing written where the link points')
        self.assertTrue(os.path.islink(self.path('CLAUDE.md')))
        self.assertEqual(os.listdir(os.path.dirname(target)), [], 'not even a temporary file')


class LegacyGuideTest(GuideBase):
    sample, structure = LEGACY, 'folders'

    def test_a_legacy_vault_gets_its_own_types_and_still_matches(self):
        self.s.set_agents_md(True)
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
        self.assertIn(f'python3 {vaultshim.REL}', self.read('AGENTS.md'))
        self.assertFalse(route(self.s, {}, {'on': False})['on'])

    def test_a_poke_refreshes_the_guide_after_a_quiet_moment_and_only_an_opted_in_one(self):
        refresh = server.AgentsRefresh()
        refresh.DELAY = 0.05
        refresh.poke(self.s)
        self.assertEqual(refresh._timers, {}, 'no guide: nothing scheduled')
        self.s.set_agents_md(True)
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
        """End to end, through the shim and a shell: the line as an agent's shell runs it, from the vault's folder as
        the guide says to. This checkout stands in for the installed app ($TASK_MANAGER_APP), so the test says nothing
        about what happens to be installed on the machine it runs on."""
        self.s.set_agents_md(True)
        env = {k: v for k, v in os.environ.items() if k != 'TM_VAULT'}
        env['TASK_MANAGER_APP'] = APP_DIR
        block = self.read('AGENTS.md').split('```bash\n', 1)[1].split('```', 1)[0]
        for name in ('overview', 'check'):
            line = next(ln for ln in block.splitlines() if re.search(rf' {name}\b', ln)).split('#')[0].strip()
            cmd = line.replace('python3 ', f'{sys.executable} ', 1)
            run = subprocess.run(cmd, shell=True, cwd=self.root, capture_output=True, text=True, timeout=120, env=env)
            self.assertEqual(run.returncode, 0, f'{cmd}\n{run.stderr}')
            if name == 'overview':
                self.assertIn('Projects vault', run.stdout)
        # And by its full path from outside the vault: no -C, no $TM_VAULT, and it still answers for its own vault.
        far = subprocess.run([sys.executable, vaultshim.path(self.root), 'overview'], cwd=self.tmp,
                             capture_output=True, text=True, timeout=120, env=env)
        self.assertEqual(far.returncode, 0, far.stderr)
        self.assertIn('Projects vault', far.stdout)


if __name__ == '__main__':
    unittest.main()
