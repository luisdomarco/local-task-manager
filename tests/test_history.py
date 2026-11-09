import os
import tempfile
import unittest
from unittest import mock

from tests.test_ticketing import TicketingBase
from tm import history
from tm.store import META_DIR, Store


class HistoryTest(unittest.TestCase):
    """An item's history (tm/history.py): what the Store changed on the fields its Activity follows, kept apart."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.s = Store(self.tmp.name)
        self.t = self.s.create('task', 'Benchmark')

    def fields(self, entries):
        return [(e['field'], e['from'], e['to'], e['by']) for e in entries]

    def test_each_followed_field_is_kept_with_from_to_and_who(self):
        first = self.s.update(self.t['key'], {'status': 'InProgress', 'due': '2026-10-25', 'subject': 'Benchmark rivals'}, by='owner')
        self.s.update(self.t['key'], {'due': '2026-10-30', 'ticket_id': '4521', 'local_path': '~/work'})
        self.s.update(self.t['key'], {'due': None})
        self.assertEqual(self.fields(self.s.item_history(self.t['key'])), [
            ('status', self.t['fields']['status'], 'InProgress', 'owner'),
            ('due', None, '2026-10-25', 'owner'),
            ('due', '2026-10-25', '2026-10-30', 'agent'),
            ('ticket_id', None, '4521', 'agent'),
            ('local_path', None, '~/work', 'agent'),
            ('due', '2026-10-30', None, 'agent'),
        ])  # the subject is not followed
        at = self.s.item_history(self.t['key'])[0]['at']  # to the second: a comment in the same minute keeps its place
        self.assertTrue(at.startswith(first['fields']['updated_at']) and len(at) == 19, at)

    def test_a_change_and_a_comment_in_one_minute_keep_their_order(self):
        seconds = iter(['2026-10-23T09:42:05', '2026-10-23T09:42:20', '2026-10-23T09:42:41'])
        with mock.patch('tm.store.now_moment', side_effect=lambda: next(seconds)):
            self.s.update(self.t['key'], {'due': '2026-10-25'})
            self.s.add_comment(self.t['key'], 'after the due date')
            self.s.update(self.t['key'], {'due': '2026-10-26'})
        moments = [(e['at'], 'change') for e in self.s.item_history(self.t['key'])]
        moments += [(c['at'], 'comment') for c in self.s.read(self.t['key'])['fields']['comments']]
        self.assertEqual([what for _, what in sorted(moments)], ['change', 'comment', 'change'])

    def test_the_plan_is_one_field_the_day_else_the_week_else_the_month(self):
        self.s.update(self.t['key'], {'plan_week': '2026-W43'})
        self.s.update(self.t['key'], {'plan_day': '2026-10-21'})
        self.s.update(self.t['key'], {'plan_day': None, 'plan_week': None})
        self.assertEqual([(e['field'], e['from'], e['to']) for e in self.s.item_history(self.t['key'])], [
            ('planned', None, '2026-W43'), ('planned', '2026-W43', '2026-10-21'), ('planned', '2026-10-21', None)])

    def test_it_lives_in_the_hidden_folder_and_the_item_file_does_not_grow(self):
        self.s.update(self.t['key'], {'priority': 'High'})
        path = os.path.join(self.tmp.name, META_DIR, 'history', f"{self.t['id']}.md")
        with open(path, encoding='utf-8') as f:
            text = f.read()
        self.assertIn('type: history', text)
        self.assertIn('priority: Normal → High', text)
        with open(os.path.join(self.tmp.name, self.t['path']), encoding='utf-8') as f:
            self.assertNotIn('history', f.read())

    def test_an_unchanged_value_and_an_untracked_field_add_nothing(self):
        self.s.update(self.t['key'], {'status': self.t['fields']['status'], 'labels': ['x']})
        self.assertEqual(self.s.item_history(self.t['key']), [])
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, META_DIR, 'history')))

    def test_a_history_that_cannot_be_written_never_stops_the_change(self):
        with mock.patch.object(history, 'record', side_effect=OSError('disk full')):
            out = self.s.update(self.t['key'], {'due': '2026-10-25'})
        self.assertEqual(out['fields']['due'], '2026-10-25')
        self.assertEqual(self.s.item_history(self.t['key']), [])


class TicketingHistoryTest(TicketingBase):
    def test_a_ticket_keeps_its_history_by_id_through_a_rename(self):
        ini = self.s.create('initiative', 'Curación', {'project': 'HB'})
        ini = self.s.update(ini['key'], {'priority': 'P1', 'subject': 'Curación final'}, by='owner')
        self.s.update(ini['key'], {'ticket_url': 'https://redmine.example.com/issues/1'}, by='owner')
        self.assertEqual([(e['field'], e['to']) for e in self.s.item_history(ini['key'])],
                         [('priority', 'P1'), ('ticket_url', 'https://redmine.example.com/issues/1')])
        self.assertTrue(os.path.exists(os.path.join(self.root, META_DIR, 'history', f"{ini['id']}.md")))


if __name__ == '__main__':
    unittest.main()
