"""Reminders (tm/reminders.py): an item planned for a day at a time, or a meeting, rings before it starts, with its own
offsets or the vault's default (Settings → Reminders, kept in the vault), live; the Mac and the iPhone read the same
list (GET /api/reminders)."""
import contextlib
import datetime as dt
import io
import json
import os
import re
import tempfile
import unittest
from unittest import mock

import server
from tm import reminders, vaultsettings
from tm.store import StoreError

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TICKET_FOLDERS = ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log')
D = reminders.DEFAULTS


def item(**fields):
    return {'key': fields.pop('key', 'T1'), 'ref': 'TSK-1', 'title': 'Vet', 'type': fields.pop('type', 'task'), 'fields': fields}


class EngineTest(unittest.TestCase):
    def test_moment_is_the_planned_day_at_its_time_or_a_meetings(self):
        self.assertEqual(reminders.moment({'plan_day': '2026-11-19', 'plan_time': '13:30'}), dt.datetime(2026, 11, 19, 13, 30))
        self.assertEqual(reminders.moment({'date': '2026-11-19', 'time': '9:05'}), dt.datetime(2026, 11, 19, 9, 5))
        for none in ({'plan_day': '2026-11-19'}, {'plan_time': '13:30'}, {'plan_week': '2026-W47', 'plan_time': '13:30'},
                     {'plan_day': 'soon', 'plan_time': '13:30'}, {'plan_day': '2026-02-30', 'plan_time': '13:30'}):
            with self.subTest(none):
                self.assertIsNone(reminders.moment(none))

    def test_an_item_with_none_of_its_own_follows_the_default_live(self):
        f = {'plan_day': '2026-11-19', 'plan_time': '13:30'}
        self.assertEqual(reminders.effective(f, D)['offsets'], ['10m'])
        self.assertTrue(reminders.effective(f, D)['inherited'])
        other = {**D, 'offsets': ['at', '1h'], 'urgent': True}
        self.assertEqual(reminders.effective(f, other), {'offsets': ['at', '1h'], 'urgent': True, 'duration': 30, 'inherited': True})
        self.assertEqual(reminders.effective(f, {**D, 'on': False})['offsets'], [])

    def test_its_own_wins_and_an_empty_list_is_none(self):
        f = {'plan_day': '2026-11-19', 'plan_time': '13:30', 'reminders': ['1d', 'at'], 'reminder_urgent': False,
             'plan_duration': '01:15'}
        self.assertEqual(reminders.effective(f, {**D, 'urgent': True}),
                         {'offsets': ['at', '1d'], 'urgent': False, 'duration': 75, 'inherited': False})
        self.assertEqual(reminders.effective({**f, 'reminders': []}, D)['offsets'], [])

    def test_upcoming_in_the_window_oldest_first_without_closed_or_archived(self):
        items = [item(key='A', plan_day='2026-11-19', plan_time='13:30', reminders=['at', '10m', '1d']),
                 item(key='B', plan_day='2026-11-19', plan_time='12:00'),
                 item(key='C', plan_day='2026-11-19', plan_time='13:00', status='Done'),
                 item(key='D', plan_day='2026-11-19', plan_time='13:00', archived=True),
                 item(key='M', type='meeting', date='2026-11-19', time='15:00', reminder_urgent=True)]
        got = reminders.upcoming(items, D, dt.datetime(2026, 11, 19, 12, 0), dt.datetime(2026, 11, 19, 16, 0),
                                 closed=lambda it: it['fields'].get('status') == 'Done', vault='v')
        self.assertEqual([(r['key'], r['at'], r['offset'], r['urgent']) for r in got],
                         [('A', '2026-11-19T13:20', '10m', False), ('A', '2026-11-19T13:30', 'at', False),
                          ('M', '2026-11-19T14:50', '10m', True)])  # B rang at 11:50, before the window; 1d yesterday
        self.assertEqual(got[0]['id'], 'v|A|10m|2026-11-19T13:30')
        self.assertEqual(got[0]['start'], '2026-11-19T13:30')

    def test_a_day_before_crosses_midnight(self):
        got = reminders.of_item(item(plan_day='2026-11-20', plan_time='00:15', reminders=['1d', '30m']), D)
        self.assertEqual(got, [(dt.datetime(2026, 11, 19, 0, 15), '1d'), (dt.datetime(2026, 11, 19, 23, 45), '30m')])

    def test_offsets_and_settings_are_checked(self):
        self.assertIsNone(reminders.clean_offsets(None))
        self.assertEqual(reminders.clean_offsets('1h, at,1h'), ['at', '1h'])
        self.assertEqual(reminders.clean_offsets([]), [])
        with self.assertRaises(ValueError):
            reminders.clean_offsets(['5m'])
        self.assertEqual(reminders.clean_settings({'offsets': ['2h'], 'duration': '1:00'}),
                         {'on': True, 'offsets': ['2h'], 'urgent': False, 'duration': '01:00'})
        for bad in ({'offsets': []}, {'duration': '00:00'}, {'duration': 'soon'}, []):
            with self.subTest(bad), self.assertRaises(ValueError):
                reminders.clean_settings(bad)
        self.assertEqual(reminders.settings_of({'reminders': {'duration': 'nope'}}), D)  # a bad file falls back

    def test_words_say_how_far_the_moment_is_when_it_rings(self):
        now = dt.datetime(2026, 11, 19, 13, 20)
        for start, said in ((dt.datetime(2026, 11, 19, 13, 30), 'In 10 minutes · 13:30'),
                            (dt.datetime(2026, 11, 19, 13, 21), 'In 1 minute · 13:21'),
                            (dt.datetime(2026, 11, 19, 13, 20), 'Now · 13:20'),
                            (dt.datetime(2026, 11, 19, 13, 15), 'Started 5 minutes ago · 13:15'),
                            (dt.datetime(2026, 11, 19, 14, 35), 'In 1 h 15 min · 14:35'),
                            (dt.datetime(2026, 11, 19, 15, 20), 'In 2 hours · 15:20'),
                            (dt.datetime(2026, 11, 20, 13, 20), 'Tomorrow · 13:20'),
                            (dt.datetime(2026, 11, 22, 9, 0), 'Sun 22 · 09:00')):
            with self.subTest(said):
                self.assertEqual(reminders.words(start, now), said)

    def test_what_was_rung_is_not_rung_again_and_is_forgotten_after_two_days(self):
        due = [{'id': 'a'}, {'id': 'b'}]
        self.assertEqual(reminders.to_ring(due, {'a': '2026-11-19T13:20'}), [{'id': 'b'}])
        now = dt.datetime(2026, 11, 19, 13, 20)
        self.assertEqual(reminders.prune({'old': '2026-11-17T13:19', 'new': '2026-11-17T13:20', 'bad': 'soon'}, now),
                         {'new': '2026-11-17T13:20'})

    def test_the_pages_copy_of_the_offsets_is_the_servers(self):
        with open(os.path.join(HERE, 'static', 'js', 'reminders.js'), encoding='utf-8') as f:
            text = f.read()
        found = re.findall(r"\['(\w+)', (\d+), '([^']+)'\]", text.split('export const OFFSETS', 1)[1].split('];', 1)[0])
        self.assertEqual([(k, int(m), w) for k, m, w in found], list(reminders.OFFSETS))


class VaultCase(unittest.TestCase):
    """A Projects vault in a temp folder, with its own config.json."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.a = os.path.join(tmp.name, 'a')
        for folder in TICKET_FOLDERS:
            os.makedirs(os.path.join(self.a, folder))
        cfg = os.path.join(tmp.name, 'config.json')
        with open(cfg, 'w', encoding='utf-8') as f:
            json.dump({'root': self.a, 'vaults': [{'id': 'a', 'name': 'A', 'path': self.a, 'structure': 'ticketing'}],
                       'default_vault': 'a'}, f)
        patcher = mock.patch.object(server, 'CONFIG_PATH', cfg)
        patcher.start()
        self.addCleanup(patcher.stop)
        quiet = contextlib.redirect_stdout(io.StringIO())
        quiet.__enter__()
        self.addCleanup(quiet.__exit__, None, None, None)
        self.app = server.App()
        self.store = self.app.store_for('a')

    def text(self, it):
        with open(os.path.join(self.a, it['path']), encoding='utf-8') as f:
            return f.read()


class VaultTest(VaultCase):
    def test_time_duration_and_reminders_are_kept_and_checked(self):
        it = self.store.create('task', 'Vet', {'plan_day': '2026-11-19'})
        it = self.store.update(it['key'], {'plan_time': '9:30', 'plan_duration': '0:45', 'reminders': ['1h', 'at'],
                                           'reminder_urgent': True})
        f = it['fields']
        self.assertEqual((f['plan_time'], f['plan_duration'], f['reminders'], f['reminder_urgent']), ('09:30', '00:45', ['at', '1h'], True))
        text = self.text(it)
        self.assertIn('plan_time: 09:30', text)
        for bad in ({'plan_time': '25:00'}, {'plan_duration': '00:00'}, {'reminders': ['5m']}):
            with self.subTest(bad), self.assertRaises(StoreError):
                self.store.update(it['key'], bad)
        it = self.store.update(it['key'], {'reminders': None, 'reminder_urgent': None})  # back to the default
        self.assertIsNone(it['fields'].get('reminders'))
        self.assertIsNone(it['fields'].get('reminder_urgent'))
        it = self.store.update(it['key'], {'reminders': []})  # none, whatever the default
        self.assertEqual(it['fields']['reminders'], [])

    def test_a_time_goes_with_its_day(self):
        it = self.store.create('task', 'Vet', {'plan_day': '2026-11-19'})
        it = self.store.update(it['key'], {'plan_time': '13:30'})
        moved = self.store.update(it['key'], {'plan_day': '2026-11-20'})
        self.assertEqual(moved['fields']['plan_time'], '13:30')  # another day keeps its time
        gone = self.store.update(it['key'], {'plan_day': None, 'plan_week': '2026-W48'})
        self.assertIsNone(gone['fields'].get('plan_time'))

    def test_only_the_changed_keys_are_written(self):
        it = self.store.create('task', 'Vet', {'plan_day': '2026-11-19'})
        before = self.text(it)
        it = self.store.update(it['key'], {'plan_time': '13:30'})
        after = self.text(it)
        removed = [l for l in before.splitlines() if l not in after.splitlines()]
        added = [l for l in after.splitlines() if l not in before.splitlines()]
        self.assertEqual([l for l in added if not l.startswith('updated_date')], ['plan_time: 13:30'])
        self.assertTrue(all(l.startswith('updated_date') for l in removed))

    def test_settings_in_the_vault_and_the_list_every_device_reads(self):
        out = self.app.set_vault_settings('a', {'reminders': {'offsets': ['30m', 'at'], 'urgent': True, 'duration': '00:45'}})
        self.assertEqual(out['reminders'], {'on': True, 'offsets': ['at', '30m'], 'urgent': True, 'duration': '00:45'})
        with open(vaultsettings.path(self.a), encoding='utf-8') as f:
            self.assertEqual(json.load(f)['reminders']['offsets'], ['at', '30m'])
        with self.assertRaises(StoreError):
            self.app.set_vault_settings('a', {'reminders': {'offsets': []}})
        soon = dt.datetime.now().replace(second=0, microsecond=0) + dt.timedelta(hours=2)
        self.store.create('task', 'Vet', {'plan_day': soon.strftime('%Y-%m-%d'), 'plan_time': soon.strftime('%H:%M')})
        got = self.app.reminders_payload('3')['reminders']
        self.assertEqual([(r['vault'], r['offset'], r['urgent']) for r in got], [('a', '30m', True), ('a', 'at', True)])
        with self.assertRaises(StoreError):
            self.app.reminders_payload('soon')


class RingTest(VaultCase):
    """The Mac's side: server.ring_reminders on the scheduler's look, the files it keeps next to config.json, and the
    wake agent that reads one of them."""

    def setUp(self):
        super().setUp()
        patcher = mock.patch.object(server, 'APP', self.app)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.dir = os.path.dirname(server.CONFIG_PATH)
        self.rung = []

    def ring(self, now):
        return server.ring_reminders(now, ring=lambda r, at: self.rung.append((r['offset'], r['urgent'], at)))

    def read(self, name):
        with open(os.path.join(self.dir, name), encoding='utf-8') as f:
            return json.load(f)

    def test_a_reminder_rings_once_when_its_time_comes(self):
        self.store.create('task', 'Vet', {'plan_day': '2026-11-19', 'plan_time': '13:30', 'reminders': ['at', '10m', '1h'],
                                          'reminder_urgent': True})
        self.assertEqual(self.ring(dt.datetime(2026, 11, 19, 13, 19, 50)), [])  # 13:20 has not come
        self.assertEqual(self.read(server.REMINDERS_NEXT), {'at': ['2026-11-19T13:20', '2026-11-19T13:30']})
        # 12:30 is more than CATCH_UP ago: left; 13:20 rings, as an alarm
        self.ring(dt.datetime(2026, 11, 19, 13, 20, 10))
        self.assertEqual([(o, u) for o, u, _ in self.rung], [('10m', True)])
        self.ring(dt.datetime(2026, 11, 19, 13, 20, 40))  # the next look: already rung
        self.assertEqual(len(self.rung), 1)
        self.assertEqual(list(self.read(server.REMINDERS_FIRED)['fired'].values()), ['2026-11-19T13:20'])
        self.ring(dt.datetime(2026, 11, 19, 13, 44))  # the Mac asleep at 13:30, awake 14 minutes later: still rings
        self.assertEqual([o for o, _, _ in self.rung], ['10m', 'at'])
        self.assertEqual(self.read(server.REMINDERS_NEXT), {'at': []})

    def test_a_vault_that_turned_reminders_or_notifications_off_rings_nothing(self):
        self.store.create('task', 'Vet', {'plan_day': '2026-11-19', 'plan_time': '13:30', 'reminders': ['at']})
        hour = (dt.datetime(2026, 11, 19, 13), dt.datetime(2026, 11, 19, 14))
        for off in (['reminders'], ['notifications'], ['reminders', 'notifications']):
            with self.subTest(off):
                self.app.set_vault_settings('a', {'disabled_features': off})
                self.assertEqual(self.app.reminders_between(*hour), [])  # what GET /api/reminders hands the iPhone
                self.ring(dt.datetime(2026, 11, 19, 13, 30, 10))
                self.assertEqual(self.rung, [])
                self.assertEqual(self.read(server.REMINDERS_NEXT), {'at': []})  # nor wakes the app for it
        self.app.set_vault_settings('a', {'disabled_features': []})  # on again: what is still in its time rings
        self.ring(dt.datetime(2026, 11, 19, 13, 30, 40))
        self.assertEqual([o for o, _, _ in self.rung], ['at'])

    def test_a_late_one_beyond_the_catch_up_and_a_done_one_never_ring(self):
        it = self.store.create('task', 'Vet', {'plan_day': '2026-11-19', 'plan_time': '13:30', 'reminders': ['at']})
        self.ring(dt.datetime(2026, 11, 19, 13, 46))
        self.store.update(it['key'], {'plan_time': '14:00'})
        self.store.update(it['key'], {'status': 'Done'})
        self.ring(dt.datetime(2026, 11, 19, 14, 0))
        self.assertEqual(self.rung, [])

    def test_the_wake_agent_wakes_the_app_for_a_reminder(self):
        from tools import agents_wake
        app = self.dir
        now = dt.datetime(2026, 11, 19, 13, 20)
        self.assertFalse(agents_wake.reminder_due(app, now))  # no file yet
        with open(os.path.join(app, agents_wake.REMINDERS_NEXT), 'w', encoding='utf-8') as f:
            json.dump({'at': ['2026-11-19T12:00', 'soon', '2026-11-19T13:40']}, f)
        self.assertFalse(agents_wake.reminder_due(app, now))  # 13:40 is beyond the next look; 12:00 too old
        self.assertTrue(agents_wake.reminder_due(app, dt.datetime(2026, 11, 19, 13, 35)))
        self.assertTrue(agents_wake.reminder_due(app, dt.datetime(2026, 11, 19, 13, 50)))  # rang 10 min ago: still rings
        self.assertFalse(agents_wake.reminder_due(app, dt.datetime(2026, 11, 19, 14, 0)))

    def test_on_a_mac_the_words_go_to_applescript_as_arguments(self):
        calls = []

        class Now:  # the thread, run at once
            def __init__(self, target, args, **_):
                self.go = lambda: target(*args)

            def start(self):
                self.go()
        r = {'title': 'Vet "Rex"', 'ref': 'TSK-1', 'key': 'T1', 'offset': '10m', 'urgent': False, 'at': '2026-11-19T13:20',
             'start': '2026-11-19T13:30'}
        with mock.patch.object(server.sys, 'platform', 'darwin'), mock.patch.object(server.threading, 'Thread', Now), \
                mock.patch.object(server.subprocess, 'run', lambda cmd, **kw: calls.append(cmd) or mock.Mock(returncode=0)):
            server.ring_on_mac(r, dt.datetime(2026, 11, 19, 13, 20))
            server.ring_on_mac({**r, 'urgent': True}, dt.datetime(2026, 11, 19, 13, 20))
        self.assertEqual(calls[0][3:], ['--', 'Vet "Rex"', 'In 10 minutes · 13:30', 'TSK-1'])
        self.assertIn('display notification', calls[0][2])
        self.assertNotIn('Rex', calls[0][2])
        for n in (1, 2, 3):
            self.assertIn(f'(item {n} of argv)', calls[0][2])
        self.assertIn('display alert', calls[1][2])
        self.assertEqual(calls[1][3:], ['--', 'Vet "Rex"', 'In 10 minutes · 13:30\nTSK-1'])
        with mock.patch.object(server.sys, 'platform', 'linux'), mock.patch.object(server.subprocess, 'run') as run:
            server.ring_on_mac(r, dt.datetime(2026, 11, 19, 13, 20))
        run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
