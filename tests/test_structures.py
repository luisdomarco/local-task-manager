"""tm/structures: a vault's types defined by data. The folder-per-type structure is the tables tm/store.py always had, and a Store
reads its rules (types, statuses, ids, the external reference) from its own structure, not from those tables."""
import dataclasses
import json
import os
import re
import tempfile
import unittest

from tm import store as store_mod
from tm.store import Store, StoreError
from tm.structures import REGISTRY, STRUCTURES, get
from tm.structures.folders import FOLDER_PER_TYPE


class FolderPerTypeTest(unittest.TestCase):
    def test_the_old_tables_are_folder_per_type_own(self):
        self.assertEqual(FOLDER_PER_TYPE.item_types, store_mod.ITEM_TYPES)
        self.assertEqual(FOLDER_PER_TYPE.default_folders, store_mod.DEFAULT_FOLDERS)
        self.assertEqual(FOLDER_PER_TYPE.type_fields, store_mod.TYPE_FIELDS)
        self.assertEqual(FOLDER_PER_TYPE.parent_types, store_mod.PARENT_TYPES)
        self.assertEqual(list(FOLDER_PER_TYPE.statuses), store_mod.STATUSES)
        self.assertEqual(list(FOLDER_PER_TYPE.priorities), store_mod.PRIORITIES)
        self.assertEqual(set(FOLDER_PER_TYPE.closed), store_mod.CLOSED)
        self.assertIs(FOLDER_PER_TYPE.id_re, store_mod.ID_RE)
        self.assertEqual(FOLDER_PER_TYPE.allowed_fields('initiative') - FOLDER_PER_TYPE.allowed_fields('task') >= {'user_stories', 'redmine_id'}, True)
        self.assertIn('legacy_id', store_mod.ALLOWED_FIELDS['story'])

    def test_registered_by_id(self):
        self.assertIs(get('folders'), FOLDER_PER_TYPE)
        self.assertEqual(STRUCTURES, {k: {'label': s.label} for k, s in REGISTRY.items()})

    def test_ids(self):
        self.assertEqual(FOLDER_PER_TYPE.parse_id('TSK-0042'), ('TSK', 42))
        self.assertIsNone(FOLDER_PER_TYPE.parse_id('HB-SUP-022'))
        self.assertIsNone(FOLDER_PER_TYPE.parse_id(None))
        self.assertEqual(FOLDER_PER_TYPE.format_id('INI', 7), 'INI-0007')

    def test_the_page_gets_every_type_with_how_to_show_it(self):
        pub = FOLDER_PER_TYPE.public()
        self.assertEqual([t['name'] for t in pub['types']],
                         ['task', 'initiative', 'story', 'note', 'transcription', 'meeting', 'agent', 'activity', 'prompt', 'inbox'])
        by = {t['name']: t for t in pub['types']}
        self.assertEqual(pub['external_ref']['label'], 'Ticket')
        self.assertEqual([t for t in by if by[t]['plannable']], ['task', 'initiative', 'story'])
        self.assertEqual([t for t in by if by[t]['convertible']],
                         ['task', 'initiative', 'story', 'note', 'transcription', 'meeting', 'agent', 'activity'])
        self.assertEqual([t for t in by if not by[t]['relatable']], ['prompt', 'inbox'])
        self.assertEqual(by['activity']['closed_when'], 'resolved_at')
        self.assertEqual(by['story']['plural'], 'User stories')
        self.assertIn('extref', by['initiative']['list']['columns'])


# A structure that is not the folder-per-type one: other statuses, other prefixes, three-digit ids, another tracker.
TINY = dataclasses.replace(
    FOLDER_PER_TYPE, id='tiny', label='Tiny',
    types={'bug': dataclasses.replace(FOLDER_PER_TYPE.types['task'], name='bug', prefix='BUG', folder='bugs', parents=(),
                                      fields=(*FOLDER_PER_TYPE.types['task'].fields, 'redmine_id', 'redmine_url'),
                                      statuses=('Open', 'Fixed', 'WontFix'), closed=frozenset({'Fixed', 'WontFix'})),
           'inbox': FOLDER_PER_TYPE.types['inbox']},
    statuses=('Open', 'Fixed', 'WontFix'), closed=frozenset({'Fixed', 'WontFix'}), priorities=('P0', 'P1'),
    id_re=re.compile(r'^([A-Z]+)-(\d{3,})$'), id_pad=3, defaults={'status': 'Open', 'priority': 'P1'},
    external_ref={'id_key': 'redmine_id', 'url_key': 'redmine_url', 'label': 'Ticket'},
)


class OtherStructureTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        self.s = Store(self.root, structure=TINY)

    def test_its_folders_ids_and_statuses(self):
        self.assertEqual(self.s.folders['bug'], 'bugs')
        bug = self.s.create('bug', 'Crash', {'status': 'Open', 'priority': 'P0'})
        self.assertEqual(bug['id'], 'BUG-001')
        self.assertTrue(os.path.exists(os.path.join(self.root, 'bugs', 'BUG-001-crash.md')))
        with self.assertRaises(StoreError):
            self.s.create('bug', 'Wrong status', {'status': 'Done'})  # a folder-per-type status, not one of this structure
        with self.assertRaises(StoreError):
            self.s.create('task', 'Not a type here')
        second = self.s.create('bug', 'Second')
        self.assertEqual((second['id'], second['fields']['status'], second['fields']['priority']), ('BUG-002', 'Open', 'P1'))

    def test_its_closed_statuses_set_completed_at(self):
        bug = self.s.create('bug', 'Crash', {'status': 'Open'})
        self.assertIsNone(bug['fields'].get('completed_at'))
        done = self.s.update(bug['id'], {'status': 'WontFix'})
        self.assertTrue(done['fields']['completed_at'])
        self.assertIsNone(self.s.update(bug['id'], {'status': 'Open'})['fields'].get('completed_at'))

    def test_its_board_and_check(self):
        self.assertEqual([l['status'] for l in self.s.board()['lists']], ['Open', 'Fixed', 'WontFix'])
        self.assertEqual(self.s.check()['missing_folders'], ['bugs', 'inbox', 'worklog'])

    def test_the_prompt_names_its_tracker(self):
        bug = self.s.create('bug', 'Crash', {'redmine_id': '12'})
        self.assertIn('- Ticket: #12', self.s.claude_prompt(bug['id']))
        self.assertNotIn('Redmine', self.s.claude_prompt(bug['id']))

    def test_no_user_story_migration(self):
        self.assertEqual(self.s.migrate_user_stories(), [])


class LayoutTest(unittest.TestCase):
    """Where the page shows each type: as a page of its own or a card, the tables on its page, and the tab of each of
    its own fields (Ticketing follows the folder-per-type structure's layout: properties in the main column, the rest in the side panel)."""

    def types(self, structure):
        return {t['name']: t for t in structure.public()['types']}

    def test_folders_has_one_page_the_initiatives_with_its_four_tables(self):
        types = self.types(FOLDER_PER_TYPE)
        self.assertEqual([n for n, t in types.items() if t.get('page')], ['initiative'])
        self.assertEqual(types['initiative']['children'], ['story', 'task', 'note', 'meeting'])
        self.assertEqual(types['initiative']['parent_label'], 'Sub-initiative of')

    def test_ticketing_has_pages_for_its_projects_initiatives_and_prds(self):
        types = self.types(get('ticketing'))
        self.assertEqual(sorted(n for n, t in types.items() if t.get('page')), ['initiative', 'prd', 'project'])
        for name, t in types.items():
            for child in t.get('children', []):
                self.assertIn(child, types, f'{name} lists a table of {child}, which is not a type')
        self.assertNotIn('parent_label', types['initiative'])  # an initiative hangs from nothing: its stories hang from it
        self.assertEqual(types['initiative']['children'][0], 'story')
        self.assertEqual((types['story']['parent_label'], types['prd']['parent_label']), ('Initiative', 'Initiative'))
        self.assertEqual(types['hotfix']['parent_label'], 'Origin')

    def test_every_link_is_in_relations_and_the_execution_fields_in_delivery(self):
        types = self.types(get('ticketing'))
        for name, t in types.items():
            for p in t.get('props', []):
                self.assertIn(p['tab'], ('main', 'delivery', 'relations', 'details', 'hidden'), f'{name}.{p["key"]}')
                if p['kind'] in ('link', 'links'):
                    self.assertEqual(p['tab'], 'relations', f'{name}.{p["key"]}')
        tab = {p['key']: p['tab'] for p in types['initiative']['props']}
        self.assertEqual([k for k, v in tab.items() if v == 'main'], ['size', 'area', 'objective'])
        self.assertNotIn('branch', tab)  # delivered by its stories
        story = [(p['group'], p['key']) for p in types['story']['props'] if p['tab'] == 'delivery']
        self.assertEqual(story, [('Execution', 'executor'), ('Execution', 'branch'), ('Execution', 'baseline'),
                                 ('Spec and release', 'spec_impact'), ('Spec and release', 'changelog_ref'),
                                 ('Paused or discarded', 'on_hold'), ('Paused or discarded', 'discard_reason')])
        for name, t in types.items():  # every Delivery field has its group, and a group's fields sit together
            groups = [p.get('group') for p in t.get('props', []) if p['tab'] == 'delivery']
            self.assertNotIn(None, groups, name)
            self.assertEqual(groups, sorted(groups, key=groups.index), name)
        self.assertEqual({p['tab'] for p in types['project']['props']}, {'details', 'hidden'})

    def test_a_type_turned_off_leaves_the_pages_tables_and_the_optional_types(self):
        s = get('ticketing').without(['plan', 'hotfix'])
        types = self.types(s)
        self.assertNotIn('plan', types['initiative']['children'])
        self.assertNotIn('plan', types['project']['children'])
        self.assertEqual(s.public()['optional_types'], ['prd'])
        self.assertEqual(get('ticketing').public()['optional_types'], ['hotfix', 'prd'])


class PageCopyTest(unittest.TestCase):
    def test_the_pages_copy_of_folder_per_type_is_the_servers(self):
        """static/js/structure.js: what the page shows before it has its vault's structure, and the node tests' one."""
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'static', 'js', 'structure.js')
        with open(path, encoding='utf-8') as f:
            text = f.read()
        literal = text[text.index('export const FOLDER_PER_TYPE = ') + len('export const FOLDER_PER_TYPE = '):text.rindex(';')]
        self.assertEqual(json.loads(literal), json.loads(json.dumps(FOLDER_PER_TYPE.public())))


class StoreDefaultsToFolderPerTypeTest(unittest.TestCase):
    def test_a_store_without_a_structure_is_folder_per_type(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertIs(Store(root).structure, FOLDER_PER_TYPE)
            self.assertIs(Store(root, structure='folders').structure, FOLDER_PER_TYPE)
            self.assertIn('- Ticket: #4521', Store(root).claude_prompt(Store(root).create('story', 'S', {'redmine_id': '4521'})['id']))


if __name__ == '__main__':
    unittest.main()
