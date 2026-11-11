"""What the page is told this platform has: everything on a computer, none of the desktop-only features on a phone."""
import os
import sys
import unittest
from unittest import mock

import server
from tests.test_vaults import VaultsBase


class PlatformTest(unittest.TestCase):
    def test_the_platform_is_the_systems_unless_tm_platform_says_otherwise(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('TM_PLATFORM', None)
            self.assertEqual(server.platform(), sys.platform)
            os.environ['TM_PLATFORM'] = 'ios'
            self.assertEqual(server.platform(), 'ios')
            os.environ['TM_PLATFORM'] = ''  # set but empty: the system's
            self.assertEqual(server.platform(), sys.platform)

    def test_a_computer_has_every_feature_and_a_phone_none(self):
        for name, on in (('darwin', True), ('linux', True), ('win32', True), ('ios', False), ('android', False)):
            with self.subTest(name), mock.patch.dict(os.environ, {'TM_PLATFORM': name}):
                f = server.features()
                self.assertEqual(set(f), set(server.DESKTOP_FEATURES))
                self.assertEqual(set(f.values()), {on})


class ConfigFeaturesTest(VaultsBase):
    def config(self, platform):
        self.write_config({'root': self.a, 'vaults': [{'id': 'a', 'name': 'A', 'path': self.a, 'structure': 'ticketing'}]})
        with mock.patch.dict(os.environ, {'TM_PLATFORM': platform}):
            return server.App().public_config()

    def test_the_page_is_told_the_platform_and_its_features(self):
        c = self.config('ios')
        self.assertEqual(c['platform'], 'ios')
        self.assertFalse(any(c['features'].values()))
        self.assertFalse(c['can_pick_folder'])  # no Finder to choose a folder in
        c = self.config('darwin')
        self.assertEqual(c['platform'], 'darwin')
        self.assertTrue(all(c['features'].values()))
        self.assertTrue(c['can_pick_folder'])


if __name__ == '__main__':
    unittest.main()
