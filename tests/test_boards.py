"""Custom boards (tm/boards.py, Store.custom_board): columns of the user's own and where each card sits, one file per board in
.task-manager/boards/. Placing a card never writes the item's file; the boards of before (today.md / week.md and the
items' today_list / week_list / week_order) are read into one until its first write keeps it."""
import contextlib
import io
import json
import os
import tempfile
import unittest
from unittest import mock

import server
from tm import boards
from tm import frontmatter as fm
from tm.store import Store, StoreError

ROOT_FOLDERS = ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log')


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


class PureTest(unittest.TestCase):
    def test_columns_keep_uncategorized_and_refuse_bad_ones(self):
        self.assertEqual([c['id'] for c in boards.clean_columns([{'id': 'a', 'name': 'A'}])], ['uncategorized', 'a'])
        self.assertEqual(boards.clean_columns([{'id': 'a'}, {'id': 'uncategorized', 'name': 'Later'}])[1]['name'], 'Later')
        for bad in ([{'id': 'a'}, {'id': 'a'}], [{'name': 'x'}], 'x', [3]):
            with self.subTest(bad=bad), self.assertRaises(boards.BoardError):
                boards.clean_columns(bad)

    def test_apply_places_takes_out_and_sends_a_gone_columns_cards_back(self):
        b = boards.apply(boards.default(), columns=[{'id': 'w', 'name': 'Waiting'}], place={'1': ['w', 10], '2': ['uncategorized', None]})
        self.assertEqual(b['cards'], {'1': ['w', 10], '2': ['uncategorized', None]})
        b = boards.apply(b, place={'2': None})
        self.assertEqual(b['cards'], {'1': ['w', 10]})
        b = boards.apply(b, columns=[])  # Waiting deleted: its card is in Uncategorized (out of the map)
        self.assertEqual((b['cards'], [c['id'] for c in b['columns']]), ({}, ['uncategorized']))
        for place in ({'1': ['nope', 1]}, {'1': ['w']}, {'1': ['uncategorized', 'first']}, {'1': ['uncategorized', True]}, ['x']):
            with self.subTest(place=place), self.assertRaises(boards.BoardError):
                boards.apply(boards.apply(boards.default(), columns=[{'id': 'w'}]), place=place)

    def test_the_file_reads_back_as_it_was_written(self):
        b = boards.apply(boards.default(), columns=[{'id': 'w', 'name': 'Espera ñ'}], place={'10': ['w', 5], '9': ['w', 2.5], 'x': ['w', None]})
        text = boards.dump(b)
        self.assertEqual(boards.parse(text), b)
        self.assertIn('Espera ñ', text)
        self.assertLess(text.index('"9"'), text.index('"10"'))  # ids in number order, one card a line
        for bad in ('nope', '[]', '{"columns": [{"id": "a"}, {"id": "a"}]}'):
            with self.subTest(bad=bad), self.assertRaises(boards.BoardError):
                boards.parse(bad)

    def test_names(self):
        for ok in ('today', 'week', 'list.initiative', 'list.board.task', 'month'):
            self.assertTrue(boards.NAME_RE.match(ok), ok)
        for bad in ('', '../x', 'a/b', '.hidden', 'x' * 101, 'a b'):
            self.assertFalse(boards.NAME_RE.match(bad), bad)

    def test_migrate_reads_the_columns_and_keys_of_before(self):
        lists = [{'id': 'uncategorized', 'name': 'Uncategorized'}, {'id': 'waiting', 'name': 'Waiting'}]
        items = [(1, {'week_list': 'waiting', 'week_order': 20}), (2, {'week_list': 'gone', 'week_order': 5}),
                 (3, {'week_list': None}), (4, {'week_order': 7})]
        self.assertEqual(boards.migrate('week', lists, items),
                         {'columns': lists, 'cards': {'1': ['waiting', 20], '2': ['uncategorized', 5], '4': ['uncategorized', 7]}})
        self.assertEqual(boards.migrate('today', None, [(1, {'today_list': 'morning'})]), boards.default())  # no such column
        self.assertIsNone(boards.migrate('month', None, items))


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        for d in ROOT_FOLDERS:
            os.makedirs(os.path.join(self.root, d))
        self.s = Store(self.root, structure='ticketing', enforce_structure=True)
        self.s.create('project', 'Acme Web', {'project_key': 'ACME'})
        self.meta = os.path.join(self.root, '.task-manager')

    def task(self, title, **values):
        return self.s.create('task', title, {'project': 'ACME', **values})


class StoreBoardTest(Base):
    def test_a_board_never_saved_is_uncategorized_alone_and_writes_nothing(self):
        self.assertEqual(self.s.custom_board('list.initiative'), {'name': 'list.initiative', **boards.default()})
        self.assertFalse(os.path.exists(os.path.join(self.meta, 'boards')))

    def test_placing_a_card_never_writes_the_items_file(self):
        it = self.task('Call the bank')
        path = os.path.join(self.root, it['path'])
        before = read(path)
        b = self.s.save_custom_board('list.task', columns=[{'id': 'waiting', 'name': 'Waiting'}], place={it['id']: ['waiting', 10]})
        self.assertEqual(b['cards'], {str(it['id']): ['waiting', 10]})
        self.assertEqual(read(path), before)
        self.assertEqual(json.loads(read(os.path.join(self.meta, 'boards', 'list.task.json')))['cards'], {str(it['id']): ['waiting', 10]})

    def test_deleting_a_column_sends_its_cards_to_uncategorized(self):
        a, b = self.task('A'), self.task('B')
        self.s.save_custom_board('week', columns=[{'id': 'w', 'name': 'Waiting'}, {'id': 'd', 'name': 'Deep'}],
                                 place={a['id']: ['w', 0], b['id']: ['d', 0]})
        out = self.s.save_custom_board('week', columns=[{'id': 'd', 'name': 'Deep'}])
        self.assertEqual(out['cards'], {str(b['id']): ['d', 0]})

    def test_bad_input_is_refused_and_a_bad_file_is_never_overwritten(self):
        for kwargs in ({'name': '../x'}, {'name': 'week', 'columns': 'x'}, {'name': 'week', 'place': {'1': ['nope', 0]}}):
            with self.subTest(kwargs=kwargs), self.assertRaises(StoreError):
                self.s.save_custom_board(**kwargs)
        os.makedirs(os.path.join(self.meta, 'boards'), exist_ok=True)
        bad = os.path.join(self.meta, 'boards', 'week.json')
        with open(bad, 'w', encoding='utf-8') as f:
            f.write('{ broken')
        with self.assertRaises(StoreError) as e:
            self.s.custom_board('week')
        self.assertEqual(e.exception.status, 409)
        with self.assertRaises(StoreError):
            self.s.save_custom_board('week', columns=[])
        self.assertEqual(read(bad), '{ broken')

    def test_a_new_day_takes_a_card_off_todays_board(self):
        it = self.task('Plan', plan_day='2026-10-14', plan_week='2026-W42')
        self.s.save_custom_board('today', columns=[{'id': 'm', 'name': 'Morning'}], place={it['id']: ['m', None]})
        self.s.update(it['key'], {'priority': 'P1'})
        self.assertIn(str(it['id']), self.s.custom_board('today')['cards'])
        self.s.update(it['key'], {'plan_day': '2026-10-15'})
        self.assertNotIn(str(it['id']), self.s.custom_board('today')['cards'])


class MigrationTest(Base):
    """A vault from before: today.md / week.md and the items' keys, read into the board until its first write."""

    def setUp(self):
        super().setUp()
        self.a = self.task('Wait for the reply', plan_week='2026-W42', week_list='waiting', week_order=20)
        self.b = self.task('Morning call', plan_day='2026-10-14', plan_week='2026-W42', today_list='morning')
        for name, lists in (('week.md', [{'id': 'uncategorized', 'name': 'Uncategorized'}, {'id': 'waiting', 'name': 'Waiting'}]),
                            ('today.md', [{'id': 'morning', 'name': 'Morning'}, {'id': 'uncategorized', 'name': 'Uncategorized'}])):
            with open(os.path.join(self.meta, name), 'w', encoding='utf-8') as f:
                f.write(fm.build({'type': name[:-3], 'lists': lists}, '# Board\n'))
        self.s = Store(self.root, structure='ticketing', enforce_structure=True)

    def test_read_then_kept_at_the_first_write_and_the_old_keys_never_written(self):
        week = self.s.custom_board('week')
        self.assertEqual([c['id'] for c in week['columns']], ['uncategorized', 'waiting'])
        self.assertEqual(week['cards'], {str(self.a['id']): ['waiting', 20]})
        today = self.s.custom_board('today')
        self.assertEqual([c['id'] for c in today['columns']], ['morning', 'uncategorized'])
        self.assertEqual(today['cards'], {str(self.b['id']): ['morning', None]})
        self.assertFalse(os.path.exists(os.path.join(self.meta, 'boards')))  # read only
        path = os.path.join(self.root, self.a['path'])
        before = read(path)
        self.s.save_custom_board('week', place={self.a['id']: ['uncategorized', 0]})
        self.assertEqual(json.loads(read(os.path.join(self.meta, 'boards', 'week.json')))['cards'], {str(self.a['id']): ['uncategorized', 0]})
        self.assertEqual(read(path), before)  # week_list: waiting stays in the file, read no more
        self.assertEqual(self.s.custom_board('week')['cards'], {str(self.a['id']): ['uncategorized', 0]})

    def test_the_routes_of_before_answer_from_the_board(self):
        self.assertEqual([l['id'] for l in self.s.week_lists()['lists']], ['uncategorized', 'waiting'])
        out = self.s.save_week_lists([{'id': 'waiting', 'name': 'Waiting'}, {'id': 'deep', 'name': 'Deep work'}])
        self.assertEqual([l['id'] for l in out['lists']], ['uncategorized', 'waiting', 'deep'])
        self.assertEqual(self.s.custom_board('week')['cards'], {str(self.a['id']): ['waiting', 20]})  # its cards came along


class RouteTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.a = os.path.join(tmp.name, 'a')
        for d in ROOT_FOLDERS:
            os.makedirs(os.path.join(self.a, d))
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
        self.s = server.App().store_for('a')

    def test_get_and_post(self):
        get = server.ROUTES[('GET', '/api/boards')]
        post = server.ROUTES[('POST', '/api/boards')]
        self.assertEqual(get(self.s, {'name': 'month'}, {})['columns'], boards.default()['columns'])
        out = post(self.s, {}, {'name': 'month', 'columns': [{'id': 'x', 'name': 'X'}], 'place': {'5': ['x', 1]}})
        self.assertEqual(out['cards'], {'5': ['x', 1]})
        self.assertEqual(get(self.s, {'name': 'month'}, {}), out)
        with self.assertRaises(StoreError):
            get(self.s, {}, {})


if __name__ == '__main__':
    unittest.main()
