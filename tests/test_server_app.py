"""Settings → App: the server's status and Stop (server_status, stop_server), and the launchd socket's fallback."""
import threading
import time
import unittest
from unittest import mock

import server
from tm.launchd import activated_sockets


class ServerAppTest(unittest.TestCase):
    def setUp(self):
        saved = dict(server.SERVER)
        self.addCleanup(lambda: server.SERVER.update(saved))

    def test_status_says_how_it_runs(self):
        server.SERVER.update(on_demand=True, started_at=time.time() - 125, port=3200)
        s = server.server_status()
        self.assertEqual((s['on_demand'], s['port']), (True, 3200))
        self.assertGreaterEqual(s['uptime_s'], 125)
        self.assertEqual(s['app_dir'], server.APP_DIR)

    def test_stop_answers_first_then_stops(self):
        stopped = threading.Event()
        server.SERVER.update(stop=stopped.set, on_demand=True)
        self.assertEqual(server.stop_server(), {'stopping': True, 'on_demand': True})
        self.assertFalse(stopped.is_set())  # the answer goes out before the server ends
        self.assertTrue(stopped.wait(2))

    def test_stop_before_main_does_nothing(self):
        server.SERVER.update(stop=None, on_demand=False)
        self.assertEqual(server.stop_server(), {'stopping': False, 'on_demand': False})

    def test_both_are_global_routes(self):
        self.assertIn(('GET', '/api/server'), server.GLOBAL_ROUTES)
        self.assertIn(('POST', '/api/server/stop'), server.GLOBAL_ROUTES)


class LaunchdSocketTest(unittest.TestCase):
    def test_none_outside_launchd_or_macos(self):
        self.assertEqual(activated_sockets(), [])  # not started by launchd
        with mock.patch('tm.launchd.sys.platform', 'linux'):
            self.assertEqual(activated_sockets(), [])


if __name__ == '__main__':
    unittest.main()
