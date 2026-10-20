import json
import os
import shutil
import tempfile
import unittest
import zipfile
from datetime import datetime

from tm import export


def touch(root, rel, text='x'):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


class ExportTest(unittest.TestCase):
    def setUp(self):
        self.app = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.app)
        for rel in ('server.py', 'README.md', 'package.json', '.env.example', '.gitignore', 'config.example.json',
                    'tm/store.py', 'static/js/main.js', 'tests/test_core.py', 'tools/seed.py', 'plans/a.md',
                    '.claude/launch.json', '.claude/commands/sync.md', 'sample-vault/tasks/TSK-0001.md'):
            touch(self.app, rel)
        # what must never leave
        for rel in ('config.json', '.env', 'vault/tasks/TSK-0001.md', 'vault.backup-1/x.md', 'backups/config.json.bak-1', 'versions/old.zip',
                    'tm/__pycache__/store.cpython-312.pyc', 'static/.DS_Store', '.git/HEAD',
                    'sample-vault/.task-manager/pins.md', '.claude/worktrees/w/file.py', 'secret.key'):
            touch(self.app, rel)

    def zip_names(self, rec):
        with zipfile.ZipFile(os.path.join(self.app, 'versions', rec['name'])) as z:
            return set(z.namelist()), json.loads(z.read('VERSION.json'))

    def test_whitelist_in_everything_else_out(self):
        rec = export.create(self.app, note='before the trip', now=datetime(2026, 10, 16, 9, 30))
        names, meta = self.zip_names(rec)
        for rel in ('server.py', 'tm/store.py', 'static/js/main.js', '.env.example', 'sample-vault/tasks/TSK-0001.md', 'VERSION.json'):
            self.assertIn(rel, names)
        self.assertFalse(any(n.startswith('.claude/') for n in names))  # the agents have their own zip
        for name in names:
            self.assertFalse(name.startswith(('vault/', 'vault.backup', 'backups/', 'versions/', '.git/')), name)
            self.assertNotIn(name, ('config.json', '.env', 'secret.key'))
            self.assertNotIn('__pycache__', name)
            self.assertNotIn('.task-manager', name)
            self.assertNotIn('worktrees', name)
            self.assertFalse(name.endswith('.DS_Store'), name)
        self.assertEqual(meta['note'], 'before the trip')
        self.assertEqual(meta['created_at'], '2026-10-16T09:30:00')
        self.assertEqual(meta['files'], len(names) - 1)
        self.assertIn('secret.key', meta['left_out'])  # visible: not in the whitelist
        self.assertTrue(rec['name'].startswith('system-task-manager-system-2026-10-16_0930'))

    def test_the_vault_in_use_stays_out_even_inside_a_whitelisted_folder(self):
        rec = export.create(self.app, vault_root=os.path.join(self.app, 'sample-vault'))
        names, meta = self.zip_names(rec)
        self.assertFalse(any(n.startswith('sample-vault/') for n in names))
        self.assertEqual(meta['vault_left_out'], 'sample-vault')

    def test_every_vault_the_app_knows_stays_out(self):
        touch(self.app, 'tests/fixtures-vault/tasks/TSK-0001.md')  # another vault, inside a whitelisted folder
        rec = export.create(self.app, vault_root=os.path.join(self.app, 'sample-vault'),
                            other_vaults=[os.path.join(self.app, 'tests', 'fixtures-vault')])
        names, _ = self.zip_names(rec)
        self.assertFalse(any(n.startswith(('sample-vault/', 'tests/fixtures-vault/')) for n in names))
        self.assertIn('tests/test_core.py', names)

    def test_a_vault_zip_is_named_after_its_vault(self):
        vault = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, vault)
        touch(vault, 'tasks/TSK-0001.md')
        rec = export.create(self.app, vault_root=vault, kind='vault', vault_id='tickets', now=datetime(2026, 10, 16, 9, 30))
        _, meta = self.zip_names(rec)
        self.assertTrue(rec['name'].endswith('-tickets.zip'), rec['name'])
        self.assertEqual(meta['vault_id'], 'tickets')
        self.assertEqual([r['kind'] for r in export.list_exports(self.app)], ['vault'])  # still a valid export name

    def test_symlink_out_of_the_app_is_skipped(self):
        outside = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outside)
        touch(outside, 'private.txt')
        os.symlink(os.path.join(outside, 'private.txt'), os.path.join(self.app, 'tm', 'link.txt'))
        names, _ = self.zip_names(export.create(self.app))
        self.assertNotIn('tm/link.txt', names)

    def test_names_are_checked(self):
        rec = export.create(self.app)
        self.assertEqual([r['name'] for r in export.list_exports(self.app)], [rec['name']])
        for bad in ('../server.py', 'versions/../x.zip', '/etc/passwd', 'old.zip', None, 'task-manager-../x.zip'):
            with self.assertRaises(export.ExportError):
                export.path_of(self.app, bad)
        export.delete(self.app, rec['name'])
        self.assertEqual(export.list_exports(self.app), [])

    def test_git_changes_keep_their_first_character(self):
        import subprocess
        shutil.rmtree(os.path.join(self.app, '.git'))  # the fixture's fake one
        subprocess.run(['git', 'init', '-q'], cwd=self.app, check=True)
        subprocess.run(['git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', 'server.py'], cwd=self.app, check=True)
        subprocess.run(['git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x'], cwd=self.app, check=True)
        touch(self.app, 'server.py', 'changed')
        info = export.git_info(self.app)
        self.assertTrue(info['dirty'])
        self.assertEqual(info['changes'][0], 'server.py')
        self.assertEqual(len(info['sha']), 7)

    def test_system_and_agents_are_two_zips(self):
        touch(self.app, 'CLAUDE.md')
        touch(self.app, 'tm/CLAUDE.md')
        system, smeta = self.zip_names(export.create(self.app, kind='system'))
        agents, ameta = self.zip_names(export.create(self.app, kind='agents'))
        self.assertEqual(agents - {'VERSION.json'}, {'.claude/launch.json', '.claude/commands/sync.md', 'CLAUDE.md', 'tm/CLAUDE.md'})
        self.assertFalse(any(n.startswith('.claude/') or n.endswith('CLAUDE.md') for n in system))
        self.assertIn('server.py', system)
        self.assertEqual((smeta['kind'], ameta['kind']), ('system', 'agents'))
        names = {r['kind']: r['name'] for r in export.list_exports(self.app)}
        self.assertTrue(names['agents'].startswith('agents-task-manager-system-'))
        self.assertTrue(names['system'].startswith('system-task-manager-system-'))
        with self.assertRaises(export.ExportError):
            export.create(self.app, kind='people')

    def test_the_vault_zip_holds_the_vault_in_use_whole_and_nothing_else(self):
        vault = tempfile.mkdtemp()  # outside the app, as config.json allows
        self.addCleanup(shutil.rmtree, vault)
        for rel in ('tasks/TSK-0001.md', 'notes/NOTE-0001.md', '.task-manager/ids.json', '.task-manager/trash/TSK-0002.md'):
            touch(vault, rel)
        touch(vault, '.DS_Store')
        os.makedirs(os.path.join(vault, 'activities'))  # empty, still part of the vault
        outside = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outside)
        touch(outside, 'private.txt')
        os.symlink(os.path.join(outside, 'private.txt'), os.path.join(vault, 'notes', 'link.txt'))
        rec = export.create(self.app, vault_root=vault, kind='vault', now=datetime(2026, 10, 16, 9, 30))
        names, meta = self.zip_names(rec)
        self.assertEqual(names - {'VERSION.json'}, {'vault/tasks/TSK-0001.md', 'vault/notes/NOTE-0001.md', 'vault/activities/',
                                                     'vault/.task-manager/ids.json', 'vault/.task-manager/trash/TSK-0002.md'})
        self.assertEqual((meta['kind'], meta['files'], meta['vault_root']), ('vault', 4, os.path.realpath(vault)))
        self.assertTrue(rec['name'].startswith('vault-task-manager-system-2026-10-16_0930'))
        self.assertEqual([r['kind'] for r in export.list_exports(self.app)], ['vault'])

    def test_a_vault_holding_the_app_does_not_swallow_the_zips(self):
        rec = export.create(self.app, vault_root=self.app, kind='vault')
        names, _ = self.zip_names(rec)
        self.assertIn('vault/server.py', names)
        self.assertFalse(any(n.startswith('vault/versions/') or '/.git/' in n for n in names))
        with self.assertRaises(export.ExportError):
            export.create(self.app, vault_root=os.path.join(self.app, 'nope'), kind='vault')

    def test_an_export_from_before_the_kinds_lists_as_system(self):
        rec = export.create(self.app)
        path = os.path.join(self.app, 'versions', rec['name'])
        old = os.path.join(self.app, 'versions', 'task-manager-2026-10-01_1000-abc1234-host.zip')
        with zipfile.ZipFile(path) as src, zipfile.ZipFile(old, 'w') as dst:
            meta = json.loads(src.read('VERSION.json'))
            meta.pop('kind')
            dst.writestr('VERSION.json', json.dumps(meta))
        self.assertEqual({r['name']: r['kind'] for r in export.list_exports(self.app)}[os.path.basename(old)], 'system')

    def test_claudes_local_permissions_stay_out_of_the_agents(self):
        touch(self.app, '.claude/settings.local.json')
        touch(self.app, '.claude/settings.json')
        names, _ = self.zip_names(export.create(self.app, kind='agents'))
        self.assertIn('.claude/settings.json', names)
        self.assertNotIn('.claude/settings.local.json', names)

    def test_a_vault_zip_goes_under_its_id_and_says_how_to_register_it(self):
        vault = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, vault)
        touch(vault, 'Tasks/TSK-001 A.md')
        rec = export.create(self.app, vault_root=vault, kind='vault', vault_id='projects-tickets',
                            vault_info={'name': 'Projects & Tickets', 'structure': 'ticketing', 'disabled_types': ['agent'],
                                        'path': '/never/in/the/zip'})
        names, meta = self.zip_names(rec)
        self.assertEqual(names - {'VERSION.json'}, {'vault-projects-tickets/Tasks/TSK-001 A.md'})
        self.assertEqual((meta['vault_dir'], meta['name'], meta['structure'], meta['disabled_types']),
                         ('vault-projects-tickets', 'Projects & Tickets', 'ticketing', ['agent']))
        self.assertNotIn('path', meta)

    def test_a_broken_version_json_still_lists(self):
        os.makedirs(os.path.join(self.app, 'versions'), exist_ok=True)
        bad = os.path.join(self.app, 'versions', 'system-task-manager-system-2026-10-01_1000-host.zip')
        with zipfile.ZipFile(bad, 'w') as z:
            z.writestr('VERSION.json', '{not json')
        with open(os.path.join(self.app, 'versions', 'vault-task-manager-system-2026-10-02_1000-host.zip'), 'w') as f:
            f.write('not a zip')
        self.assertEqual(sorted(r['kind'] for r in export.list_exports(self.app)), ['system', 'system'])

    def test_a_zip_cut_off_mid_write_is_cleared_once_stale(self):
        d = os.path.join(self.app, 'versions')
        os.makedirs(d, exist_ok=True)
        old, fresh = (os.path.join(d, f'vault-task-manager-system-2026-10-0{n}_1000-host.zip.part') for n in (1, 2))
        for p in (old, fresh):
            touch(d, os.path.basename(p))
        os.utime(old, (1000, 1000))
        export.list_exports(self.app, now=1000 + export.STALE_PART_S + 1)
        self.assertFalse(os.path.exists(old))
        self.assertTrue(os.path.exists(fresh))

    def test_outside_a_git_repo_it_still_exports(self):
        info = export.git_info(self.app)  # a temp folder: no repo
        self.assertEqual((info['branch'], info['sha'], info['dirty']), ('', '', False))
        rec = export.create(self.app, now=datetime(2026, 10, 16, 9, 30))
        self.assertNotIn('dirty', rec['name'])

    def test_an_installed_copy_exports_the_checkout_it_came_from(self):
        installed = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, installed)
        self.assertEqual(export.home(installed), (installed, ''))  # no install.json: a checkout, itself
        touch(installed, export.INSTALL_FILE, json.dumps({'source': self.app}))
        self.assertEqual(export.home(installed), (self.app, ''))
        touch(installed, export.INSTALL_FILE, json.dumps({'source': os.path.join(self.app, 'gone')}))
        src, why = export.home(installed)
        self.assertEqual(src, installed)
        self.assertIn('only a vault', why)
        touch(installed, export.INSTALL_FILE, '[broken')
        self.assertEqual(export.home(installed)[0], installed)

    def test_two_exports_in_the_same_minute_do_not_overwrite(self):
        now = datetime(2026, 10, 16, 9, 30)
        a = export.create(self.app, now=now)
        b = export.create(self.app, now=now)
        self.assertNotEqual(a['name'], b['name'])


if __name__ == '__main__':
    unittest.main()
