"""Project kinds (tm/structures/kinds.py): one table says what a project may be and which types of its own folders
it has. The create form's choices, the Store, the codec and the vault check all read it, so it is declared once."""
import os
import pathlib
import tempfile
import unittest

from tm.store import Store, StoreError
from tm.structures import get
from tm import frontmatter as fm
from tm.structures.kinds import DEFAULT_KIND, ENABLEABLE, KINDS, LISTED, kind_of
from tm.structures.ticketing.check import _project_folders
from tm.structures.ticketing.codec import TicketingCodec
from tm.structures.ticketing.definition import CORE_PROJECT_TYPES, PROJECT_TYPES

ROOT = pathlib.Path(__file__).resolve().parent.parent
ROOT_FOLDERS = ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log')
ALL_FOLDERS = ['Initiatives', 'Stories', 'Specs', 'Support', 'Plans', 'Analyses', 'Records/Errors', 'Records/Learnings']


class TableTest(unittest.TestCase):
    def test_the_kinds_a_project_may_be(self):
        self.assertEqual(list(KINDS), ['product', 'system', 'simple'])
        self.assertEqual(DEFAULT_KIND, 'product')
        self.assertEqual(KINDS['product'].default_enabled(), [*LISTED, 'hotfix', 'prd'])
        self.assertEqual(KINDS['system'].default_enabled(), list(LISTED))
        self.assertEqual(KINDS['simple'].default_enabled(), ['initiative'])  # analyses only when it turns them on
        self.assertEqual(ENABLEABLE, ('initiative', 'story', 'support', 'spec', 'hotfix', 'prd', 'analysis'))

    def test_a_note_naming_no_kind_or_an_unknown_one_reads_as_the_default(self):
        self.assertIs(kind_of(None), KINDS[DEFAULT_KIND])
        self.assertIs(kind_of(' system '), KINDS['system'])
        self.assertIs(kind_of('nonsense'), KINDS[DEFAULT_KIND])

    def test_the_projects_folders_follow_its_kind_and_enabled_types(self):
        self.assertEqual(TicketingCodec.project_folders('product'), [*ALL_FOLDERS, 'Hotfixes', 'PRDs'])
        self.assertEqual(TicketingCodec.project_folders('system'), ALL_FOLDERS)
        self.assertEqual(TicketingCodec.project_folders('system', ['prd']), ALL_FOLDERS)  # a system has no PRDs
        self.assertEqual(TicketingCodec.project_folders('product', ['prd']), [*ALL_FOLDERS, 'PRDs'])
        self.assertEqual(TicketingCodec.project_folders('simple'), ['Initiatives'])
        self.assertEqual(TicketingCodec.project_folders('simple', ['analysis']), ['Initiatives', 'Analyses'])
        self.assertEqual(TicketingCodec.project_folders('product', []), ALL_FOLDERS)

    def test_the_check_requires_no_optional_folder_a_note_does_not_turn_on(self):
        must = ['Initiatives', 'Support', 'Plans', 'Analyses', 'Records/Errors', 'Records/Learnings']  # Stories, Specs may lack
        self.assertEqual(_project_folders('product', None), must)  # no enabled_types: none of the optional ones
        self.assertEqual(_project_folders(None, ['hotfix']), [*must, 'Hotfixes'])


class OneSourceTest(unittest.TestCase):
    def test_the_structure_and_its_create_form_take_the_kinds_from_the_table(self):
        s = get('ticketing')
        self.assertEqual((s.kinds, s.kind_key), (KINDS, 'project_kind'))
        self.assertIs(s.kind('system'), KINDS['system'])
        self.assertIs(s.kind(''), KINDS[DEFAULT_KIND])
        kind = next(p for p in s.types['project'].props if p['key'] == 'project_kind')
        self.assertEqual(kind['options'], [[k.id, k.label] for k in KINDS.values()])
        enabled = next(p for p in s.types['project'].props if p['key'] == 'enabled_types')
        self.assertEqual((enabled['options'], enabled['fixed']), ([[t, t] for t in ENABLEABLE], list(LISTED)))
        self.assertEqual((CORE_PROJECT_TYPES, PROJECT_TYPES), (LISTED, ENABLEABLE))

    def test_a_structure_without_projects_has_no_kinds(self):
        self.assertEqual(get('folders').kinds, {})
        self.assertIsNone(get('folders').kind('product'))

    def test_no_kind_is_named_outside_the_table(self):
        """The Store, the codec and the check name no kind: each asks the table (it used to be written in all three)."""
        for rel in ('tm/store.py', 'tm/structures/ticketing/codec.py', 'tm/structures/ticketing/check.py'):
            text = (ROOT / rel).read_text(encoding='utf-8')
            for kind in KINDS:
                self.assertNotIn(f"'{kind}'", text, f'{rel} names the kind {kind}')


class StoreTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        for d in ROOT_FOLDERS:
            os.makedirs(os.path.join(self.root, d))
        self.s = Store(self.root, structure='ticketing', enforce_structure=True)

    def test_a_project_that_names_no_kind_is_the_default_one(self):
        p = self.s.create('project', 'Acme Web', {'project_key': 'ACME'})
        self.assertEqual(p['fields']['project_kind'], DEFAULT_KIND)
        self.assertEqual(p['fields']['enabled_types'], KINDS[DEFAULT_KIND].default_enabled())
        for sub in TicketingCodec.project_folders(DEFAULT_KIND):
            self.assertTrue(os.path.isdir(os.path.join(self.root, 'Acme Web', sub)), sub)
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_a_kind_not_in_the_table_is_refused(self):
        with self.assertRaises(StoreError) as e:
            self.s.create('project', 'Acme Web', {'project_key': 'ACME', 'project_kind': 'nonsense'})
        self.assertEqual(e.exception.status, 400)
        self.assertIn(' or '.join(KINDS), str(e.exception))
        self.assertFalse(os.path.exists(os.path.join(self.root, 'Acme Web')))



class KindDataTest(unittest.TestCase):
    def test_what_a_kind_hides_is_a_field_of_that_type(self):
        s = get('ticketing')
        for kind in KINDS.values():
            for t, keys in kind.hidden.items():
                for key in keys:
                    with self.subTest(kind=kind.id, type=t, key=key):
                        self.assertIn(key, s.allowed_fields(t))
            self.assertTrue(set(kind.optional) <= set(kind.types) and set(kind.default_on) <= set(kind.optional), kind.id)

    def test_the_page_gets_the_kinds(self):
        pub = get('ticketing').public()
        self.assertEqual(pub['kind_key'], 'project_kind')
        self.assertEqual([k['id'] for k in pub['kinds']], list(KINDS))
        simple = pub['kinds'][2]
        self.assertEqual((simple['types'], simple['optional']), (['initiative', 'analysis'], ['analysis']))
        self.assertIn('execution_mode', simple['hidden']['project'])
        self.assertNotIn('kinds', get('folders').public())

    def test_the_projects_sample_has_a_project_of_every_kind(self):
        s = Store(str(ROOT / 'sample-vault'), structure='ticketing', enforce_structure=True)
        kinds = {i['fields'].get('project_kind') for i in s.items() if i['type'] == 'project'}
        self.assertEqual(kinds, set(KINDS))


class KindRulesTest(unittest.TestCase):
    """What a project's kind lets it have, and the rules that follow from it."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        for d in ROOT_FOLDERS:
            os.makedirs(os.path.join(self.root, d))
        self.s = Store(self.root, structure='ticketing', enforce_structure=True)
        self.move = self.s.create('project', 'Office Move', {'project_key': 'MOVE', 'project_kind': 'simple'})
        self.ops = self.s.create('project', 'Internal Tools', {'project_key': 'OPS', 'project_kind': 'system'})

    def refused(self, *args, says=''):
        with self.assertRaises(StoreError) as e:
            self.s.create(*args)
        self.assertEqual(e.exception.status, 400)
        self.assertIn(says, str(e.exception))

    def test_a_simple_project_has_initiatives_and_the_work_that_hangs_from_them(self):
        self.assertEqual(sorted(os.listdir(os.path.join(self.root, 'Office Move'))), ['00 Office Move.md', 'Initiatives'])
        self.assertEqual(self.move['fields']['enabled_types'], ['initiative'])
        self.assertTrue(self.s.check()['ok'], self.s.check())
        ini = self.s.create('initiative', 'New office', {'project': 'MOVE'})
        for t in ('task', 'note', 'meeting'):  # the vault's own types: in any project, under its initiative
            self.s.create(t, f'A {t}', {'project': 'MOVE', 'related_to': ini['id']})
        for t in ('story', 'support', 'spec', 'error', 'learning', 'hotfix', 'prd'):
            with self.subTest(t):
                self.refused(t, f'A {t}', {'project': 'MOVE', **({'related_to': ini['id']} if t == 'story' else {})},
                             says='is of kind simple')
        self.refused('plan', 'Plan', {'project': 'MOVE', 'related_to': ini['id']}, says='is of kind simple')

    def test_a_simple_project_turns_analyses_on(self):
        self.refused('analysis', 'Options', {'project': 'MOVE'}, says='turned off')
        f = self.s.update(self.move['key'], {'enabled_types': ['initiative', 'story', 'support', 'spec', 'analysis']})['fields']
        self.assertEqual(f['enabled_types'], ['initiative', 'analysis'])  # the always-on ones it lacks are left out
        self.assertTrue(os.path.isdir(os.path.join(self.root, 'Office Move', 'Analyses')))
        self.s.create('analysis', 'Options', {'project': 'MOVE'})  # project-level: no item of its own
        self.assertTrue(self.s.check()['ok'], self.s.check())
        f = self.s.update(self.move['key'], {'enabled_types': ['analysis', 'hotfix']})['fields']
        self.assertEqual(f['enabled_types'], ['initiative', 'analysis'])  # a type its kind lacks is not written

    def test_a_simple_initiative_is_ready_with_no_story_size_regime_or_premise(self):
        ini = self.s.create('initiative', 'New office', {'project': 'MOVE'})
        self.assertEqual(self.s.update(ini['key'], {'status': 'ToDo'}, by='agent')['fields']['status'], 'ToDo')
        other = self.s.create('initiative', 'Faster deploys', {'project': 'OPS'})
        with self.assertRaises(StoreError) as e:  # a system's still needs its readiness and a story
            self.s.update(other['key'], {'status': 'ToDo'}, by='agent')
        self.assertIn('at least one story', str(e.exception))

    def test_a_simple_project_has_no_delivery_settings(self):
        p = self.s.create('project', 'Garden', {'project_key': 'GDN', 'project_kind': 'simple', 'execution_mode': 'serial',
                                                'support_due_days': {'C1': 3}})
        self.assertNotEqual(p['fields'].get('execution_mode'), 'serial')  # what the form filled in for it is not kept
        self.assertNotEqual((p['fields'].get('support_due_days') or {}).get('C1'), 3)
        for bad in ({'execution_mode': 'serial'}, {'support_due_days': {'C1': 1}}, {'repo': '~/x'}):
            with self.subTest(bad), self.assertRaises(StoreError) as e:
                self.s.update(self.move['key'], bad)
            self.assertIn('kind simple', str(e.exception))

    def test_an_agentic_system_has_no_hotfixes_nor_prds(self):
        self.assertFalse(os.path.exists(os.path.join(self.root, 'Internal Tools', 'Hotfixes')))
        self.refused('hotfix', 'Down', {'project': 'OPS'}, says='is of kind system')
        self.refused('prd', 'Vision', {'project': 'OPS'}, says='is of kind system')
        self.s.update(self.ops['key'], {'enabled_types': ['initiative', 'hotfix']})  # a type it lacks is not written
        self.assertNotIn('hotfix', self.s.read(self.ops['key'])['fields']['enabled_types'])
        self.assertFalse(os.path.exists(os.path.join(self.root, 'Internal Tools', 'Hotfixes')))
        sup = self.s.create('support', 'Backup is slow', {'project': 'OPS'})
        with self.assertRaises(StoreError):  # escalating makes a hotfix: none in a system
            self.s.item_action('escalate', sup['key'])

    def test_a_simple_projects_note_has_no_delivery_placeholders(self):
        with open(os.path.join(self.root, self.move['path']), encoding='utf-8') as f:
            keys = fm.parse(fm.split(f.read())[0])
        for key in ('repo', 'managed_by', 'execution_mode', 'support_due_days'):
            self.assertNotIn(key, keys)  # hidden for its kind: once made, it could not be edited
        with open(os.path.join(self.root, self.ops['path']), encoding='utf-8') as f:
            self.assertIn('execution_mode', fm.parse(fm.split(f.read())[0]))

    def test_a_system_note_written_with_hotfixes_saves_and_the_check_warns(self):
        path = os.path.join(self.root, self.ops['path'])
        with open(path, encoding='utf-8') as f:
            text = f.read()
        with open(path, 'w', encoding='utf-8') as f:  # from when a system project could turn hotfixes on
            f.write(fm.patch(text, {'enabled_types': ['initiative', 'story', 'support', 'spec', 'hotfix']}))
        os.makedirs(os.path.join(self.root, 'Internal Tools', 'Hotfixes'))
        pathlib.Path(self.root, 'Internal Tools', 'Hotfixes', 'OPS-HFX-001 Down.md').write_text('---\nfileClass: Ticket Hotfix\nid: OPS-HFX-001\n---\n')
        fields = self.s.read(self.ops['key'])['fields']
        self.s.update(self.ops['key'], {'enabled_types': fields['enabled_types']})  # the page's Types, sent unchanged
        warned = [w for w in self.s.check()['warnings'] if w['kind'] == 'kind_lacks_type']
        self.assertEqual([w['path'] for w in warned], ['Internal Tools/Hotfixes'])

    def test_a_note_with_no_kind_may_be_given_one_once(self):
        path = os.path.join(self.root, self.ops['path'])
        with open(path, encoding='utf-8') as f:
            text = f.read()
        with open(path, 'w', encoding='utf-8') as f:  # written by hand, with no kind
            f.write(fm.drop(text, ['project_kind']))
        self.assertIn('unknown_kind', [w['kind'] for w in self.s.check()['warnings']])
        with self.assertRaises(StoreError):
            self.s.update(self.ops['key'], {'project_kind': 'mystery'})
        self.s.update(self.ops['key'], {'project_kind': 'system'})
        self.assertNotIn('unknown_kind', [w['kind'] for w in self.s.check()['warnings']])
        with self.assertRaises(StoreError) as e:
            self.s.update(self.ops['key'], {'project_kind': 'product'})
        self.assertIn('keeps the kind', str(e.exception))

    def test_a_project_keeps_its_kind(self):
        with self.assertRaises(StoreError) as e:
            self.s.update(self.move['key'], {'project_kind': 'product'})
        self.assertIn('keeps the kind', str(e.exception))
        self.s.update(self.move['key'], {'project_kind': 'simple'})  # the same one: nothing changes
        self.assertEqual(self.s.read(self.move['key'])['fields']['project_kind'], 'simple')

    def test_a_product_note_from_before_enabled_types_still_has_its_hotfixes(self):
        p = self.s.create('project', 'Acme Web', {'project_key': 'ACME', 'project_kind': 'product'})
        path = os.path.join(self.root, p['path'])
        with open(path, encoding='utf-8') as f:
            text = f.read()
        with open(path, 'w', encoding='utf-8') as f:
            f.write(fm.patch(text, {'enabled_types': None}, None))
        sup = self.s.create('support', 'Broken', {'project': 'ACME'})
        self.s.create('hotfix', 'Down', {'project': 'ACME', 'related_to': sup['id']})  # no enabled_types: its kind's defaults



class DropTest(unittest.TestCase):
    def test_drop_removes_a_key_and_its_block_and_keeps_every_other_byte(self):
        text = '---\na: 1   # kept\nlist:\n  - x\n  - y\nm: {C1: 0}\nz: "z"\n---\nBody\n'
        self.assertEqual(fm.drop(text, ['list', 'm']), '---\na: 1   # kept\nz: "z"\n---\nBody\n')
        self.assertEqual(fm.drop(text, ['nope']), text)
        self.assertEqual(fm.drop('no frontmatter', ['a']), 'no frontmatter')


if __name__ == '__main__':
    unittest.main()
