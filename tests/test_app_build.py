"""server.app_build: the commit a copy of the app runs, for Settings → Documentation — the iPhone bundle's CORE_COMMIT,
else the installed Mac app's install.json, else nothing."""

import json
import os
import tempfile
import unittest

import server

SHA = 'c698a38cc647f4f42c866e2ce623b7ff27fc15ac'


class AppBuildTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = tmp.name

    def write(self, name, text):
        with open(os.path.join(self.dir, name), 'w', encoding='utf-8') as f:
            f.write(text)

    def test_the_iphone_bundle_says_its_core_commit_and_when_it_was_built(self):
        self.write('CORE_COMMIT', SHA + '\n')
        os.utime(os.path.join(self.dir, 'CORE_COMMIT'), (1795813707, 1795813707))
        build = server.app_build(self.dir)
        self.assertEqual(build['commit'], SHA)
        self.assertTrue(build['built_at'].startswith('2026-11-'), build)

    def test_the_mac_install_says_its_deployed_sha(self):
        self.write('install.json', json.dumps({'source': '/x', 'deployed_sha': SHA, 'deployed_at': '2026-11-27T22:30:00'}))
        self.assertEqual(server.app_build(self.dir), {'commit': SHA, 'built_at': '2026-11-27T22:30:00'})

    def test_a_copy_that_cannot_say_says_nothing(self):
        self.assertIsNone(server.app_build(self.dir))  # a server started by hand from a checkout
        self.write('install.json', json.dumps({'source': '/x'}))  # an install from before deployed_sha
        self.assertIsNone(server.app_build(self.dir))
        self.write('CORE_COMMIT', 'main\n')  # not a commit
        self.assertIsNone(server.app_build(self.dir))

    def test_the_guide_carries_it(self):
        self.assertIn('build', server.user_guide())


if __name__ == '__main__':
    unittest.main()
