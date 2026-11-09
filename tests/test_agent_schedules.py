"""Scheduled agent runs: the rules (tm/schedules.py) on a fixed clock, the scheduler's look (server.py tick) with the
chat mocked, and the installed app's wake (tools/agents_wake.py)."""
import datetime as dt
import os
import tempfile
import time
import unittest
from unittest import mock

import server
from tests.test_agent_commands import AgentsBase
from tm import agentruns, schedules
from tm.store import StoreError
from tools import agents_wake

D = dt.datetime
H = 3600 * 1000


def ms(d):
    return int(time.mktime(d.timetuple()) * 1000)


class RulesTest(unittest.TestCase):
    def test_the_next_fire_of_each_kind(self):
        fri = D(2026, 11, 6, 10, 0)  # a Friday, 10:00
        cases = [
            ({'every': 'day', 'at': '9:00'}, fri, D(2026, 11, 7, 9, 0)),
            ({'every': 'day', 'at': '10:00'}, fri, D(2026, 11, 7, 10, 0)),  # strictly after: not this very minute
            ({'every': 'day', 'at': '18:30'}, fri, D(2026, 11, 6, 18, 30)),
            ({'every': 'weekday', 'at': '09:00'}, fri, D(2026, 11, 9, 9, 0)),  # past Friday's: Monday
            ({'every': 'weekday', 'at': '11:00'}, fri, D(2026, 11, 6, 11, 0)),
            ({'every': 'week', 'at': '08:00', 'days': [2, 6]}, fri, D(2026, 11, 8, 8, 0)),  # Sunday
            ({'every': 'week', 'at': '08:00', 'days': [4]}, fri, D(2026, 11, 13, 8, 0)),  # next Friday
            ({'every': 'hours', 'at': '00:00', 'hours': 6}, fri, D(2026, 11, 6, 12, 0)),
            ({'every': 'hours', 'at': '09:30', 'hours': 5}, D(2026, 11, 6, 20, 0), D(2026, 11, 7, 9, 30)),  # 9:30 14:30 19:30
            ({'every': 'hours', 'at': '00:15', 'hours': 1}, D(2026, 11, 6, 23, 20), D(2026, 11, 7, 0, 15)),
        ]
        for rule, after, want in cases:
            self.assertEqual(schedules.next_fire(rule, after), want, rule)

    def test_rules_are_checked_and_said_in_words(self):
        for bad in (None, {}, {'every': 'month', 'at': '9:00'}, {'every': 'day', 'at': '25:00'}, {'every': 'day'},
                    {'every': 'week', 'at': '9:00'}, {'every': 'week', 'at': '9:00', 'days': [7]},
                    {'every': 'hours', 'at': '9:00', 'hours': 0}, {'every': 'hours', 'at': '9:00', 'hours': 'x'}):
            with self.assertRaises(ValueError):
                schedules.normalize(bad)
        self.assertEqual(schedules.normalize({'every': 'week', 'at': '7:05', 'days': ['3', 0, 3], 'junk': 1}),
                         {'every': 'week', 'at': '07:05', 'days': [0, 3]})
        self.assertEqual([schedules.label(r) for r in (
            {'every': 'day', 'at': '09:00'}, {'every': 'weekday', 'at': '18:30'}, {'every': 'week', 'at': '08:00', 'days': [0, 3]},
            {'every': 'hours', 'at': '00:00', 'hours': 6}, {'every': 'hours', 'at': '08:15', 'hours': 1},
            {'every': 'week', 'at': '9:00', 'days': [4, 3, 2, 1, 0]}, {'every': 'week', 'at': '9:00', 'days': list(range(7))})], [
            'Every day at 9:00', 'Every weekday at 18:30', 'Every Mon, Thu at 8:00', 'Every 6 hours from 0:00', 'Every hour from 8:15',
            'Every weekday at 9:00', 'Every day at 9:00'])

    def test_storage_keeps_what_holds_and_says_what_is_due(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'agent-schedules.json')
            self.assertEqual(schedules.load(path), [])
            s = schedules.add(path, {'dir': 'abc', 'cmd': 'dev:status', 'rule': {'every': 'day', 'at': '9:00'}, 'next_ts': 5000})
            self.assertRegex(s['id'], r'^sch-[0-9a-f]{8}$')
            self.assertEqual(s['rule'], {'every': 'day', 'at': '09:00'})
            self.assertTrue(schedules.due_soon(path, 4000, 1000))
            self.assertTrue(schedules.due_soon(path, 50 * H, 0))  # long overdue: wakes the app to be marked missed
            self.assertFalse(schedules.due_soon(path, 1000, 1000))
            schedules.update(path, s['id'], paused=True)
            self.assertFalse(schedules.due_soon(path, 4000, 1000))
            self.assertEqual(schedules.update(path, 'sch-00000000', paused=True), None)
            schedules._save(path, schedules.load(path) + [{'id': 'nope', 'dir': 'a', 'cmd': 'b', 'rule': {'every': 'day', 'at': '9:00'}},
                                                         {'id': 'sch-0000000a', 'dir': 'a', 'cmd': 'b', 'rule': {'every': 'never'}}])
            self.assertEqual([x['id'] for x in schedules.load(path)], [s['id']])  # the ones that do not hold are dropped
            self.assertTrue(schedules.remove(path, s['id']))
            self.assertFalse(schedules.remove(path, s['id']))


class SchedulerTest(AgentsBase):
    RULE = {'every': 'day', 'at': '09:00'}

    def setUp(self):
        super().setUp()
        self.chat = mock.Mock(stopped=False, last_result=None, busy=False, pending={}, watched=False)
        self.chat.info.return_value = {'id': 'x'}
        patcher = mock.patch.object(server, '_spawn_chat', return_value=self.chat)
        self.spawn = patcher.start()
        self.addCleanup(patcher.stop)

    def schedule(self, **extra):
        return server.save_agent_schedule({'dir': self.id, 'cmd': 'dev:status', 'args': 'STY-1', 'rule': self.RULE, **extra})['schedule']

    def test_a_schedule_is_checked_as_a_run_would_be(self):
        for body, status in (({'cmd': 'nope'}, 404), ({'rule': {'every': 'day'}}, 400), ({'mode': 'yolo'}, 400),
                             ({'where': 'there'}, 400), ({'model': 'gpt'}, 400), ({'dir': 'deadbeef'}, 404)):
            with self.assertRaises(StoreError) as cm:
                server.save_agent_schedule({'dir': self.id, 'cmd': 'dev:status', 'rule': self.RULE, **body})
            self.assertEqual(cm.exception.status, status, body)
        s = self.schedule(mode='plan')
        self.assertEqual((s['label'], s['dir_name'], s['mode'], s['paused']), ('Every day at 9:00', 'Mine', 'plan', False))
        self.assertGreater(s['next_ts'], server._now_ms())
        changed = server.save_agent_schedule({'id': s['id'], 'dir': self.id, 'cmd': 'dev:status', 'rule': {'every': 'weekday', 'at': '18:00'}})
        self.assertEqual((changed['schedule']['id'], changed['schedule']['label']), (s['id'], 'Every weekday at 18:00'))
        self.assertEqual([x['id'] for x in server.agent_schedules(self.id, 'dev:status')['schedules']], [s['id']])
        self.assertEqual(server.agent_schedules(self.id, 'other')['schedules'], [])

    def test_the_scheduler_runs_what_is_due_once_and_moves_it_on(self):
        s = self.schedule()
        due = s['next_ts']
        self.assertEqual(server.tick(due - 1000), [])  # not yet
        started = server.tick(due + 1000)
        self.assertEqual(len(started), 1)
        run = server.agent_runs()['runs'][0]
        self.assertEqual((run['id'], run['source'], run['schedule'], run['args']), (started[0], 'schedule', s['id'], 'STY-1'))
        after = server._schedule(s['id'])
        self.assertEqual((after['last_run'], after['last_ts']), (started[0], due + 1000))
        self.assertEqual(after['next_ts'], schedules.next_ts(self.RULE, due + 1000))  # tomorrow's
        self.assertEqual(server.tick(due + 2000), [])  # once

    def test_one_whose_time_came_long_ago_is_missed_and_one_still_going_is_skipped(self):
        s = self.schedule()
        late = s['next_ts'] + schedules.CATCH_UP_MS + 1000
        self.assertEqual(server.tick(late), [])
        after = server._schedule(s['id'])
        self.assertEqual(after['missed_ts'], s['next_ts'])
        self.assertGreater(after['next_ts'], late)
        # Within the catch-up window it runs; with its last run still going here, the next is skipped.
        first = server.tick(after['next_ts'] + 60_000)[0]
        with mock.patch.object(server.CHATS, 'live', side_effect=lambda cid: self.chat if cid == first else None):
            nxt = server._schedule(s['id'])['next_ts']
            self.assertEqual(server.tick(nxt + 1000), [])
            self.assertEqual(server._schedule(s['id'])['skipped_ts'], nxt + 1000)
            with self.assertRaises(StoreError) as cm:
                server.run_agent_schedule_now(s['id'])
            self.assertEqual(cm.exception.status, 409)

    def test_paused_it_never_runs_and_a_run_that_cannot_start_is_noted(self):
        s = self.schedule()
        server.pause_agent_schedule(s['id'], True)
        self.assertNotIn('next_ts', server._schedule(s['id']))
        self.assertEqual(server.tick(s['next_ts'] + 1000), [])
        on = server.pause_agent_schedule(s['id'], False)['schedule']
        self.spawn.side_effect = StoreError(500, 'claude is not installed')
        self.assertEqual(server.tick(on['next_ts'] + 1000), [])
        after = server._schedule(s['id'])
        self.assertEqual(after['error'], 'claude is not installed')
        self.assertGreater(after['next_ts'], on['next_ts'])  # not tried again at every look
        # Run now: at once, its next time untouched; it clears the error.
        self.spawn.side_effect = None
        sid = server.run_agent_schedule_now(s['id'])['session_id']
        now = server._schedule(s['id'])
        self.assertEqual((now['last_run'], now['next_ts'], 'error' in now), (sid, after['next_ts'], False))
        self.assertEqual(server.delete_agent_schedule(s['id']), {'deleted': s['id']})
        with self.assertRaises(StoreError):
            server.delete_agent_schedule(s['id'])
        self.assertEqual(agentruns.find(server.runs_path(), sid)['schedule'], s['id'])  # its runs stay

    def test_a_scheduled_run_ends_after_its_turn_unless_the_dock_has_it(self):
        s = self.schedule()
        with mock.patch.object(server, '_close_quietly') as close:
            sid = server.tick(s['next_ts'] + 1000)[0]
            self.chat.watched = True
            self.chat.on_result({'type': 'result', 'is_error': False})
            time.sleep(0.05)
            close.assert_not_called()
            self.chat.watched = False
            self.chat.on_result({'type': 'result', 'is_error': False})
            for _ in range(50):
                if close.called:
                    break
                time.sleep(0.02)
            close.assert_called_once_with(sid)
        self.assertIsNone(agentruns.find(server.runs_path(), sid).get('read_at'))  # new to see: unread


class WakeTest(unittest.TestCase):
    def test_it_connects_only_when_a_schedule_is_due(self):
        with tempfile.TemporaryDirectory() as app:
            with open(os.path.join(app, 'config.json'), 'w', encoding='utf-8') as f:
                f.write('{"port": 3333}')
            urls = []
            self.assertFalse(agents_wake.wake(app, 1000, urls.append))  # no schedules
            schedules.add(os.path.join(app, agents_wake.SCHEDULES),
                          {'dir': 'a', 'cmd': 'b', 'rule': {'every': 'day', 'at': '9:00'}, 'next_ts': 10 * 60 * 1000})
            self.assertFalse(agents_wake.wake(app, 0, urls.append))  # in 10 minutes: the next look wakes it
            self.assertTrue(agents_wake.wake(app, 5 * 60 * 1000, urls.append))
            self.assertEqual(urls, ['http://127.0.0.1:3333/api/server'])


if __name__ == '__main__':
    unittest.main()
