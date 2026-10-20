"""open_local: only plain folders are opened; anything that could launch is revealed."""
import os
import tempfile
import unittest
from unittest import mock

import server


class OpenLocalTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.addCleanup(self.tmp.cleanup)

    def run_open(self, rel, is_dir=True):
        path = os.path.join(self.root, rel)
        if is_dir:
            os.makedirs(path)
        else:
            open(path, 'w').close()
        with mock.patch.object(server.sys, 'platform', 'darwin'), \
                mock.patch.object(server.subprocess, 'run') as run:
            out = server.open_local(path)
        return run.call_args[0][0], out

    def test_plain_folder_is_opened(self):
        cmd, out = self.run_open('work')
        self.assertEqual(cmd[:2], ['open', os.path.realpath(os.path.join(self.root, 'work'))])
        self.assertIn('opened', out)

    def test_bundles_are_revealed_whatever_the_case(self):
        for name in ('Lower.app', 'Upper.APP', 'Mixed.App', 'Pane.prefPane', 'Shot.saver',
                     'Setup.mpkg', 'Flow.workflow', 'Thing.plugin', 'odd.dir'):
            with self.subTest(name=name):
                cmd, out = self.run_open(name)
                self.assertEqual(cmd[:2], ['open', '-R'])
                self.assertIn('revealed', out)

    def test_dot_names_are_revealed(self):
        for name in ('.app', '.prefPane', '.config'):
            with self.subTest(name=name):
                cmd, _ = self.run_open(name)
                self.assertEqual(cmd[:2], ['open', '-R'])

    def test_extensionless_bundle_is_revealed(self):
        # An extensionless folder with Finder's bundle bit is a package to macOS;
        # with a Contents/ it could carry an executable, so it is never opened.
        os.makedirs(os.path.join(self.root, 'Sneaky', 'Contents', 'MacOS'))
        with mock.patch.object(server.sys, 'platform', 'darwin'), \
                mock.patch.object(server.subprocess, 'run') as run:
            server.open_local(os.path.join(self.root, 'Sneaky'))
        self.assertEqual(run.call_args[0][0][:2], ['open', '-R'])

    def test_files_are_revealed(self):
        for name in ('run.command', 'x.sh', 'notes.md'):
            with self.subTest(name=name):
                cmd, _ = self.run_open(name, is_dir=False)
                self.assertEqual(cmd[:2], ['open', '-R'])

    def test_missing_path_is_404(self):
        with self.assertRaises(server.StoreError):
            server.open_local(os.path.join(self.root, 'nope'))


if __name__ == '__main__':
    unittest.main()


class OpenInEditorTest(unittest.TestCase):
    """The Explorer's "Open in <editor>": `open -a <app>` on a vault path, the app from a closed list."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.store = server.Store(os.path.realpath(tmp.name))
        os.makedirs(os.path.join(self.store.root, 'notes'))
        open(os.path.join(self.store.root, 'notes', 'a.md'), 'w').close()
        self.saved = dict(server.APP.config)
        self.addCleanup(lambda: (server.APP.config.clear(), server.APP.config.update(self.saved)))

    def run_open(self, path, app='Cursor'):
        server.APP.config['editor_app'] = app
        with mock.patch.object(server.sys, 'platform', 'darwin'), mock.patch.object(server.subprocess, 'run') as run:
            out = server.open_in_editor(self.store, path)
        return run.call_args[0][0], out

    def test_hands_a_vault_file_or_folder_to_the_editor(self):
        cmd, out = self.run_open('notes/a.md')
        self.assertEqual(cmd, ['open', '-a', 'Cursor', os.path.join(self.store.root, 'notes', 'a.md')])
        self.assertEqual(out, {'opened': 'notes/a.md', 'app': 'Cursor'})
        self.assertEqual(self.run_open('', 'Zed')[0], ['open', '-a', 'Zed', self.store.root])

    def test_only_inside_the_vault_and_only_a_listed_app(self):
        for path, app, status in (('../x', 'Cursor', 400), ('.obsidian', 'Cursor', 400), ('notes/nope.md', 'Cursor', 404),
                                  ('notes/a.md', '/bin/sh', 400)):
            with self.subTest(path=path, app=app), self.assertRaises(server.StoreError) as e:
                self.run_open(path, app)
            self.assertEqual(e.exception.status, status)
