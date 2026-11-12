"""Short ids (plans/short-ids.md): a Projects vault numbers its items with one counter shared by every type, and the
app draws a number with its type's prefix (TSK-482). A vault with long ids (ACME-INI-001) keeps them."""

import json
import os
import tempfile
import unittest

from tm.store import Store, StoreError
from tm.structures.ticketing.definition import ROOT_FOLDERS, WORKLOG_FOLDER


def read(root, rel):
    with open(os.path.join(root, rel), encoding='utf-8') as f:
        return f.read()


def write(root, rel, text):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


class ShortIdsBase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        for d in [*ROOT_FOLDERS.values(), WORKLOG_FOLDER]:
            os.makedirs(os.path.join(self.root, d))
        self.s = Store(self.root, structure='ticketing', enforce_structure=True)
        self.s.create('project', 'Acme Web', {'project_key': 'ACME', 'project_kind': 'product'})
        self.s.create('project', 'Internal Tools', {'project_key': 'OPS', 'project_kind': 'system'})

    def marks(self):
        return json.loads(read(self.root, '.task-manager/ids.json'))


class NumberingTest(ShortIdsBase):
    def test_one_counter_for_every_type_and_project(self):
        ini = self.s.create('initiative', 'Checkout', {'project': 'ACME'})
        sty = self.s.create('story', 'One page', {'project': 'ACME', 'related_to': ini['id']})
        ops = self.s.create('initiative', 'Faster deploys', {'project': 'OPS'})
        task = self.s.create('task', 'Map it', {'project': 'ACME'})
        self.assertEqual([(i['id'], i['ref']) for i in (ini, sty, ops, task)],
                         [('1', 'INI-1'), ('2', 'STY-2'), ('3', 'INI-3'), ('4', 'TSK-4')])
        self.assertEqual(self.marks(), {'number': 4})
        self.assertTrue(self.s.numbered())
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_the_file_stores_the_number_and_is_named_by_its_ref(self):
        ini = self.s.create('initiative', 'Checkout', {'project': 'ACME'})
        sty = self.s.create('story', 'One page', {'project': 'ACME', 'related_to': ini['id']})
        plan = self.s.create('plan', 'Ship it', {'project': 'ACME', 'related_to': sty['id']})
        self.assertEqual(sty['path'], 'Acme Web/Stories/STY-2 One page.md')
        self.assertEqual((plan['ref'], plan['path']), ('PLN-3', 'Acme Web/Plans/PLN-3 Ship it.md'))
        self.assertRegex(read(self.root, plan['path']), r'\nid: 3 +# its number, drawn PLN-<n>\n')
        text = read(self.root, sty['path'])
        self.assertRegex(text, r'\nid: 2 +# its number, drawn STY-<n>\n')
        self.assertIn('initiative: "[[INI-1 Checkout]]"', text)
        self.assertNotIn('# STY-2', text)
        self.assertIn('\n## Acceptance criteria\n', text)  # the vault's default text for a story
        self.assertIn('item: "[[STY-2 One page]]"', read(self.root, plan['path']))
        self.assertEqual(self.s.read(sty['id'])['fields']['related_to'], '1')  # its initiative's link, as that item's key

    def test_a_number_is_never_handed_out_twice(self):
        a = self.s.create('task', 'One', {})
        b = self.s.create('task', 'Two', {})
        self.s.delete(b['key'])
        self.assertEqual(self.s.create('note', 'Three', {})['id'], '3')  # the trash still holds 2
        self.s.empty_trash()
        os.remove(os.path.join(self.root, '.task-manager', 'ids.json'))  # lost: the live items still say 3
        self.assertEqual(self.s.create('task', 'Four', {})['id'], '4')
        self.assertEqual(a['id'], '1')

    def test_a_new_title_renames_the_file_by_its_ref_and_relinks(self):
        ini = self.s.create('initiative', 'Checkout', {'project': 'ACME'})
        sty = self.s.create('story', 'One page', {'project': 'ACME', 'related_to': ini['id']})
        self.s.update(ini['key'], {'subject': 'Checkout redesign'})
        self.assertTrue(os.path.isfile(os.path.join(self.root, 'Acme Web/Initiatives/INI-1 Checkout redesign.md')))
        self.assertIn('[[INI-1 Checkout redesign]]', read(self.root, sty['path']))


class SchemeTest(unittest.TestCase):
    def vault(self, ids_json=None, files=()):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for d in [*ROOT_FOLDERS.values(), WORKLOG_FOLDER]:
            os.makedirs(os.path.join(tmp.name, d))
        if ids_json is not None:
            write(tmp.name, '.task-manager/ids.json', ids_json)
        for rel, text in files:
            write(tmp.name, rel, text)
        return Store(tmp.name, structure='ticketing', enforce_structure=True)

    def test_a_vault_with_long_ids_keeps_them(self):
        s = self.vault(ids_json='{"TSK": 7}\n')
        self.assertFalse(s.numbered())
        self.assertEqual(s.create('task', 'Next', {})['id'], 'TSK-008')

    def test_long_ids_on_disk_without_an_ids_json_keep_them_too(self):
        s = self.vault(files=[('Tasks/TSK-003 Old.md', '---\nfileClass: Ticket Task\nid: "TSK-003"\nstatus_ticket: "1. Backlog"\n---\n')])
        t = s.create('task', 'Next', {})
        self.assertEqual((t['id'], t['ref']), ('TSK-004', 'TSK-004'))  # a long id is drawn as it is

    def test_a_numbered_vault_stays_numbered_when_its_ids_json_is_lost(self):
        s = self.vault(files=[('Tasks/TSK-5 Old.md', '---\nfileClass: Ticket Task\nid: 5\nstatus_ticket: "1. Backlog"\n---\n')])
        self.assertEqual(s.create('note', 'Next', {})['ref'], 'NOTE-6')

    def test_the_folder_per_type_structure_is_not_numbered(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        s = Store(tmp.name, structure='folders')
        self.assertEqual(s.create('task', 'One', {})['id'], 'TSK-0001')


class FindTest(ShortIdsBase):
    def setUp(self):
        super().setUp()
        self.ini = self.s.create('initiative', 'Checkout', {'project': 'ACME'})
        self.task = self.s.create('task', 'Map it', {'project': 'ACME'})

    def test_by_number_by_ref_and_by_an_old_id(self):
        path = os.path.join(self.root, self.ini['path'])
        with open(path, encoding='utf-8') as f:
            text = f.read()
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text.replace('aliases: []', 'aliases: ["INI-0001", "ACME-INI-001"]'))
        for key in ('1', 'INI-1', 'ACME-INI-001', 'INI-0001', self.ini['path']):
            self.assertEqual(self.s.find(key)['id'], '1', key)
        self.assertEqual(self.s.read('ACME-INI-001')['aliases'], ['INI-0001', 'ACME-INI-001'])

    def test_a_ref_with_another_type_s_prefix_says_the_right_one(self):
        with self.assertRaises(StoreError) as cm:
            self.s.find('INI-2')
        self.assertEqual(cm.exception.status, 404)
        self.assertIn('2 is TSK-2', str(cm.exception))
        with self.assertRaises(StoreError):
            self.s.find('TSK-002')  # never zero-padded: not this item

    def test_the_api_s_writes_take_a_ref(self):
        self.s.update('TSK-2', {'priority': 'P1'})
        self.assertEqual(self.s.read('2')['fields']['priority'], 'P1')


class AppFilesTest(ShortIdsBase):
    def test_the_work_log_keeps_the_number_and_draws_the_ref(self):
        task = self.s.create('task', 'Map it', {})
        entry = self.s.log_work('TSK-1', 'Analysis', '', '2026-11-08', time='00:30')
        self.assertEqual(entry['id'], '1')
        self.assertIn('· 00:30 · TSK-1 Map it', read(self.root, 'Work log/2026/2026-11-08.md'))
        self.assertEqual(task['id'], '1')

    def test_pins_are_numbers_drawn_as_refs(self):
        self.s.create('task', 'Map it', {})
        self.s.save_pins(['1'])
        self.assertEqual(self.s.pins(), {'items': ['1']})
        self.assertIn('- TSK-1 Map it', read(self.root, '.task-manager/pins.md'))
        with self.assertRaises(StoreError):
            self.s.save_pins(['01'])

    def test_claude_is_told_the_ref_not_the_bare_number(self):
        ini = self.s.create('initiative', 'Checkout', {'project': 'ACME'})
        story = self.s.create('story', 'One page', {'project': 'ACME', 'related_to': ini['id']})
        prompt = self.s.claude_prompt(story['key'])
        self.assertIn('# STY-2 · One page', prompt)
        self.assertIn('- Related to: INI-1 · Checkout', prompt)
        self.assertTrue(self.s.claude_item_context(ini['key']).startswith('# INI-1 · Checkout'))


class ConvertTest(ShortIdsBase):
    def test_an_inbox_item_keeps_its_number(self):
        inb = self.s.create('inbox', 'Try passkeys', {})
        task = self.s.convert(inb['id'], 'task', {})
        self.assertEqual((task['id'], task['ref'], task['path']), ('1', 'TSK-1', 'Tasks/TSK-1 Try passkeys.md'))
        self.assertEqual(task['aliases'], ['INB-1'])
        self.assertFalse(os.path.exists(os.path.join(self.root, inb['path'])))
        self.assertEqual(self.s.find('INB-1')['id'], '1')
        self.assertEqual(self.s.create('task', 'Next', {})['id'], '2')
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_related_to_on_the_card_becomes_the_parent(self):
        # The inbox card's "Related to" is kept as file_under (only that key is written) and carried over on convert.
        ini = self.s.create('initiative', 'Checkout', {'project': 'ACME'})
        inb = self.s.create('inbox', 'Try passkeys', {})
        before = read(self.root, inb['path'])
        self.s.update(inb['id'], {'file_under': ini['id']})
        after = read(self.root, inb['path'])
        self.assertIn('\nfile_under: "[[INI-1 Checkout]]"\n', after)  # a link, as Obsidian reads every other one
        self.assertEqual([l for l in after.splitlines() if not l.startswith(('file_under', 'updated_date'))],
                         [l for l in before.splitlines() if not l.startswith('updated_date')])
        task = self.s.convert(inb['id'], 'task', {})
        self.assertEqual(task['fields']['related_to'], ini['id'])
        self.assertNotIn('file_under', read(self.root, task['path']))
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_a_related_to_the_new_type_cannot_take_is_dropped(self):
        ini = self.s.create('initiative', 'Checkout', {'project': 'ACME'})
        other = self.s.create('initiative', 'Billing', {'project': 'ACME'})
        a = self.s.create('inbox', 'A support ticket', {})
        self.s.update(a['id'], {'file_under': ini['id']})
        sup = self.s.convert(a['id'], 'support', {'project': 'ACME'})  # a support ticket hangs from nothing
        self.assertFalse(sup['fields'].get('related_to'))
        b = self.s.create('inbox', 'A note', {})
        self.s.update(b['id'], {'file_under': ini['id']})
        note = self.s.convert(b['id'], 'note', {'related_to': other['id']})  # what the conversion names wins
        self.assertEqual(note['fields']['related_to'], other['id'])


class ProjectMoveTest(ShortIdsBase):
    """With short ids a ticket can change project, or be in none: its file moves to that project's folder (or to its
    type's folder at the vault's top), and what hangs from it in its current home goes with it. A long id carries its
    project's key, so there it is still refused."""

    def long_id_vault(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for d in [*ROOT_FOLDERS.values(), WORKLOG_FOLDER]:
            os.makedirs(os.path.join(tmp.name, d))
        write(tmp.name, '.task-manager/ids.json', '{}\n')
        s = Store(tmp.name, structure='ticketing', enforce_structure=True)
        s.create('project', 'Acme Web', {'project_key': 'ACME', 'project_kind': 'product'})
        s.create('project', 'Internal Tools', {'project_key': 'OPS', 'project_kind': 'system'})
        return s

    def test_an_initiative_moves_with_its_stories_and_plans(self):
        ini = self.s.create('initiative', 'Checkout', {'project': 'ACME'})
        sty = self.s.create('story', 'One page', {'project': 'ACME', 'related_to': ini['id']})
        plan = self.s.create('plan', 'Ship it', {'project': 'ACME', 'related_to': sty['id']})
        task = self.s.create('task', 'Map it', {'project': 'ACME', 'related_to': ini['id']})
        out = self.s.update(ini['key'], {'project': 'OPS'})
        self.assertEqual((out['path'], out['fields']['project']), ('Internal Tools/Initiatives/INI-1 Checkout.md', 'OPS'))
        self.assertIn('\nproject: "[[00 Internal Tools]]"', read(self.root, out['path']))
        for it, path in ((sty, 'Internal Tools/Stories/STY-2 One page.md'), (plan, 'Internal Tools/Plans/PLN-3 Ship it.md')):
            now = self.s.read(it['key'])
            self.assertEqual((now['path'], now['fields']['project']), (path, 'OPS'))
            self.assertFalse(os.path.exists(os.path.join(self.root, it['path'])))
        self.assertEqual(self.s.read(sty['key'])['fields']['related_to'], ini['id'])  # links by name: still there
        self.assertEqual(self.s.read(task['key'])['path'], task['path'])  # a task is the vault's own: it stays
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_out_of_every_project_to_the_root_and_back_with_what_hangs_from_it(self):
        ini = self.s.create('initiative', 'Checkout', {'project': 'ACME'})
        sty = self.s.create('story', 'One page', {'project': 'ACME', 'related_to': ini['id']})
        plan = self.s.create('plan', 'Ship it', {'related_to': sty['id']})
        err = self.s.create('error', 'It broke', {'related_to': ini['id']})
        out = self.s.update(ini['key'], {'project': None})
        self.assertEqual((out['path'], out['fields']['project']), ('Initiatives/INI-1 Checkout.md', None))
        self.assertIn('\nproject: ""', read(self.root, out['path']))
        for it, path in ((sty, 'Stories/STY-2 One page.md'), (plan, 'Plans/PLN-3 Ship it.md'), (err, 'Records/Errors/ERR-4 It broke.md')):
            now = self.s.read(it['key'])
            self.assertEqual((now['path'], now['fields']['project']), (path, None))
            self.assertIn('\nproject: ""', read(self.root, path))
        self.assertTrue(self.s.check()['ok'], self.s.check())
        back = self.s.update(ini['key'], {'project': 'OPS'})  # and from no project into one, its tree along
        self.assertEqual(back['path'], 'Internal Tools/Initiatives/INI-1 Checkout.md')
        self.assertEqual(self.s.read(plan['key'])['path'], 'Internal Tools/Plans/PLN-3 Ship it.md')
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_never_into_a_project_without_its_type(self):
        sty = self.s.create('story', 'One page', {'project': 'ACME', 'related_to': self.s.create('initiative', 'Checkout', {'project': 'ACME'})['id']})
        self.s.create('project', 'Office', {'project_key': 'OFF', 'project_kind': 'simple'})
        with self.assertRaises(StoreError):  # a simple project has no stories
            self.s.update(sty['key'], {'project': 'OFF'})
        self.assertEqual(self.s.read(sty['key'])['path'], sty['path'])

    def test_a_story_changes_its_initiative_across_projects_or_lets_go_and_keeps_its_own(self):
        ini = self.s.create('initiative', 'Checkout', {'project': 'ACME'})
        other = self.s.create('initiative', 'Deploys', {'project': 'OPS'})
        loose = self.s.create('initiative', 'Someday', {})
        sty = self.s.create('story', 'One page', {'related_to': ini['id']})
        self.assertEqual(sty['fields']['project'], 'ACME')  # made under its initiative: in its project
        now = self.s.update(sty['key'], {'related_to': other['id'], 'project': 'OPS'})  # as the page sends it
        self.assertEqual((now['path'], now['fields']['related_to']), ('Internal Tools/Stories/STY-4 One page.md', other['id']))
        now = self.s.update(sty['key'], {'related_to': loose['id'], 'project': None})
        self.assertEqual((now['path'], now['fields']['project']), ('Stories/STY-4 One page.md', None))
        now = self.s.update(sty['key'], {'related_to': None})  # let go: it stays where it is
        self.assertEqual((now['path'], now['fields']['related_to'], now['fields']['project']), ('Stories/STY-4 One page.md', None, None))
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_a_ticket_is_made_in_no_project_and_a_sub_document_follows_its_item(self):
        ini = self.s.create('initiative', 'Someday', {})
        sup = self.s.create('support', 'Odd thing', {})
        self.assertEqual([(i['path'], i['fields']['project']) for i in (ini, sup)],
                         [('Initiatives/INI-1 Someday.md', None), ('Support/SUP-2 Odd thing.md', None)])
        anl = self.s.create('analysis', 'Why', {'related_to': ini['id'], 'project': 'ACME'})  # its item's, not the one it is given
        lrn = self.s.create('learning', 'Lesson', {'related_to': sup['id']})
        self.assertEqual([(i['path'], i['fields']['project']) for i in (anl, lrn)],
                         [('Analyses/ANL-3 Why.md', None), ('Records/Learnings/LRN-4 Lesson.md', None)])
        for d in ('Initiatives', 'Support', 'Analyses', 'Records/Learnings'):  # each folder made with its first file
            self.assertTrue(os.path.isdir(os.path.join(self.root, d)), d)
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_a_sub_document_never_chooses_nor_drops_its_project_on_its_own(self):
        ini = self.s.create('initiative', 'Checkout', {'project': 'ACME'})
        plan = self.s.create('plan', 'Ship it', {'related_to': ini['id']})
        anl = self.s.create('analysis', 'Why', {'project': 'ACME'})  # in a project, hanging from nothing
        for key, to in ((plan['key'], 'OPS'), (plan['key'], None), (anl['key'], None)):
            with self.assertRaises(StoreError) as cm:
                self.s.update(key, {'project': to})
            self.assertEqual(cm.exception.status, 400)
        self.assertEqual(self.s.update(anl['key'], {'project': 'OPS'})['path'], 'Internal Tools/Analyses/ANL-3 Why.md')
        with self.assertRaises(StoreError):  # a plan still needs its item
            self.s.create('plan', 'Loose', {})
        with self.assertRaises(StoreError):
            self.s.create('analysis', 'Loose', {})  # nothing to follow, and no project given
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_a_long_id_cannot_move_nor_leave_but_a_new_one_may_be_in_no_project(self):
        s = self.long_id_vault()
        ini = s.create('initiative', 'Checkout', {'project': 'ACME'})
        for to in ('OPS', None):
            with self.assertRaises(StoreError) as cm:
                s.update(ini['key'], {'project': to})
            self.assertIn('docs/migrate-short-ids.md', str(cm.exception))
        loose = s.create('initiative', 'Someday', {})
        sty = s.create('story', 'Later', {'related_to': loose['id']})
        self.assertEqual([(i['id'], i['path']) for i in (loose, sty)],
                         [('INI-001', 'Initiatives/INI-001 Someday.md'), ('STY-001', 'Stories/STY-001 Later.md')])
        self.assertTrue(s.check()['ok'], s.check())

    def test_no_project_is_named_as_a_folder_of_the_vault_s_own(self):
        for name in ('Initiatives', 'records', 'Tasks', 'Docs'):
            with self.assertRaises(StoreError) as cm:
                self.s.create('project', name, {'project_key': 'XY', 'project_kind': 'product'})
            self.assertEqual(cm.exception.status, 400, name)
        self.assertFalse(os.path.exists(os.path.join(self.root, 'Initiatives')))

    def test_a_project_from_before_named_as_a_root_folder_keeps_its_tickets_out_of_it(self):
        write(self.root, 'Support/00 Support.md', '---\nfileClass: Ticket Project\nproject_key: SP\nproject_kind: simple\n---\n')
        for sub in self.s.structure.codec.project_folders('simple'):
            os.makedirs(os.path.join(self.root, 'Support', sub), exist_ok=True)
        self.assertTrue(self.s.check()['ok'], self.s.check())
        with self.assertRaises(StoreError) as cm:
            self.s.create('support', 'Loose', {})
        self.assertEqual(cm.exception.status, 409)
        self.assertIn('project SP', str(cm.exception))


class CheckTest(ShortIdsBase):
    def test_a_numbered_file_must_be_named_by_its_ref_and_numbers_are_unique(self):
        write(self.root, 'Tasks/7 Wrong name.md', '---\nfileClass: Ticket Task\nid: 7\nstatus_ticket: "1. Backlog"\n---\n')
        write(self.root, 'Notes/NOTE-8 One.md', '---\nfileClass: Ticket Note\nid: 8\n---\n')
        write(self.root, 'Tasks/TSK-8 Two.md', '---\nfileClass: Ticket Task\nid: 8\nstatus_ticket: "1. Backlog"\n---\n')
        kinds = {(f['kind'], f['path']) for f in self.s.check()['blocking']}
        self.assertIn(('bad_name', 'Tasks/7 Wrong name.md'), kinds)
        self.assertIn(('duplicate_id', 'Tasks/TSK-8 Two.md'), kinds)

    def test_the_root_folders_of_a_project_s_types_are_known_and_hold_only_their_type(self):
        write(self.root, 'Initiatives/INI-7 Loose.md', '---\nfileClass: Ticket Initiative\nid: 7\nstatus_ticket: "1. Backlog"\n---\n')
        write(self.root, 'Records/Errors/ERR-8 Loose.md', '---\nfileClass: Ticket Error\nid: 8\n---\n')
        self.assertTrue(self.s.check()['ok'], self.s.check())
        write(self.root, 'Initiatives/STY-9 Wrong.md', '---\nfileClass: Ticket Story\nid: 9\nstatus_ticket: "1. Backlog"\n---\n')
        write(self.root, 'Stories/ACME-STY-010 Keyed.md', '---\nfileClass: Ticket Story\nid: "ACME-STY-010"\nstatus_ticket: "1. Backlog"\n---\n')
        write(self.root, 'Elsewhere/x.md', 'x\n')
        kinds = {(f['kind'], f['path']) for f in self.s.check()['blocking']}
        self.assertIn(('wrong_folder', 'Initiatives/STY-9 Wrong.md'), kinds)
        self.assertIn(('bad_id', 'Stories/ACME-STY-010 Keyed.md'), kinds)  # in no project: no project's key
        self.assertIn(('unexpected_folder', 'Elsewhere'), kinds)  # nothing else relaxes

    def test_zero_padded_is_not_a_number(self):
        write(self.root, 'Tasks/TSK-07 Padded.md', '---\nfileClass: Ticket Task\nid: "07"\nstatus_ticket: "1. Backlog"\n---\n')
        self.assertIn('bad_id', {f['kind'] for f in self.s.check()['blocking']})


if __name__ == '__main__':
    unittest.main()
