"""Statuses per item type in three fixed groups (TSK-037): the structure's rules, the vault's statuses.json, renaming
and removing a status in use, Ticketing's fixed names, the API and the migration tool."""
import io
import json
import os
import tempfile
import unittest

from tm.store import Store, StoreError
from tm.structures import StatusConfigError, get
from tm.structures.folders import FOLDER_PER_TYPE
from tools import migrate_statuses

TICKETING_FOLDERS = ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log')  # as tests/test_ticketing.py


def rows(*pairs):
    return [{'name': n, 'group': g} for n, g in pairs]


TASK = rows(('Backlog', 'not_started'), ('ToDo', 'not_started'), ('InProgress', 'in_progress'), ('InQA', 'in_progress'),
            ('Done', 'closed'), ('Discarded', 'closed'))


class StructureRulesTest(unittest.TestCase):
    def test_default_groups(self):
        self.assertEqual(FOLDER_PER_TYPE.groups_of('task')['ToDo'], 'not_started')
        self.assertEqual(FOLDER_PER_TYPE.groups_of('task')['Blocked'], 'in_progress')
        self.assertEqual(FOLDER_PER_TYPE.groups_of('agent'), {'Idea': 'not_started', 'Design': 'in_progress', 'Build': 'in_progress',
                                                     'Test': 'in_progress', 'Live': 'in_progress', 'Retired': 'closed'})
        self.assertEqual(get('ticketing').groups_of('error'), {'open': 'not_started', 'mitigated': 'in_progress', 'resolved': 'closed'})

    def test_an_arrangement_is_checked_and_put_in_group_order(self):
        clean = FOLDER_PER_TYPE.check_statuses({'types': {'task': rows(('Done', 'closed'), ('Backlog', 'not_started'), ('Doing', 'in_progress'))},
                                       'colors': {'Doing': '#AA00CC'}})
        self.assertEqual([r['name'] for r in clean['types']['task']], ['Backlog', 'Doing', 'Done'])
        s = FOLDER_PER_TYPE.with_statuses(clean)
        self.assertEqual(s.statuses_of('task'), ('Backlog', 'Doing', 'Done'))
        self.assertEqual(s.closed_of('task'), frozenset({'Done'}))
        self.assertIn('Doing', s.statuses)  # the board's lists may pick it
        self.assertEqual(s.colors, {'Doing': '#aa00cc'})
        self.assertEqual(s.statuses_of('story'), FOLDER_PER_TYPE.statuses_of('story'))  # a type not named keeps its own
        self.assertEqual(s.public()['types'][0]['groups'], {'Backlog': 'not_started', 'Doing': 'in_progress', 'Done': 'closed'})

    def test_what_an_arrangement_cannot_be(self):
        bad = [
            {'types': {'note': TASK}},                                                   # no statuses
            {'types': {'task': []}},                                                     # empty
            {'types': {'task': rows(('Done', 'closed'), ('done', 'closed'), ('A', 'not_started'))}},  # twice
            {'types': {'task': rows(('A', 'nowhere'), ('B', 'closed'))}},                # group
            {'types': {'task': rows(('A', 'in_progress'), ('B', 'closed'))}},            # nothing to start in
            {'types': {'task': rows(('A', 'not_started'), ('B', 'in_progress'))}},       # nothing to close with
            {'types': {'task': rows(('A: b', 'not_started'), ('B', 'closed'))}},         # not a name
            {'types': {'task': TASK}, 'colors': {'InQA': 'red'}},                        # colour
            {'types': {'task': TASK}, 'colors': {'Nope': '#000000'}},                    # colour of nothing
        ]
        for cfg in bad:
            with self.subTest(cfg=cfg), self.assertRaises(StatusConfigError):
                FOLDER_PER_TYPE.check_statuses(cfg)

    def test_ticketing_fixes_names_order_and_what_closes(self):
        t = get('ticketing')
        same = t.status_config()
        self.assertEqual(t.check_statuses(same)['types']['task'], same['types']['task'])
        onhold_waits = [{**r, 'group': 'not_started'} if r['name'] == 'OnHold' else r for r in same['types']['task']]
        self.assertEqual(t.with_statuses(t.check_statuses({'types': {'task': onhold_waits}})).groups_of('task')['OnHold'], 'not_started')
        renamed = [{**r, 'name': 'Doing'} if r['name'] == 'InProgress' else r for r in same['types']['task']]
        review_closes = [{**r, 'group': 'closed'} if r['name'] == 'Review' else r for r in same['types']['task']]
        for cfg in (renamed, same['types']['task'][:-1], review_closes):
            with self.subTest(cfg=cfg), self.assertRaises(StatusConfigError):
                t.check_statuses({'types': {'task': cfg}})
        self.assertTrue(t.public()['statuses_locked'])


class VaultStatusesTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        self.s = Store(self.root)

    def reopen(self, **kw):
        return Store(self.root, **kw)

    def test_saved_it_is_what_the_vault_has_from_then_on(self):
        self.assertFalse(self.s.status_config()['saved'])
        out = self.s.save_status_config({'types': {'task': TASK}})
        self.assertTrue(out['saved'])
        self.assertEqual(self.s.structure.statuses_of('task'), ('Backlog', 'ToDo', 'InProgress', 'InQA', 'Done', 'Discarded'))
        self.assertEqual(self.reopen().structure.statuses_of('task'), self.s.structure.statuses_of('task'))
        t = self.s.create('task', 'Test it', {'status': 'InQA'})
        self.assertEqual(t['fields']['status'], 'InQA')
        with self.assertRaises(StoreError):
            self.s.create('task', 'Old one', {'status': 'Review'})  # gone from tasks

    def test_a_status_in_use_cannot_go_without_saying_where(self):
        self.s.create('task', 'A', {'status': 'Review'})
        self.s.create('task', 'B', {'status': 'Review'})
        with self.assertRaises(StoreError) as e:
            self.s.save_status_config({'types': {'task': TASK}})
        self.assertEqual(e.exception.status, 409)
        self.assertEqual(e.exception.extra['stranded'], {'Tasks': {'Review': 2}})
        self.assertFalse(self.s.status_config()['saved'])  # nothing written
        out = self.s.save_status_config({'types': {'task': TASK}}, {'task': {'Review': 'InQA'}})
        self.assertEqual(out['moved'], 2)
        self.assertEqual({i['fields']['status'] for i in self.s.items() if i['type'] == 'task'}, {'InQA'})

    def test_a_remap_across_the_closed_group_sets_or_clears_completed_at(self):
        review = self.s.create('task', 'Check it', {'status': 'Review'})
        self.s.save_status_config({'types': {'task': TASK}}, {'task': {'Review': 'Done'}})  # deleted, its items closed
        self.assertTrue(self.s.find(review['id'])['fields'].get('completed_at'))
        without_done = [r for r in TASK if r['name'] != 'Done']
        self.s.save_status_config({'types': {'task': without_done}}, {'task': {'Done': 'ToDo'}})  # deleted, reopened
        it = self.s.find(review['id'])
        self.assertEqual(it['fields']['status'], 'ToDo')
        self.assertFalse(it['fields'].get('completed_at'))

    def test_a_renamed_closed_status_keeps_the_day_it_closed(self):
        done = self.s.create('task', 'Shipped', {'status': 'Done'})
        closed_at = self.s.find(done['id'])['fields']['completed_at']
        self.assertTrue(closed_at)
        renamed = [{**r, 'name': 'Finished'} if r['name'] == 'Done' else r for r in TASK]
        self.s.save_status_config({'types': {'task': renamed}}, {'task': {'Done': 'Finished'}})
        it = self.s.find(done['id'])
        self.assertEqual((it['fields']['status'], it['fields']['completed_at']), ('Finished', closed_at))

    def test_the_boards_lists_follow_a_rename(self):
        self.s.save_board([{'id': 'todo', 'name': 'To do', 'status': 'ToDo'}, {'id': 'rev', 'name': 'Review', 'status': 'Review'}])
        without_review = {t: TASK for t in ('task', 'initiative', 'story')}
        with self.assertRaises(StoreError) as e:
            self.s.save_status_config({'types': without_review})
        self.assertEqual(e.exception.extra['stranded'], {'Board lists': {'Review': 1}})
        self.s.save_status_config({'types': without_review}, {'task': {'Review': 'InQA'}})
        self.assertEqual([l['status'] for l in self.s.board()['lists']], ['ToDo', 'InQA'])

    def test_the_default_board_follows_too(self):
        self.s.create('task', 'Check it', {'status': 'Review'})
        without_review = {t: TASK for t in ('task', 'initiative', 'story')}
        self.s.save_status_config({'types': without_review}, {'task': {'Review': 'InQA'}})  # never edited: no 409
        statuses = [l['status'] for l in self.s.board()['lists']]
        self.assertIn('InQA', statuses)
        self.assertNotIn('Review', statuses)
        self.assertNotIn('Blocked', statuses)  # its list goes with it

    def test_a_type_turned_off_keeps_its_arrangement(self):
        agents = rows(('Idea', 'not_started'), ('Live', 'in_progress'), ('Retired', 'closed'))
        self.s.save_status_config({'types': {'agent': agents}})
        off = self.reopen(disabled_types=['agent'])
        off.save_status_config({'types': {'task': TASK}})
        back = self.reopen()
        self.assertEqual(back.structure.statuses_of('agent'), ('Idea', 'Live', 'Retired'))
        self.assertEqual(back.structure.statuses_of('task')[3], 'InQA')

    def test_a_file_that_is_not_valid_is_set_aside(self):
        os.makedirs(os.path.join(self.root, '.task-manager'), exist_ok=True)
        with open(os.path.join(self.root, '.task-manager', 'statuses.json'), 'w') as f:
            json.dump({'types': {'task': rows(('Only', 'not_started'))}}, f)
        s = self.reopen()
        self.assertIs(s.structure, FOLDER_PER_TYPE)
        self.assertIn('not valid', s.status_config()['error'])

    def test_the_settings_view_counts_and_reports_strays(self):
        self.s.create('task', 'A', {'status': 'ToDo'})
        path = self.s.create('task', 'B', {'status': 'ToDo'})['path']
        with open(os.path.join(self.root, path), encoding='utf-8') as f:
            text = f.read()
        with open(os.path.join(self.root, path), 'w', encoding='utf-8') as f:
            f.write(text.replace('status: ToDo', 'status: Waiting'))  # written by hand
        task = next(t for t in self.s.status_config()['types'] if t['type'] == 'task')
        self.assertEqual(next(r for r in task['statuses'] if r['name'] == 'ToDo')['count'], 1)
        self.assertEqual(task['unknown'], [{'name': 'Waiting', 'count': 1}])


class TicketingVaultTest(unittest.TestCase):
    def test_only_colours_and_open_groups_change_and_no_ticket_is_rewritten(self):
        with tempfile.TemporaryDirectory() as root:
            for d in TICKETING_FOLDERS:
                os.makedirs(os.path.join(root, d))
            s = Store(root, structure='ticketing', enforce_structure=True)
            s.create('project', 'Internal Tools', {'project_key': 'HB', 'project_kind': 'system'})
            t = s.create('task', 'Write it', {'project': 'HB'})
            with open(os.path.join(root, t['path']), encoding='utf-8') as f:
                before = f.read()
            cfg = s.structure.status_config()
            cfg['types']['task'] = [{**r, 'group': 'not_started'} if r['name'] == 'OnHold' else r for r in cfg['types']['task']]
            cfg['colors'] = {'Review': '#123456'}
            s.save_status_config(cfg)
            with open(os.path.join(root, t['path']), encoding='utf-8') as f:
                self.assertEqual(f.read(), before)
            self.assertEqual(s.structure.groups_of('task')['OnHold'], 'not_started')
            with self.assertRaises(StoreError):
                s.save_status_config({'types': {'task': rows(('Backlog', 'not_started'), ('Done', 'closed'))}})


class MigrateStatusesToolTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.vault = os.path.join(tmp.name, 'vault')
        for d in ('tasks', 'initiatives', 'stories', 'notes', 'transcriptions', 'meetings', 'activities', 'prompts', 'inbox', 'worklog'):
            os.makedirs(os.path.join(self.vault, d))
        self.config = os.path.join(tmp.name, 'config.json')
        with open(self.config, 'w') as f:
            json.dump({'vaults': [{'id': 'a', 'name': 'A', 'path': self.vault, 'structure': 'folders'}], 'default_vault': 'a'}, f)
        import server
        self.addCleanup(setattr, server, 'CONFIG_PATH', server.CONFIG_PATH)
        self.store = Store(self.vault)
        self.store.create('task', 'Review me', {'status': 'Review'})
        self.store.create('task', 'Done one', {'status': 'Done'})

    def run_tool(self, *args):
        out = io.StringIO()
        code = migrate_statuses.main(['--config', self.config, *args], out=out)
        return code, out.getvalue()

    def test_plan_writes_nothing_then_apply_seeds_once(self):
        code, text = self.run_tool()
        self.assertEqual(code, 0)
        self.assertIn('statuses.json: none yet', text)
        self.assertIn('Review 1', text)
        path = os.path.join(self.vault, '.task-manager', 'statuses.json')
        self.assertFalse(os.path.exists(path))
        self.assertEqual(self.run_tool('--apply')[0], 0)
        with open(path) as f:
            saved = json.load(f)
        self.assertEqual([r['name'] for r in saved['types']['task']], list(FOLDER_PER_TYPE.statuses_of('task')))
        self.assertIn('kept', self.run_tool('--apply')[1])  # idempotent

    def test_remap_renames_with_a_backup(self):
        code, text = self.run_tool('--vault', 'a', '--remap', 'task:Review=InReview')
        self.assertIn('would rename task: Review → InReview', text)
        code, text = self.run_tool('--vault', 'a', '--remap', 'task:Review=InReview', '--apply')
        self.assertEqual(code, 0)
        self.assertIn('1 item(s) moved', text)
        self.assertFalse(any(n.startswith('vault.backup-') for n in os.listdir(os.path.dirname(self.vault))))  # not next to it
        self.assertTrue(any(n.startswith('vault.backup-') for n in os.listdir(os.path.join(os.path.dirname(self.config), 'backups'))))
        s = Store(self.vault)
        self.assertIn('InReview', s.structure.statuses_of('task'))
        self.assertNotIn('Review', s.structure.statuses_of('task'))
        self.assertEqual(s.status_config()['types'][0]['unknown'], [])


if __name__ == '__main__':
    unittest.main()
