"""The CLI's shim in a vault (tm/vaultshim.py) and what SUP-407 was about: the vault's guide for agents names
`.task-manager/vault.py`, a path relative to the vault, and never the absolute path of the copy of the app that wrote
it — so the line does not flip between the installed app, a checkout, a worktree and an iPhone bundle on every write.

Three things are fixed here: the generated block holds no absolute path of the app; the shim finds the engine when
there is one (an override, the installed app, a checkout a vault sits in) and passes it the arguments, the exit code
and the vault; and it says where it looked, without a traceback, when there is none. On temp copies of the sample only.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from tm import agentsmd, vaultshim
from tm.store import Store
from tools import install_app
from tools.serve_sample import copy_sample

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLE = os.path.join(APP_DIR, 'sample-vault')
# A stand-in engine: it says which app folder it was run from, which vault it was told, and what it was passed, and
# exits 7 — so a test can tell which copy the shim picked and that nothing is added or swallowed in between.
STUB = ('import os, sys\n'
        "print('APP', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))\n"
        "print('TM_VAULT', os.environ.get('TM_VAULT', ''))\n"
        "print('ARGS', '|'.join(sys.argv[1:]))\n"
        'sys.exit(7)\n')


class ShimBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='tm-vault-shim-')

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def vault(self, at='vault'):
        """A folder with the shim in it (no items needed: the stub engine never reads the vault)."""
        root = os.path.join(self.tmp, at)
        os.makedirs(os.path.join(root, '.task-manager'))
        vaultshim.write(root)
        return root

    def stub_app(self, at):
        """An app folder at `at` whose tools/vault.py is the stub. `tm/store.py` too: the shim wants both before it
        runs a folder, so a folder that only happens to hold a vault.py is never taken for the app."""
        os.makedirs(os.path.join(at, 'tools'), exist_ok=True)
        os.makedirs(os.path.join(at, 'tm'), exist_ok=True)
        with open(os.path.join(at, 'tools', 'vault.py'), 'w', encoding='utf-8') as f:
            f.write(STUB)
        open(os.path.join(at, 'tm', 'store.py'), 'w').close()
        return at

    def run_shim(self, root, *argv, home=None, app=None, cwd=None):
        env = {k: v for k, v in os.environ.items() if k not in ('TASK_MANAGER_APP', 'TM_VAULT')}
        env['HOME'] = home if home is not None else os.path.join(self.tmp, 'empty-home')
        if app:
            env['TASK_MANAGER_APP'] = app
        return subprocess.run([sys.executable, vaultshim.path(root), *argv], env=env, cwd=cwd or self.tmp,
                              capture_output=True, text=True, timeout=120)


class WrittenTest(ShimBase):
    def test_it_is_written_once_and_left_alone_when_it_is_already_that_text(self):
        root = os.path.join(self.tmp, 'vault')
        os.makedirs(root)
        self.assertTrue(vaultshim.write(root), 'its folder is made if it is missing')
        before = os.stat(vaultshim.path(root))
        self.assertFalse(vaultshim.write(root), 'the same text: not written again')
        self.assertEqual(os.stat(vaultshim.path(root)).st_ino, before.st_ino)
        self.assertTrue(vaultshim.remove(root))
        self.assertFalse(vaultshim.remove(root), 'nothing to take away')

    def test_a_link_in_its_place_is_replaced_and_never_written_through(self):
        """fsutil.atomic_write resolves the path first, so a link there would send the app's own file — and the chmod
        that follows it — somewhere outside the vault. The vault's AGENTS.md is refused for the same reason."""
        root = self.vault()
        outside = os.path.join(self.tmp, 'outside.txt')
        with open(outside, 'w', encoding='utf-8') as f:
            f.write("not the vault's\n")
        os.remove(vaultshim.path(root))
        os.symlink(outside, vaultshim.path(root))
        self.assertTrue(vaultshim.write(root))
        with open(outside, encoding='utf-8') as f:
            self.assertEqual(f.read(), "not the vault's\n", 'the file the link pointed at is untouched')
        self.assertEqual(oct(os.stat(outside).st_mode)[-3:], '644', 'and its mode is left alone')
        self.assertFalse(os.path.islink(vaultshim.path(root)))
        with open(vaultshim.path(root), encoding='utf-8') as f:
            self.assertEqual(f.read(), vaultshim.SOURCE)

    def test_it_holds_no_path_of_the_machine_that_wrote_it(self):
        """The whole point: the same bytes on every device, so iCloud never carries one Mac's layout to the next."""
        self.assertNotIn(APP_DIR, vaultshim.SOURCE)
        self.assertNotIn(os.path.expanduser('~'), vaultshim.SOURCE)
        with open(vaultshim.path(self.vault()), encoding='utf-8') as f:
            self.assertEqual(vaultshim.SOURCE, f.read())


class ResolveTest(ShimBase):
    """(b) The shim finds the engine when there is one, and hands it everything unchanged."""

    def test_the_override_wins_and_the_arguments_exit_code_and_vault_go_through(self):
        root = self.vault()
        app = self.stub_app(os.path.join(self.tmp, 'given'))
        run = self.run_shim(root, 'find', '', '--project', 'A B', app=app)
        self.assertEqual(run.returncode, 7, run.stderr)
        self.assertIn(f'APP {app}', run.stdout)
        self.assertIn('ARGS find||--project|A B', run.stdout, 'every argument as it was, empty one included')
        self.assertIn(f'TM_VAULT {root}', run.stdout, 'called from outside the vault, it still means its own')

    def test_the_caller_still_decides_which_vault(self):
        root = self.vault()
        app = self.stub_app(os.path.join(self.tmp, 'given'))
        other = os.path.join(self.tmp, 'another-vault')
        env_run = subprocess.run([sys.executable, vaultshim.path(root), 'overview'], capture_output=True, text=True,
                                 timeout=120, cwd=self.tmp,
                                 env={**os.environ, 'TASK_MANAGER_APP': app, 'TM_VAULT': other})
        self.assertIn(f'TM_VAULT {other}', env_run.stdout, '$TM_VAULT is a default, never overridden')
        self.assertIn('ARGS overview', self.run_shim(root, 'overview', app=app).stdout)

    def test_without_an_override_it_is_the_app_installed_under_the_home(self):
        """And it is the very folder tools/install_app.py installs into: the two read one constant, so a change to
        where the app is installed cannot leave the shim looking in the old place (SUP-407's fourth-copy trap)."""
        root = self.vault()
        home = os.path.join(self.tmp, 'home')
        app = self.stub_app(install_app.locations(home)['app'])
        run = self.run_shim(root, 'overview', home=home)
        self.assertEqual(run.returncode, 7, run.stderr)
        self.assertIn(f'APP {app}', run.stdout)

    def test_a_vault_inside_a_checkout_falls_back_to_that_checkout(self):
        """A sample vault in a clone of the app, on a machine where nothing is installed: derived from where the shim
        itself is, so no checkout's path is ever written down."""
        app = self.stub_app(os.path.join(self.tmp, 'checkout'))
        root = self.vault(os.path.join('checkout', 'sample-vault'))
        run = self.run_shim(root, 'check')
        self.assertEqual(run.returncode, 7, run.stderr)
        self.assertIn(f'APP {app}', run.stdout)

    def test_a_folder_that_only_holds_a_vault_py_is_not_taken_for_the_app(self):
        root = self.vault()
        app = os.path.join(self.tmp, 'not-the-app')
        os.makedirs(os.path.join(app, 'tools'))
        with open(os.path.join(app, 'tools', 'vault.py'), 'w', encoding='utf-8') as f:
            f.write('raise SystemExit("should never run")\n')
        run = self.run_shim(root, 'overview', app=app)
        self.assertEqual(run.returncode, vaultshim.EXIT_NO_ENGINE)
        self.assertNotIn('should never run', run.stdout + run.stderr)


class NoEngineTest(ShimBase):
    """(c) Nothing installed: it says where it looked and how to fix it, and is not a traceback."""

    def test_it_names_every_place_it_looked_and_what_to_do(self):
        root = self.vault()
        run = self.run_shim(root, 'overview')
        self.assertEqual(run.returncode, vaultshim.EXIT_NO_ENGINE)
        self.assertEqual(run.stdout, '', 'nothing on stdout: a caller reading it is not fed a message')
        self.assertNotIn('Traceback', run.stderr)
        err = run.stderr
        self.assertIn('no Task Manager app on this machine', err)
        self.assertIn(f'${vaultshim.ENV}', err)
        self.assertIn(os.path.join(vaultshim.installed_app(os.path.join(self.tmp, 'empty-home')), 'tools', 'vault.py'), err)
        self.assertIn(vaultshim.IOS_GLOB, err, 'the iPhone bundle, by glob: its folder is a new UUID every install')
        self.assertIn(os.path.join(self.tmp, 'tools', 'vault.py'), err, 'and the folder above the vault')
        self.assertIn('install_app.py', err)


class TwoCopiesTest(ShimBase):
    """The defect as it was measured: two copies of the app on one machine, both of them desktop, writing to the same
    vault in turn. Every write refreshes the guide (tools/vault.py WRITES — a bare `comment` is one), so the block used
    to be resealed with the folder of whichever copy ran, and a bumped mtime on AGENTS.md was the signal that a
    divergent copy had written. Now the three copies write the same text, so the file is not touched at all."""

    def copy_of_the_app(self, name):
        """An app folder of its own whose tm/ and tools/ are this checkout's: a different APP_DIR, the same code, which
        is what made the defect so hard to see — no copy was wrong, only the path each one wrote down."""
        app = os.path.join(self.tmp, name)
        os.makedirs(app)
        for d in ('tm', 'tools'):
            os.symlink(os.path.join(APP_DIR, d), os.path.join(app, d))
        return app

    def test_writes_from_three_copies_of_the_app_leave_the_guide_byte_for_byte(self):
        root = copy_sample(SAMPLE, os.path.join(self.tmp, 'vault'))
        store = Store(root, None, 'ticketing', enforce_structure=True)
        store.set_agents_md(True)
        guide = os.path.join(root, 'AGENTS.md')
        with open(guide, encoding='utf-8') as f:
            before = f.read()
        was = os.stat(guide)
        for name in ('installed-app', 'checkout', 'worktree'):
            app = self.copy_of_the_app(name)
            run = subprocess.run([sys.executable, os.path.join(app, 'tools', 'vault.py'), '-C', root,
                                  'comment', 'STY-5', f'written by the {name} copy'],
                                 capture_output=True, text=True, timeout=120)
            self.assertEqual(run.returncode, 0, run.stderr)
        with open(guide, encoding='utf-8') as f:
            self.assertEqual(f.read(), before, 'the guide says the same whichever copy of the app wrote last')
        self.assertEqual(os.stat(guide).st_ino, was.st_ino, 'and was not rewritten at all')
        self.assertNotIn(self.tmp, before, "no copy's own folder is in it")


class GuideTest(unittest.TestCase):
    """(a) The generated block names the shim, and no absolute path of any app."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix='tm-vault-shim-guide-')
        cls.root = copy_sample(SAMPLE, os.path.join(cls.tmp, 'vault'))
        cls.s = Store(cls.root, None, 'ticketing', enforce_structure=True)
        cls.s.set_agents_md(True)
        with open(os.path.join(cls.root, 'AGENTS.md'), encoding='utf-8') as f:
            cls.block = agentsmd.block_of(f.read())

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_every_command_is_the_shim_by_its_path_relative_to_the_vault(self):
        commands = [ln for ln in self.block.splitlines() if 'vault.py' in ln and ln.startswith('python3 ')]
        self.assertGreaterEqual(len(commands), 15)
        for line in commands:
            self.assertTrue(line.startswith(f'python3 {vaultshim.REL} '), line)
        self.assertTrue(os.path.isfile(vaultshim.path(self.root)), 'and the file it names is there')

    def test_no_absolute_path_of_any_copy_of_the_app_is_in_it(self):
        """The defect: four values were seen for this line — the installed app, this checkout, a worktree and an iOS
        bundle — because it was built from the folder of whichever copy wrote it."""
        self.assertNotIn(APP_DIR, self.block)
        self.assertNotIn(vaultshim.installed_app(os.path.expanduser('~')), self.block)
        self.assertNotIn('/private/var/containers/', self.block)
        self.assertNotRegex(self.block, r'(?m)^\S*python3 \S*/tools/vault\.py')
        self.assertNotRegex(self.block, r'/[^\s`\'"]*/tools/vault\.py')

    def test_render_is_given_no_app_folder_to_seal_in(self):
        """Not a style point: as long as the block is built from an app folder, the next write from another copy
        reseals it. There is nothing to pass, so there is nothing to drift."""
        import inspect
        self.assertEqual([p for p in inspect.signature(agentsmd.render).parameters], ['info', 'python'])
        self.assertEqual(agentsmd.render(self.s.agents_info()), self.block)


if __name__ == '__main__':
    unittest.main()
