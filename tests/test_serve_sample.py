"""tools/serve_sample.py: what the sample launch configs serve is a temp copy, with a temp config.json, never the
real vaults or the real config.json."""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

import server
from tests.test_vaults import tree_hash

sys.path.insert(0, os.path.join(server.APP_DIR, 'tools'))
import serve_sample  # noqa: E402

REAL_CONFIG = os.path.join(server.APP_DIR, 'config.json')


def real_vault_paths():
    """The folders of the vaults in the real config.json (none when there is no such file)."""
    try:
        with open(REAL_CONFIG, encoding='utf-8') as f:
            cfg = json.load(f)
    except FileNotFoundError:
        return set()
    paths = [v.get('path') for v in cfg.get('vaults') or [] if isinstance(v, dict)] + [cfg.get('root')]
    return {server.resolve_root(p) for p in paths if p}


def read_bytes(path):
    try:
        with open(path, 'rb') as f:
            return f.read()
    except FileNotFoundError:
        return None


class ServeSampleTest(unittest.TestCase):
    def setUp(self):
        # setup() rewires the shared `server` module: put it back as it was for the other tests
        patcher = mock.patch.object(server, 'CONFIG_PATH', server.CONFIG_PATH)
        patcher.start()
        self.addCleanup(patcher.stop)
        config, stores = server.APP.config, server.APP.stores
        self.addCleanup(setattr, server.APP, 'config', config)
        self.addCleanup(setattr, server.APP, 'stores', stores)
        quiet = contextlib.redirect_stdout(io.StringIO())
        quiet.__enter__()
        self.addCleanup(quiet.__exit__, None, None, None)

    def serve(self, **kw):
        tmp = serve_sample.setup(0, **kw)
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        return os.path.realpath(tmp)

    def assert_inside(self, path, folder):
        real = os.path.realpath(path)
        self.assertTrue(real.startswith(folder + os.sep), f'{real} is not inside {folder}')

    def test_every_vault_is_a_temp_copy_and_config_path_is_redirected(self):
        tmp = self.serve(ticketing=True)
        self.assertTrue(tmp.startswith(os.path.realpath(tempfile.gettempdir()) + os.sep))
        self.assert_inside(server.CONFIG_PATH, tmp)
        self.assertNotEqual(os.path.realpath(server.CONFIG_PATH), os.path.realpath(REAL_CONFIG))
        vaults = server.APP.config['vaults']
        self.assertEqual([(v['id'], v['structure']) for v in vaults], [('sample', 'folders'), ('tickets', 'ticketing')])
        self.assertEqual(server.APP.config['default_vault'], 'sample')
        real = real_vault_paths()
        for v in vaults:
            self.assert_inside(v['path'], tmp)
            self.assertNotIn(server.resolve_root(v['path']), real)
            self.assertNotEqual(server.resolve_root(v['path']), os.path.realpath(serve_sample.SAMPLE_VAULT))
            store = server.APP.store_for(v['id'])
            self.assert_inside(store.root, tmp)
            self.assertTrue(store.check()['ok'], store.check())
        self.assert_inside(server.APP.config['root'], tmp)

    def test_using_it_writes_neither_the_sample_vault_nor_the_real_config(self):
        sample_before, config_before = tree_hash(serve_sample.SAMPLE_VAULT), read_bytes(REAL_CONFIG)
        tmp = self.serve()
        self.assert_inside(server.APP.store.root, tmp)  # before writing: a broken setup must not write into the repo
        server.APP.store.create('task', 'Written into the copy', {})
        server.APP.set_config({'work_kinds': ['Only in the temp config']})
        with open(server.CONFIG_PATH, encoding='utf-8') as f:
            self.assertEqual(json.load(f)['work_kinds'], ['Only in the temp config'])
        self.assertEqual(tree_hash(serve_sample.SAMPLE_VAULT), sample_before)
        self.assertEqual(read_bytes(REAL_CONFIG), config_before)


if __name__ == '__main__':
    unittest.main()
