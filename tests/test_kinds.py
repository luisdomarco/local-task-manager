"""Initiative kinds (tm/structures/kinds.py): one table says what an initiative may be and what that gives it and its
project. The create form's choices, the Store, the rules and the vault check all read it, so it is declared once."""
import os
import pathlib
import tempfile
import unittest
from datetime import date

from tm.store import Store, StoreError
from tm.structures import get
from tm import frontmatter as fm
from tm.structures.kinds import (KINDS, LEGACY_DEFAULT, NEW_KIND, WIDENS, initiative_kind_of, initiative_has, project_delivers,
                                 project_has, widens)

ROOT = pathlib.Path(__file__).resolve().parent.parent
ROOT_FOLDERS = ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log')


class TableTest(unittest.TestCase):
    def test_the_kinds_an_initiative_may_be(self):
        self.assertEqual(list(KINDS), ['product', 'system', 'simple'])
        self.assertEqual([k.id for k in KINDS.values() if k.delivers], ['product', 'system'])  # alike: the label says what it is
        self.assertEqual((NEW_KIND, LEGACY_DEFAULT), ('simple', 'product'))
        self.assertEqual(KINDS['product'].hidden, KINDS['system'].hidden)

    def test_an_initiative_reads_its_own_kind_else_its_projects_else_a_product(self):
        self.assertIs(initiative_kind_of({'initiative_kind': 'system'}, {'project_kind': 'simple'}), KINDS['system'])
        self.assertIs(initiative_kind_of({}, {'project_kind': ' simple '}), KINDS['simple'])
        self.assertIs(initiative_kind_of({'initiative_kind': 'nonsense'}, {'project_kind': 'system'}), KINDS['system'])
        self.assertIs(initiative_kind_of({}, {}), KINDS[LEGACY_DEFAULT])  # from before kinds: a product
        self.assertIs(initiative_kind_of(None, None), KINDS[LEGACY_DEFAULT])

    def test_a_kind_only_widens(self):
        self.assertTrue(widens('simple', 'product') and widens('simple', 'system'))
        self.assertTrue(widens('product', 'system') and widens('system', 'product'))
        self.assertFalse(widens('product', 'simple') or widens('system', 'simple'))
        self.assertTrue(all(widens(k, k) for k in KINDS))
        self.assertEqual(set(WIDENS), set(KINDS))

    def test_a_project_delivers_while_one_of_its_initiatives_does(self):
        self.assertFalse(project_delivers({}, []))
        self.assertFalse(project_delivers({}, [{'initiative_kind': 'simple'}]))
        self.assertTrue(project_delivers({}, [{'initiative_kind': 'simple'}, {'initiative_kind': 'system', 'status': 'Discarded'}]))
        self.assertTrue(project_delivers({'project_kind': 'product'}, []))  # a project from before, with none yet
        self.assertFalse(project_delivers({'project_kind': 'simple'}, [{}]))  # its initiatives read simple

    def test_what_a_project_and_an_initiative_may_have(self):
        simple, product = [{'initiative_kind': 'simple'}], [{'initiative_kind': 'product'}]
        for t in ('support', 'hotfix'):
            self.assertFalse(project_has(t, {}, simple))
            self.assertTrue(project_has(t, {}, product))
        for t in ('initiative', 'spec', 'story', 'prd', 'plan', 'analysis', 'error', 'learning'):
            self.assertTrue(project_has(t, {}, simple), t)
        for t in ('story', 'prd', 'plan'):
            self.assertFalse(initiative_has(t, {'initiative_kind': 'simple'}), t)
            self.assertTrue(initiative_has(t, {'initiative_kind': 'system'}), t)
        self.assertTrue(initiative_has('analysis', {'initiative_kind': 'simple'}))


class OneSourceTest(unittest.TestCase):
    def test_the_structure_and_its_create_form_take_the_kinds_from_the_table(self):
        s = get('ticketing')
        self.assertEqual((s.kinds, s.kind_key), (KINDS, 'initiative_kind'))
        kind = next(p for p in s.types['initiative'].props if p['key'] == 'initiative_kind')
        self.assertEqual(kind['options'], [[k.id, k.label] for k in KINDS.values()])
        self.assertEqual((kind['default'], kind['widens']), (NEW_KIND, {k: list(v) for k, v in WIDENS.items()}))
        project = {p['key']: p for p in s.types['project'].props}
        self.assertNotIn('enabled_types', project)
        self.assertEqual(project['project_kind']['kind'], 'readonly')
        self.assertNotIn('once', project['project_kind'])  # never asked: a note from before says it

    def test_a_structure_without_projects_has_no_kinds(self):
        self.assertEqual(get('folders').kinds, {})

    def test_no_kind_is_named_outside_the_table(self):
        """The Store, the codec and the check name no kind: each asks the table (it used to be written in all three)."""
        for rel in ('tm/store.py', 'tm/structures/ticketing/codec.py', 'tm/structures/ticketing/check.py'):
            text = (ROOT / rel).read_text(encoding='utf-8')
            for kind in KINDS:
                self.assertNotIn(f"'{kind}'", text, f'{rel} names the kind {kind}')


class KindDataTest(unittest.TestCase):
    def test_what_a_kind_hides_is_a_field_of_that_type(self):
        s = get('ticketing')
        for kind in KINDS.values():
            for t, keys in kind.hidden.items():
                for key in keys:
                    with self.subTest(kind=kind.id, type=t, key=key):
                        self.assertIn(key, s.allowed_fields(t))

    def test_the_page_gets_the_kinds(self):
        pub = get('ticketing').public()
        self.assertEqual((pub['kind_key'], pub['legacy_kind_key']), ('initiative_kind', 'project_kind'))
        self.assertEqual([k['id'] for k in pub['kinds']], list(KINDS))
        simple = pub['kinds'][2]
        self.assertEqual((simple['delivers'], simple['widens']), (False, ['product', 'system']))
        self.assertIn('size', simple['hidden']['initiative'])
        self.assertNotIn('kinds', get('folders').public())

    def test_the_projects_sample_has_initiatives_of_every_kind_and_a_project_with_two(self):
        s = Store(str(ROOT / 'sample-vault'), structure='ticketing', enforce_structure=True)
        r = s._resolver()
        by_project = {}
        for i in s.items():
            if i['type'] == 'initiative':
                pf = (r.projects.get(i['fields'].get('project')) or {}).get('fields')
                by_project.setdefault(i['fields'].get('project'), set()).add(initiative_kind_of(i['fields'], pf).id)
        self.assertEqual(set().union(*by_project.values()), set(KINDS))
        self.assertEqual(by_project['ACME'], {'product', 'system'})


class KindRulesTest(unittest.TestCase):
    """What an initiative's kind gives it and its project, and the rules that follow from it."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        for d in ROOT_FOLDERS:
            os.makedirs(os.path.join(self.root, d))
        self.s = Store(self.root, structure='ticketing', enforce_structure=True)
        self.move = self.s.create('project', 'Office Move', {'project_key': 'MOVE'})
        self.ops = self.s.create('project', 'Internal Tools', {'project_key': 'OPS'})

    def refused(self, *args, says=''):
        with self.assertRaises(StoreError) as e:
            self.s.create(*args)
        self.assertEqual(e.exception.status, 400)
        self.assertIn(says, str(e.exception))
        return e.exception

    def legacy(self, project, kind):
        """A project note from before kinds moved to initiatives: it says one."""
        path = os.path.join(self.root, project['path'])
        with open(path, encoding='utf-8') as f:
            text = f.read()
        with open(path, 'w', encoding='utf-8') as f:
            f.write(fm.patch(text, {'project_kind': kind}))

    def test_a_new_project_is_its_note_and_its_folders_come_with_their_first_file(self):
        self.assertEqual(sorted(os.listdir(os.path.join(self.root, 'Office Move'))), ['00 Office Move.md'])
        self.assertNotIn('project_kind', self.move['fields'])
        self.assertNotIn('enabled_types', self.move['fields'])
        self.assertTrue(self.s.check()['ok'], self.s.check())
        self.s.create('spec', 'Badges', {'project': 'MOVE'})  # specs in every project
        self.assertTrue(os.path.isdir(os.path.join(self.root, 'Office Move', 'Specs')))
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_a_new_initiative_is_simple_and_has_no_stories_prd_nor_plan(self):
        ini = self.s.create('initiative', 'New office', {'project': 'MOVE'})
        self.assertEqual(ini['fields']['initiative_kind'], 'simple')
        for t in ('task', 'note', 'meeting', 'analysis'):  # the work that hangs from it
            self.s.create(t, f'A {t}', {'project': 'MOVE', 'related_to': ini['id']})
        for t in ('story', 'prd', 'plan'):
            with self.subTest(t):
                self.refused(t, f'A {t}', {'project': 'MOVE', 'related_to': ini['id']}, says='is a simple initiative')
        for t in ('support', 'hotfix'):
            with self.subTest(t):
                self.refused(t, f'A {t}', {'project': 'MOVE'}, says='takes no new')

    def test_a_simple_initiative_is_ready_with_its_objective_and_nothing_else(self):
        """Its objective is asked of every kind, and of a simple one it is all that is asked: no story, no size, no
        regime, no premise. The objective is not delivery machinery — it is how an initiative says when it is over,
        and that is what tells an initiative from an area."""
        ini = self.s.create('initiative', 'New office', {'project': 'MOVE'})
        with self.assertRaises(StoreError) as e:  # not even a simple one leaves Backlog without saying how it ends
            self.s.update(ini['key'], {'status': 'ToDo'}, by='agent')
        self.assertIn('an initiative is ready (ToDo) only with objective', str(e.exception))
        ready = self.s.update(ini['key'], {'objective': 'everyone works from the new office', 'status': 'ToDo'}, by='agent')
        self.assertEqual(ready['fields']['status'], 'ToDo')
        other = self.s.create('initiative', 'Faster deploys', {'project': 'OPS', 'initiative_kind': 'system',
                                                               'objective': 'a deploy takes under two minutes'})
        with self.assertRaises(StoreError) as e:  # a system's still needs its readiness and a story
            self.s.update(other['key'], {'status': 'ToDo'}, by='agent')
        self.assertIn('at least one story', str(e.exception))

    def _simple_in_todo(self, project='MOVE'):
        """A simple initiative of `project`, approved: what its tasks deliver."""
        ini = self.s.create('initiative', 'New office', {'project': project})
        self.s.update(ini['key'], {'objective': 'everyone works from the new office', 'status': 'ToDo'})
        return ini

    def test_the_first_task_of_a_simple_initiative_starts_it_and_a_preliminary_one_does_not(self):
        """A task is the unit of delivery of a simple initiative, which has no stories. The rule fires only from
        ToDo, and that is what lets the preliminaries of one still in Backlog — its analysis, its plan, its research
        tasks — run without declaring it under way."""
        ini = self.s.create('initiative', 'New office', {'project': 'MOVE'})
        early = self.s.create('task', 'Ask three movers for a quote', {'project': 'MOVE', 'related_to': ini['key']})
        self.s.update(early['key'], {'status': 'InProgress'})
        self.assertEqual(self.s.read(ini['key'])['fields']['status'], 'Backlog')  # a preliminary moves nothing
        self.s.update(ini['key'], {'objective': 'everyone works from the new office', 'status': 'ToDo'})
        task = self.s.create('task', 'Sign the lease', {'project': 'MOVE', 'related_to': ini['key']})
        self.s.update(task['key'], {'status': 'InProgress'})
        self.assertEqual(self.s.read(ini['key'])['fields']['status'], 'InProgress')
        log = self.s.read(ini['key'])['fields']['status_log']
        self.assertEqual((log[-1]['to'], log[-1]['by']), ('4. InProgress', 'rule'))

    def test_a_task_delivers_only_the_initiative_whose_kind_it_is_the_child_of(self):
        """Only the shape its kind delivers through counts, and only its own parent. A system initiative delivers
        through stories, so a task of it moves nothing; and a task of a support has a parent that is not an
        initiative at all."""
        ini = self.s.create('initiative', 'Faster deploys', {'project': 'OPS', 'initiative_kind': 'system',
                                                             'objective': 'a deploy takes under two minutes'})
        self.s.create('story', 'Cache the build', {'project': 'OPS', 'related_to': ini['key']})
        self.s.update(ini['key'], {'premise': 'verified', 'premise_verified': f'{date.today().isoformat()} @ abc123',
                                   'status': 'ToDo'})
        task = self.s.create('task', 'Read the build logs', {'project': 'OPS', 'related_to': ini['key']})
        self.s.update(task['key'], {'status': 'InProgress'})
        self.assertEqual(self.s.read(ini['key'])['fields']['status'], 'ToDo')  # a task is not how a system delivers
        sup = self.s.create('support', 'The runner is slow', {'project': 'OPS'})
        held = self.s.create('task', 'Ask the provider', {'project': 'OPS', 'related_to': sup['key']})
        self.s.update(held['key'], {'status': 'InProgress'})
        self.assertEqual(self.s.read(ini['key'])['fields']['status'], 'ToDo')  # and a task of a support moves none

    def test_a_simple_initiative_waits_in_review_when_its_last_task_closes(self):
        """The rule stops at Review: closing is a decision. And because Review is not a closed status, the
        initiative has no completed_at until the owner gives it for done."""
        ini = self._simple_in_todo()
        a = self.s.create('task', 'Sign the lease', {'project': 'MOVE', 'related_to': ini['key']})
        b = self.s.create('task', 'Move the desks', {'project': 'MOVE', 'related_to': ini['key']})
        self.s.update(a['key'], {'status': 'InProgress'})
        self.s.update(a['key'], {'status': 'Done'})
        self.assertEqual(self.s.read(ini['key'])['fields']['status'], 'InProgress')  # b is still open
        with self.assertRaises(StoreError) as e:  # and not by hand either, while b is open
            self.s.update(ini['key'], {'status': 'Review'}, by='agent')
        self.assertIn('an initiative closes with its tasks', str(e.exception))
        self.s.update(b['key'], {'status': 'Discarded', 'discard_reason': 'the desks stay'})
        got = self.s.read(ini['key'])['fields']
        self.assertEqual(got['status'], 'Review')
        self.assertFalse(got.get('completed_at'))  # Review is not a close
        self.s.update(ini['key'], {'status': 'Done'})
        self.assertTrue(self.s.read(ini['key'])['fields'].get('completed_at'))

    def test_a_project_follows_its_initiatives_into_work_and_never_out_of_it(self):
        """A project is a place, not a bet: it is activated by work starting in it, and it closes only because the
        owner says there is no work left to host. Parking it was a decision, so waking it is another one."""
        for key, status, expected in (('PTD', 'ToDo', 'InProgress'), ('PBK', 'Backlog', 'Backlog'),
                                      ('POH', 'OnHold', 'OnHold')):
            with self.subTest(status):
                p = self.s.create('project', f'Place {status}', {'project_key': key})
                extra = {'on_hold': {'by': 'me', 'why': 'not this quarter'}} if status == 'OnHold' else {}
                self.s.update(p['key'], {'status': status, **extra})
                ini = self.s.create('initiative', f'Something {key}', {'project': key, 'objective': 'it is done'})
                self.s.update(ini['key'], {'status': 'ToDo'})
                task = self.s.create('task', f'Start {key}', {'project': key, 'related_to': ini['key']})
                self.s.update(task['key'], {'status': 'InProgress'})
                self.assertEqual(self.s.read(ini['key'])['fields']['status'], 'InProgress')
                self.assertEqual(self.s.read(p['key'])['fields']['status'], expected)
                self.s.update(task['key'], {'status': 'Done'})  # the rule takes the initiative to Review…
                self.assertEqual(self.s.read(ini['key'])['fields']['status'], 'Review')
                self.s.update(ini['key'], {'status': 'Done'})  # …and the owner closes it
                self.assertEqual(self.s.read(p['key'])['fields']['status'], expected)  # the project does not move

    def test_widening_an_initiative_already_in_work_asks_for_what_the_new_kind_delivers(self):
        """The readiness gate fires once, when the initiative enters work, and it asks what the kind it was then had
        of it. Widening is a declaration that it delivers, so the gate belongs at the declaration too — refused
        rather than sent backwards, because it is being worked on."""
        ini = self._simple_in_todo()
        task = self.s.create('task', 'Sign the lease', {'project': 'MOVE', 'related_to': ini['key']})
        self.s.update(task['key'], {'status': 'InProgress'})
        self.assertEqual(self.s.read(ini['key'])['fields']['status'], 'InProgress')
        with self.assertRaises(StoreError) as e:
            self.s.update(ini['key'], {'initiative_kind': 'system'}, by='agent')
        self.assertIn('its premise verified', str(e.exception))
        self.assertEqual(self.s.read(ini['key'])['fields']['initiative_kind'], 'simple')  # unchanged
        self.assertEqual(self.s.read(ini['key'])['fields']['status'], 'InProgress')  # and not sent backwards
        # Its story is not among what is asked, and must not be: a story only hangs from one that already delivers,
        # so asking for one first would make widening impossible.
        self.assertNotIn('story', str(e.exception))
        self.s.update(ini['key'], {'premise': 'verified', 'premise_verified': f'{date.today().isoformat()} @ abc123'})
        widened = self.s.update(ini['key'], {'initiative_kind': 'system'}, by='agent')
        self.assertEqual(widened['fields']['initiative_kind'], 'system')
        self.s.create('story', 'Move the servers', {'project': 'MOVE', 'related_to': ini['key']})  # now it may have one

    def test_the_kind_of_an_initiative_matches_its_project_by_project_key(self):
        """The rules that run after a write have no resolver, so they look the project up in the items themselves —
        and must match it by `project_key`, because a project's own key is its note's path. It only shows on an
        initiative from before kinds moved to initiatives, the one that reads its project's kind: matched on the
        wrong field it would silently read the default instead."""
        from tm.structures.ticketing.rules import _kind_of
        proj = {'type': 'project', 'key': 'Internal Tools/00 Internal Tools.md',
                'fields': {'project_key': 'OPS', 'project_kind': 'system'}}
        legacy = {'type': 'initiative', 'key': 'INI-9', 'fields': {'project': 'OPS'}}  # no kind of its own
        self.assertEqual(_kind_of(self.s, legacy, [proj, legacy]).id, 'system')
        self.assertNotEqual('system', LEGACY_DEFAULT)  # so the assertion above cannot pass by accident

    def test_an_initiative_with_no_children_is_moved_by_no_rule(self):
        """Nothing delivers it, so nothing reports back: it is closed by a decision or not at all."""
        ini = self._simple_in_todo()
        self.assertEqual(self.s.read(ini['key'])['fields']['status'], 'ToDo')
        self.assertEqual(self.s.update(ini['key'], {'status': 'InProgress'})['fields']['status'], 'InProgress')
        self.assertEqual(self.s.read(ini['key'])['fields']['status'], 'InProgress')  # no rule takes it further
        self.assertEqual(self.s.update(ini['key'], {'status': 'Review'})['fields']['status'], 'Review')

    def test_a_kind_widens_and_brings_stories_support_and_hotfixes(self):
        ini = self.s.create('initiative', 'Faster deploys', {'project': 'OPS'})
        self.refused('support', 'Slow backup', {'project': 'OPS'}, says='takes no new Support')
        self.assertEqual(self.s.update(ini['key'], {'initiative_kind': 'system'})['fields']['initiative_kind'], 'system')
        self.s.create('story', 'Cache the build', {'project': 'OPS', 'related_to': ini['id']})
        self.s.create('prd', 'Vision', {'project': 'OPS', 'related_to': ini['id']})  # an agentic system has one too
        sup = self.s.create('support', 'Slow backup', {'project': 'OPS'})
        self.s.item_action('escalate', sup['key'])  # a system has hotfixes too
        self.assertEqual(self.s.update(ini['key'], {'initiative_kind': 'product'})['fields']['initiative_kind'], 'product')
        with self.assertRaises(StoreError) as e:
            self.s.update(ini['key'], {'initiative_kind': 'simple'})
        self.assertIn('only widens', str(e.exception))
        with self.assertRaises(StoreError):
            self.s.update(ini['key'], {'initiative_kind': 'nonsense'})
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_any_status_counts_and_what_a_project_held_stays_but_takes_no_more(self):
        ini = self.s.create('initiative', 'Shop', {'project': 'OPS', 'initiative_kind': 'product'})
        self.s.update(ini['key'], {'status': 'Discarded'}, by='owner')
        sup = self.s.create('support', 'Broken', {'project': 'OPS'})  # a discarded product initiative still counts
        self.s.update(ini['key'], {'project': 'MOVE'})  # its only delivering initiative leaves
        self.assertEqual([i['type'] for i in self.s.items() if i['fields'].get('project') == 'OPS' and i['type'] != 'project'], ['support'])
        self.s.update(sup['key'], {'priority': 'P1'})  # the one it holds stays, and is still edited
        self.refused('support', 'Broken again', {'project': 'OPS'}, says='takes no new Support')  # but no new one
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_an_initiative_moves_with_its_stories_and_leaves_support_where_it_was(self):
        ini = self.s.create('initiative', 'Shop', {'project': 'OPS', 'initiative_kind': 'product'})
        sty = self.s.create('story', 'Pay', {'project': 'OPS', 'related_to': ini['id']})
        sup = self.s.create('support', 'Broken', {'project': 'OPS'})
        self.refused('support', 'Lost key', {'project': 'MOVE'}, says='takes no new Support')
        self.s.update(ini['key'], {'project': 'MOVE'})
        moved = self.s.read(ini['key'])
        self.assertEqual((moved['fields']['project'], moved['fields']['initiative_kind']), ('MOVE', 'product'))
        self.assertEqual(self.s.read(sty['key'])['fields']['project'], 'MOVE')
        self.assertEqual(self.s.read(sup['key'])['fields']['project'], 'OPS')
        self.s.create('support', 'Lost key', {'project': 'MOVE'})  # it came with a product initiative
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_a_story_goes_only_to_a_delivering_initiative(self):
        a = self.s.create('initiative', 'Shop', {'project': 'OPS', 'initiative_kind': 'product'})
        b = self.s.create('initiative', 'Desk plan', {'project': 'OPS'})
        sty = self.s.create('story', 'Pay', {'project': 'OPS', 'related_to': a['id']})
        with self.assertRaises(StoreError) as e:
            self.s.update(sty['key'], {'related_to': b['id']})
        self.assertIn('is a simple initiative', str(e.exception))

    def test_a_project_from_before_keeps_reading_its_kind(self):
        self.legacy(self.ops, 'product')
        self.s.create('support', 'Broken', {'project': 'OPS'})  # it delivers, with no initiative yet
        ini = self.s.create('initiative', 'Shop', {'project': 'OPS'})
        self.assertEqual(ini['fields']['initiative_kind'], 'product')  # a new one in it says its project's
        path = os.path.join(self.root, ini['path'])
        with open(path, encoding='utf-8') as f:
            text = f.read()
        with open(path, 'w', encoding='utf-8') as f:  # one from before, that says no kind
            f.write(fm.drop(text, ['initiative_kind']))
        self.s.create('story', 'Pay', {'project': 'OPS', 'related_to': ini['id']})
        self.s.update(ini['key'], {'project': 'MOVE'})  # it moves: it says the kind it read
        self.assertEqual(self.s.read(ini['key'])['fields']['initiative_kind'], 'product')
        self.legacy(self.move, 'simple')
        self.assertEqual(self.s.create('initiative', 'Desk plan', {'project': 'MOVE'})['fields']['initiative_kind'], 'simple')
        with self.assertRaises(StoreError) as e:
            self.s.update(self.move['key'], {'project_kind': 'product'})
        self.assertIn('kept as it is', str(e.exception))
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_a_promoted_support_ticket_becomes_a_delivering_initiative(self):
        self.s.create('initiative', 'Faster deploys', {'project': 'OPS', 'initiative_kind': 'system'})
        sup = self.s.create('support', 'Slow backup', {'project': 'OPS'})
        ini = self.s.item_action('promote', sup['key'])['created']
        self.assertEqual(ini['fields']['initiative_kind'], 'system')


class DropTest(unittest.TestCase):
    def test_drop_removes_a_key_and_its_block_and_keeps_every_other_byte(self):
        text = '---\na: 1   # kept\nlist:\n  - x\n  - y\nm: {C1: 0}\nz: "z"\n---\nBody\n'
        self.assertEqual(fm.drop(text, ['list', 'm']), '---\na: 1   # kept\nz: "z"\n---\nBody\n')
        self.assertEqual(fm.drop(text, ['nope']), text)
        self.assertEqual(fm.drop('no frontmatter', ['a']), 'no frontmatter')


if __name__ == '__main__':
    unittest.main()
