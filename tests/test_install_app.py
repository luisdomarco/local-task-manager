"""tools/install_app.py: the app's own folder, its config made once, its LaunchAgent — on temporary folders, with
launchctl recorded instead of run."""
import json
import os
import plistlib
import tempfile
import unittest

from tools import install_app as ia


def write(root, rel, text=''):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


class InstallAppTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.src = os.path.join(tmp.name, 'checkout')
        self.home = os.path.join(tmp.name, 'home')
        write(self.src, 'server.py', 'v1')
        write(self.src, 'tm/store.py', 'store')
        write(self.src, 'tm/__pycache__/store.cpython-312.pyc', 'x')
        write(self.src, 'static/index.html', '<html>')
        write(self.src, 'tests/test_x.py', 'never copied')
        write(self.src, 'config.json', json.dumps({'port': 3100, 'root': 'vault-a',
                                                   'vaults': [{'id': 'a', 'path': 'vault-a'}, {'id': 'b', 'path': '/abs/b'}]}))
        self.calls = []
        self.run = lambda cmd, check=True: self.calls.append(cmd[:2])
        self.where = ia.locations(self.home)
        self.waited = []
        self.wait = self.waited.append  # the real one asks launchctl and binds the port

    def test_install_copies_the_code_makes_its_config_and_starts_the_agent(self):
        out = ia.install(self.src, self.home, '/usr/bin/python3', self.run, wait=self.wait)
        app = self.where['app']
        self.assertTrue(out['config_made'])
        self.assertTrue(os.path.isfile(os.path.join(app, 'server.py')))
        self.assertTrue(os.path.isfile(os.path.join(app, 'tm', 'store.py')))
        self.assertFalse(os.path.exists(os.path.join(app, 'tm', '__pycache__')))
        self.assertFalse(os.path.exists(os.path.join(app, 'tests')))
        with open(os.path.join(app, 'config.json'), encoding='utf-8') as f:
            cfg = json.load(f)
        self.assertEqual(cfg['port'], 3200)
        self.assertEqual([v['path'] for v in cfg['vaults']], [os.path.join(self.src, 'vault-a'), '/abs/b'])
        self.assertEqual(cfg['root'], os.path.join(self.src, 'vault-a'))
        with open(self.where['plist'], 'rb') as f:
            agent = plistlib.load(f)
        self.assertEqual(agent['Label'], ia.LABEL)
        self.assertEqual(agent['ProgramArguments'], ['/usr/bin/python3', os.path.join(app, 'server.py')])
        # On demand: launchd listens on its port and starts it on the first connection; nothing at login, no KeepAlive.
        self.assertNotIn('KeepAlive', agent)
        self.assertNotIn('RunAtLoad', agent)
        self.assertEqual(agent['Sockets']['Listeners'], {'SockNodeName': '127.0.0.1', 'SockServiceName': '3200',
                                                         'SockType': 'stream', 'SockFamily': 'IPv4'})
        self.assertIn(f'{self.home}/.local/bin', agent['EnvironmentVariables']['PATH'])
        self.assertEqual(self.calls, [['launchctl', 'bootout'], ['launchctl', 'bootstrap']])
        self.assertEqual(self.waited, [3200])  # the old agent let go of its port before the new one takes it
        # Settings → Export in the app exports this checkout, not the copy (tm/export.py home())
        with open(os.path.join(app, 'install.json'), encoding='utf-8') as f:
            self.assertEqual(json.load(f), {'source': os.path.realpath(self.src)})

    def test_its_config_is_never_overwritten_and_update_brings_only_the_code(self):
        ia.install(self.src, self.home, '/usr/bin/python3', self.run, wait=self.wait)
        cfg_path = os.path.join(self.where['app'], 'config.json')
        write(self.where['app'], 'config.json', '{"port": 3333}')  # changed in the app's Settings
        write(self.src, 'server.py', 'v2')
        self.assertFalse(ia.install(self.src, self.home, '/usr/bin/python3', self.run, wait=self.wait)['config_made'])
        ia.update(self.src, self.home, self.run)
        with open(cfg_path, encoding='utf-8') as f:
            self.assertEqual(json.load(f)['port'], 3333)
        with open(os.path.join(self.where['app'], 'server.py'), encoding='utf-8') as f:
            self.assertEqual(f.read(), 'v2')
        self.assertEqual(self.calls[-1], ['launchctl', 'kill'])

    def test_uninstall_takes_the_code_and_the_agent_and_keeps_its_config(self):
        ia.install(self.src, self.home, '/usr/bin/python3', self.run, wait=self.wait)
        ia.uninstall(self.home, self.run)
        self.assertFalse(os.path.exists(self.where['plist']))
        self.assertFalse(os.path.exists(os.path.join(self.where['app'], 'server.py')))
        self.assertFalse(os.path.exists(os.path.join(self.where['app'], 'install.json')))
        self.assertTrue(os.path.exists(os.path.join(self.where['app'], 'config.json')))

    def test_update_before_an_install_says_so(self):
        with self.assertRaises(SystemExit):
            ia.update(self.src, self.home, self.run)


if __name__ == '__main__':
    unittest.main()
