"""The Ticketing structure (tm/structures/ticketing): files in the native format of docs/ticketing-second-brain,
read and written by the Store without losing a byte it did not mean to change."""
import difflib
import os
import tempfile
import unittest
from datetime import date

from tm import frontmatter as fm
from tm.store import Store, StoreError
from tm.structures.ticketing import specs, wikilinks

ROOT_FOLDERS = ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log')


def read(root, rel):
    with open(os.path.join(root, rel), encoding='utf-8') as f:
        return f.read()


def write(root, rel, text):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


# A story its gate lets into ToDo: a scenario written and its spec impact declared.
READY_BODY = '## Acceptance criteria\n\n#### Scenario: Pay\n- **WHEN** the cart goes to checkout\n- **THEN** it is one page\n'
READY = {'spec_impact': 'none: a test'}


class TicketingBase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        for d in ROOT_FOLDERS:
            os.makedirs(os.path.join(self.root, d))
        # A vault from before short ids (an ids.json without the number's mark): these tests are of its long ids,
        # KEY-TYPE-NNN. A new vault numbers its items: tests/test_short_ids.py.
        write(self.root, '.task-manager/ids.json', '{}\n')
        self.s = Store(self.root, structure='ticketing', enforce_structure=True)
        self.hb = self.s.create('project', 'Internal Tools', {'project_key': 'HB', 'project_kind': 'system'})
        self.ecd = self.s.create('project', 'Acme Web', {'project_key': 'ECD', 'project_kind': 'product'})

    def changed_keys(self, before, after):
        """The frontmatter keys whose lines differ between two texts of one file."""
        out = set()
        for line in difflib.unified_diff(before.split('\n'), after.split('\n'), lineterm='', n=0):
            if line[:1] in '+-' and not line.startswith(('+++', '---')):
                key = line[1:].split(':', 1)[0].strip()
                out.add(key)
        return out


class LayoutTest(TicketingBase):
    def test_a_project_is_its_folder_note_and_type_folders(self):
        self.assertEqual(self.hb['path'], 'Internal Tools/00 Internal Tools.md')
        self.assertEqual((self.hb['type'], self.hb['fields']['project']), ('project', 'HB'))
        for sub in ('Initiatives', 'Support', 'Plans', 'Analyses', 'Records/Errors', 'Records/Learnings'):
            self.assertTrue(os.path.isdir(os.path.join(self.root, 'Internal Tools', sub)), sub)
        self.assertFalse(os.path.exists(os.path.join(self.root, 'Internal Tools', 'Hotfixes')))  # a system project
        self.assertTrue(os.path.isdir(os.path.join(self.root, 'Acme Web', 'Hotfixes')))  # a product one
        self.assertTrue(self.s.check()['ok'], self.s.check())
        with self.assertRaises(StoreError):  # a key is unique
            self.s.create('project', 'Other', {'project_key': 'HB'})

    def test_tickets_get_their_project_key_and_root_types_do_not(self):
        sup = self.s.create('support', 'El gate falla', {'project': 'HB'})
        ini = self.s.create('initiative', 'Curación', {'project': 'HB'})
        sup2 = self.s.create('support', 'Otro', {'project': 'ECD'})
        task = self.s.create('task', 'Revisar', {'project': 'HB'})
        self.assertEqual([sup['id'], ini['id'], sup2['id'], task['id']], ['HB-SUP-001', 'HB-INI-001', 'ECD-SUP-001', 'TSK-001'])
        self.assertEqual(sup['path'], 'Internal Tools/Support/HB-SUP-001 El gate falla.md')
        self.assertEqual(task['path'], 'Tasks/TSK-001 Revisar.md')
        self.assertEqual(task['fields']['project'], 'HB')
        loose = self.s.create('support', 'Sin proyecto', {})  # in no project: its type's folder at the top, its bare prefix
        self.assertEqual((loose['id'], loose['path'], loose['fields']['project']), ('SUP-001', 'Support/SUP-001 Sin proyecto.md', None))
        self.assertIn('\nproject: ""', read(self.root, loose['path']))
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_a_new_ticket_is_its_template_filled_in(self):
        sup = self.s.create('support', 'Algo se rompe', {'project': 'HB', 'level': 'C1', 'origin': 'ci'}, body='Se rompe al crear.')
        text = read(self.root, sup['path'])
        f = fm.parse(fm.split(text)[0])
        self.assertEqual(f['fileClass'], 'Ticket Support')
        self.assertEqual(f['id'], 'HB-SUP-001')
        self.assertEqual(f['project'], '[[00 Internal Tools]]')
        self.assertEqual(f['status_ticket'], '1. Backlog')
        self.assertEqual((f['level'], f['level_base'], f['origin']), ('C1', 'C1', 'ci'))
        self.assertEqual(f['due'], date.today().isoformat())  # C1: support_due_days 0
        self.assertIn('# HB-SUP-001 — Algo se rompe', text)
        self.assertIn('Se rompe al crear.', text)
        self.assertIn('## Related', text)
        self.assertIn('# C1 · C2 · C3', text)  # the template's comments stay

    def test_plans_and_analyses_have_an_id_as_every_ticket(self):
        ini = self.s.create('initiative', 'Curación de decisions', {'project': 'HB'})
        plan = self.s.create('plan', 'Curar en dos pasos', {'related_to': ini['id']})
        self.assertEqual((plan['id'], plan['path']), ('HB-PLN-001', 'Internal Tools/Plans/HB-PLN-001 Curar en dos pasos.md'))
        self.assertEqual(plan['fields']['related_to'], ini['id'])
        text = read(self.root, plan['path'])
        self.assertIn('item: "[[HB-INI-001 Curación de decisions]]"', text)  # what it executes
        self.assertIn('\n# HB-PLN-001 — Curar en dos pasos\n', text)
        self.assertIn('The *why* is in what it executes ([[HB-INI-001 Curación de decisions]])', text)
        an = self.s.create('analysis', 'Revisión P1', {'project': 'HB', 'kind': 'review'})
        self.assertEqual((an['id'], an['path']), ('HB-ANL-001', 'Internal Tools/Analyses/HB-ANL-001 Revisión P1.md'))
        self.assertIn('\n# HB-ANL-001 — Revisión P1\n', read(self.root, an['path']))
        renamed = self.s.update(an['key'], {'subject': 'Revisión P2'})
        self.assertEqual(renamed['path'], 'Internal Tools/Analyses/HB-ANL-001 Revisión P2.md')  # named by its title, as a ticket
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_a_plan_or_an_analysis_from_before_ids_keeps_its_name(self):
        ini = self.s.create('initiative', 'Curación de decisions', {'project': 'HB'})
        plan_rel, an_rel = 'Internal Tools/Plans/HB-INI-001 Plan.md', 'Internal Tools/Analyses/2026-10-12 Revisión P1.md'
        write(self.root, plan_rel, '---\nfileClass: Ticket Plan\nitem: "[[HB-INI-001 Curación de decisions]]"\n'
              'project: "[[00 Internal Tools]]"\ncreation_date: 2026-10-01\nupdated_date: 2026-10-01\n---\n\n# Plan\n')
        write(self.root, an_rel, '---\nfileClass: Ticket Analysis\ntitle: "Revisión: P1"\nproject: "[[00 Internal Tools]]"\n'
              'creation_date: 2026-10-12\nupdated_date: 2026-10-12\n---\n\n# Revisión: P1\n')
        plan, an = self.s.read(plan_rel), self.s.read(an_rel)
        self.assertEqual((plan['id'], plan['key'], plan['title'], plan['fields']['related_to']), (None, plan_rel, 'HB-INI-001 Plan', ini['id']))
        self.assertEqual((an['id'], an['key'], an['title']), (None, an_rel, 'Revisión: P1'))
        self.assertTrue(self.s.check()['ok'], self.s.check())  # no id, and named as it was: not a finding
        self.assertEqual(self.s.assign_missing_ids(), [])  # the app never numbers one (tools/migrate_short_ids.py does)
        self.assertEqual(self.s.update(an_rel, {'subject': 'Revisión P2'})['path'], 'Internal Tools/Analyses/2026-10-12 Revisión P2.md')
        self.assertEqual(self.s.update(plan_rel, {'subject': 'Otro'})['path'], plan_rel)  # named after its item, not its title
        self.assertEqual(self.s.create('plan', 'Nuevo', {'related_to': ini['id']})['id'], 'HB-PLN-001')  # a new one has an id


class ProjectNoteTest(TicketingBase):
    def test_a_new_project_note_is_titled_by_its_name_and_keeps_its_description(self):
        p = self.s.create('project', 'Web Shop', {'project_key': 'WEB'}, 'What we sell online.\n')
        with open(os.path.join(self.root, p['path']), encoding='utf-8') as f:
            text = f.read()
        self.assertIn('\n# Web Shop\n', text)
        self.assertIn('What we sell online.', text)


class RoundTripTest(TicketingBase):
    def test_a_status_change_touches_only_status_log_and_dates(self):
        sup = self.s.create('support', 'Algo', {'project': 'HB'})
        before = read(self.root, sup['path'])
        out = self.s.update(sup['id'], {'status': 'InProgress'}, by='owner')  # as the page does
        after = read(self.root, sup['path'])
        changed = self.changed_keys(before, after)  # updated_date is a date: the same day, the same line
        self.assertTrue({'status_ticket', 'status_log'} <= changed <= {'status_ticket', 'status_log', 'updated_date'}, changed)
        self.assertEqual(out['fields']['status'], 'InProgress')
        f = fm.parse(fm.split(after)[0])
        self.assertEqual(f['status_ticket'], '4. InProgress')
        self.assertEqual(f['status_log'], [{'date': date.today().isoformat(), 'from': '1. Backlog', 'to': '4. InProgress', 'by': 'owner'}])
        self.assertEqual(fm.split(before)[1], fm.split(after)[1])  # the body untouched

    def test_editing_a_comment_touches_only_comments(self):
        sup = self.s.create('support', 'Algo', {'project': 'HB'})
        self.s.add_comment(sup['id'], 'one')
        before = read(self.root, sup['path'])
        self.s.edit_comment(sup['id'], 0, 'one, edited')
        after = read(self.root, sup['path'])
        self.assertEqual(self.changed_keys(before, after), {'comments'})
        self.assertEqual(self.s.read(sup['id'])['fields']['comments'][0]['text'], 'one, edited')

    def test_unknown_keys_comments_and_hand_written_lines_survive(self):
        sup = self.s.create('support', 'Algo', {'project': 'HB'})
        path = os.path.join(self.root, sup['path'])
        text = read(self.root, sup['path']).replace('area: ""', 'area: ""\nmy_own_key: keep me   # and my comment')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)
        self.s.update(sup['id'], {'labels': ['gate'], 'level_reason': 'blocks every run'})
        after = read(self.root, sup['path'])
        self.assertIn('my_own_key: keep me   # and my comment', after)
        f = fm.parse(fm.split(after)[0])
        self.assertEqual((f['tags'], f['level_reason']), (['gate'], 'blocks every run'))

    def test_a_file_written_by_hand_is_read_with_its_links(self):
        write(self.root, 'Internal Tools/Initiatives/HB-INI-094 Curación.md',
              '---\nfileClass: Ticket Initiative\nid: "HB-INI-094"\nproject: "[[00 Internal Tools]]"\nstatus_ticket: "2. ToDo"\n'
              'status_log:\n  - date: 2026-10-10\n    from: 1. Backlog\n    to: 2. ToDo\n    by: owner\npriority: P1\n'
              'tags: [arbol]\ncreation_date: 2026-10-01\nupdated_date: 2026-10-10\n---\n\nBody\n')
        write(self.root, 'Tasks/TSK-007 Revisar.md',
              '---\nfileClass: Ticket Task\nid: "TSK-007"\nrelated_to: "[[HB-INI-094 Curación|la curación]]"\n'
              'relations: ["[[HB-INI-094 Curación#Plan]]", "[[Nota que no existe]]"]\nstatus_ticket: "1. Backlog"\n---\n')
        ini = self.s.read('HB-INI-094')
        self.assertEqual((ini['title'], ini['fields']['status'], ini['fields']['priority'], ini['fields']['labels']),
                         ('Curación', 'ToDo', 'P1', ['arbol']))
        self.assertEqual((ini['fields']['created_at'], ini['fields']['project']), ('2026-10-01', 'HB'))
        task = self.s.read('TSK-007')
        self.assertEqual(task['fields']['related_to'], 'HB-INI-094')  # an alias and a heading still name the note
        self.assertEqual(task['fields']['relations'], ['HB-INI-094'])
        self.s.update('TSK-007', {'labels': ['x']})  # a change elsewhere never drops the link nobody answers to
        self.assertIn('[[Nota que no existe]]', read(self.root, 'Tasks/TSK-007 Revisar.md'))
        self.s.update('TSK-007', {'relations': ['HB-INI-094']})
        self.assertIn('[[Nota que no existe]]', read(self.root, 'Tasks/TSK-007 Revisar.md'))

    def test_renaming_rewrites_every_link_and_keeps_copies(self):
        sup = self.s.create('support', 'El gate falla', {'project': 'HB'})
        task = self.s.create('task', 'Revisar', {'related_to': sup['id']})
        write(self.root, 'Notes/NOTE-001 Nota.md', '---\nfileClass: Ticket Note\nid: "NOTE-001"\n---\n\nVer [[HB-SUP-001 El gate falla|el SUP]] y [[HB-SUP-001 El gate falla 2]].\n')
        out = self.s.update(sup['id'], {'subject': 'El gate de una unidad nueva'})
        self.assertEqual(out['path'], 'Internal Tools/Support/HB-SUP-001 El gate de una unidad nueva.md')
        self.assertFalse(os.path.exists(os.path.join(self.root, sup['path'])))
        self.assertIn('[[HB-SUP-001 El gate de una unidad nueva]]', read(self.root, task['path']))
        note = read(self.root, 'Notes/NOTE-001 Nota.md')
        self.assertIn('[[HB-SUP-001 El gate de una unidad nueva|el SUP]]', note)
        self.assertIn('[[HB-SUP-001 El gate falla 2]]', note)  # another note's name, untouched
        backups = os.path.join(self.root, '.task-manager', 'backup')
        copies = [os.path.join(d, f) for d, _, fs in os.walk(backups) for f in fs]
        self.assertEqual(len(copies), 3)  # the renamed file and the two that linked to it, as they were
        self.assertTrue(self.s.check()['ok'])

    def test_the_vault_check_blocks_what_does_not_belong(self):
        self.assertTrue(self.s.check()['ok'])
        cases = {
            'Random/x.md': 'unexpected_folder',
            'Internal Tools/Support/HB-INI-009 Wrong.md': 'wrong_folder',
            'Internal Tools/Support/ECD-SUP-009 Other key.md': 'bad_id',
            'Internal Tools/Support/HB-SUP-010.md': 'bad_name',
            'Tasks/TSK-1 Short.md': 'bad_id',
        }
        bodies = {
            'Random/x.md': '---\nfileClass: Ticket Note\n---\n',
            'Internal Tools/Support/HB-INI-009 Wrong.md': '---\nfileClass: Ticket Initiative\nid: "HB-INI-009"\n---\n',
            'Internal Tools/Support/ECD-SUP-009 Other key.md': '---\nfileClass: Ticket Support\nid: "ECD-SUP-009"\n---\n',
            'Internal Tools/Support/HB-SUP-010.md': '---\nfileClass: Ticket Support\nid: "HB-SUP-010"\n---\n',
            'Tasks/TSK-1 Short.md': '---\nfileClass: Ticket Task\nid: "TSK-1"\n---\n',
        }
        for rel, kind in cases.items():
            with self.subTest(rel):
                write(self.root, rel, bodies[rel])
                found = [f['kind'] for f in self.s.check()['blocking']]
                self.assertIn(kind, found)
                os.remove(os.path.join(self.root, rel))
                if rel.startswith('Random/'):
                    os.rmdir(os.path.join(self.root, 'Random'))
        write(self.root, '00 Index Tickets.md', '# index\n')
        write(self.root, '00 Tickets.base', 'views: []\n')
        self.assertTrue(self.s.check()['ok'])
        os.rmdir(os.path.join(self.root, 'Internal Tools', 'Plans'))
        r = self.s.check()
        self.assertEqual((r['missing_folders'], r['can_create_folders']), (['Internal Tools/Plans'], True))
        with self.assertRaises(StoreError):  # read-only until it matches
            self.s.create('task', 'No', {})


class RulesTest(TicketingBase):
    def test_support_level_goes_up_and_moves_the_due_date(self):
        sup = self.s.create('support', 'Algo', {'project': 'HB', 'level': 'C3'})
        self.assertEqual(sup['fields']['due'], (date.today().fromordinal(date.today().toordinal() + 30)).isoformat())
        up = self.s.update(sup['id'], {'level': 'C2'})
        self.assertEqual(up['fields']['due'], (date.today().fromordinal(date.today().toordinal() + 7)).isoformat())
        with self.assertRaises(StoreError):  # more than one above where it was born
            self.s.update(sup['id'], {'level': 'C1'})
        with self.assertRaises(StoreError):  # down, without a new reason
            self.s.update(sup['id'], {'level': 'C3'})
        self.assertEqual(self.s.update(sup['id'], {'level': 'C3', 'level_reason': 'not that bad after all'})['fields']['level'], 'C3')

    def test_the_same_signature_is_one_more_occurrence(self):
        first = self.s.create('support', 'Gate', {'project': 'HB', 'signature': 'gate|unit'})
        again = self.s.create('support', 'Gate again', {'project': 'HB', 'signature': 'gate|unit'}, body='seen on run 42')
        self.assertEqual((again['id'], again['fields']['occurrences']), (first['id'], 2))
        self.assertIn('seen on run 42', read(self.root, again['path']))
        third = self.s.create('support', 'Gate 3', {'project': 'HB', 'signature': 'gate|unit'})
        self.assertEqual((third['fields']['occurrences'], third['fields']['level']), (3, 'C1'))  # 3 occurrences: one level up
        other = self.s.create('support', 'Gate ECD', {'project': 'ECD', 'signature': 'gate|unit'})
        self.assertNotEqual(other['id'], first['id'])  # another project's ticket

    def test_transitions_and_their_gates(self):
        sup = self.s.create('support', 'Algo', {'project': 'HB'})
        with self.assertRaises(StoreError):
            self.s.update(sup['id'], {'status': 'Done'})  # Backlog → Done is not a move
        with self.assertRaises(StoreError):
            self.s.update(sup['id'], {'status': 'Discarded'})  # without a reason
        with self.assertRaises(StoreError):
            self.s.update(sup['id'], {'status': 'OnHold'})  # without why
        held = self.s.update(sup['id'], {'status': 'OnHold', 'on_hold': {'by': 'me', 'why': 'waiting on CI'}})
        self.assertEqual(held['fields']['status'], 'OnHold')
        gone = self.s.update(sup['id'], {'status': 'Discarded', 'discard_reason': 'not reproducible'})
        self.assertEqual((gone['fields']['disposition'], gone['fields']['resolution']), ('discard', 'discarded'))
        ini = self.s.create('initiative', 'Algo', {'project': 'HB'})
        with self.assertRaises(StoreError) as cm:
            self.s.update(ini['id'], {'status': 'ToDo'})
        self.assertIn('at least one story', str(cm.exception))  # the template gives it a size and a regime; a story it must be given

    def test_the_owner_moves_freely_an_agent_through_the_gates(self):
        ini = self.s.create('initiative', 'Algo', {'project': 'HB'})
        with self.assertRaises(StoreError):
            self.s.update(ini['id'], {'status': 'InProgress'})  # an agent (the Store's default): Backlog → ToDo first
        moved = self.s.update(ini['id'], {'status': 'InProgress'}, by='owner')  # the owner, in the app
        self.assertEqual(moved['fields']['status'], 'InProgress')
        sup = self.s.create('support', 'Otro', {'project': 'HB'})
        self.assertEqual(self.s.update(sup['id'], {'status': 'Discarded'}, by='owner')['fields']['status'], 'Discarded')  # no reason asked
        log = fm.parse(fm.split(read(self.root, moved['path']))[0])['status_log']
        self.assertEqual(log[-1]['by'], 'owner')
        story = self.s.create('story', 'Una', {'project': 'HB', 'related_to': ini['id']})
        with self.assertRaises(StoreError):
            self.s.update(story['id'], {'status': 'ToDo'}, by='agent')  # its gate: no scenario, no spec impact
        self.assertEqual(self.s.update(story['id'], {'status': 'ToDo'}, by='owner')['fields']['status'], 'ToDo')

    def test_promote_and_close_with_what_it_became(self):
        sup = self.s.create('support', 'Algo serio', {'project': 'ECD', 'level': 'C1'})
        out = self.s.item_action('promote', sup['id'])
        ini, sup = out['created'], out['support']
        self.assertEqual((ini['id'], ini['fields']['priority'], ini['fields']['origin']), ('ECD-INI-001', 'P0', sup['id']))
        self.assertEqual((sup['fields']['status'], sup['fields']['promoted_to'], sup['fields']['resolution']), ('OnHold', ini['id'], 'promoted'))
        with self.assertRaises(StoreError):
            self.s.item_action('escalate', sup['id'])  # already promoted
        story = self.s.create('story', 'Arreglarlo', {'project': 'ECD', 'related_to': ini['id'], **READY}, READY_BODY)
        self.s.update(ini['id'], {'size': 'S', 'regime': 'standard', 'premise': 'verified',  # the readiness gate, met
                                  'premise_verified': f'{date.today().isoformat()} @ abc123', 'status': 'ToDo'})
        for status in ('ToDo', 'InProgress', 'Review', 'Done'):  # the initiative follows its only story
            self.s.update(story['id'], {'status': status})
        self.assertEqual(self.s.read(ini['id'])['fields']['status'], 'Done')
        self.assertEqual(self.s.read(sup['id'])['fields']['status'], 'Done')
        log = fm.parse(fm.split(read(self.root, self.s.read(sup['id'])['path']))[0])['status_log']
        self.assertEqual(log[-1]['by'], 'rule')

    def test_escalate_makes_a_hotfix_with_its_own_gates(self):
        sup = self.s.create('support', 'Caída', {'project': 'ECD'})
        hfx = self.s.item_action('escalate', sup['id'])['created']
        self.assertEqual((hfx['id'], hfx['fields']['status'], hfx['fields']['related_to']), ('ECD-HFX-001', 'ToDo', sup['id']))
        with self.assertRaises(StoreError):
            self.s.update(hfx['id'], {'status': 'InProgress'})  # no rollback plan
        self.s.update(hfx['id'], {'rollback_plan': 'revert the deploy', 'status': 'InProgress'})
        self.s.update(hfx['id'], {'status': 'Review'})
        with self.assertRaises(StoreError):
            self.s.update(hfx['id'], {'status': 'Done'})  # no post-mortem
        err = self.s.create('error', 'Caída del worker', {'project': 'ECD', 'related_to': hfx['id']})
        self.s.update(hfx['id'], {'postmortem': err['id'], 'status': 'Done'})
        self.assertEqual(self.s.read(sup['id'])['fields']['status'], 'Done')
        self.assertIn('[[ECD-ERR-001 Caída del worker]]', read(self.root, self.s.read(hfx['id'])['path']))

    def test_a_serial_project_runs_one_thing_at_a_time(self):
        note = os.path.join(self.root, self.hb['path'])
        with open(note, encoding='utf-8') as f:
            text = f.read()
        with open(note, 'w', encoding='utf-8') as f:
            f.write(fm.patch(text, {'execution_mode': 'serial'}))
        a = self.s.create('support', 'A', {'project': 'HB'})
        b = self.s.create('support', 'B', {'project': 'HB'})
        self.s.update(a['id'], {'status': 'InProgress'})
        with self.assertRaises(StoreError) as cm:
            self.s.update(b['id'], {'status': 'InProgress'})
        self.assertIn(a['id'], str(cm.exception))

    def test_a_project_s_settings_are_edited_from_its_card(self):
        f = self.s.update(self.hb['key'], {'execution_mode': 'serial', 'repo': ' ~/github/hb ', 'managed_by': '~/github/hb/.claude',
                                           'support_due_days': {'C1': '1', 'C2': 3, 'C3': ''}})['fields']
        self.assertEqual((f['execution_mode'], f['repo'], f['managed_by']), ('serial', '~/github/hb', '~/github/hb/.claude'))
        self.assertEqual(f['support_due_days'], {'C1': 1, 'C2': 3, 'C3': 30})  # numbers; a blank one is its default
        for bad in ({'execution_mode': 'fast'}, {'enabled_types': ['task']}, {'support_due_days': {'C2': 'soon'}},
                    {'support_due_days': {'C2': -1}}, {'support_due_days': {'C9': 1}}):
            with self.subTest(bad), self.assertRaises(StoreError):
                self.s.update(self.hb['key'], bad)

    def test_a_new_project_keeps_what_the_create_form_filled_in(self):
        p = self.s.create('project', 'Ops', {
            'project_key': 'OPS', 'project_kind': 'product', 'execution_mode': 'serial', 'enabled_types': ['prd'],
            'support_due_days': {'C1': '1', 'C2': '', 'C3': 10}, 'repo': ' ~/github/ops ', 'managed_by': '~/github/ops/.claude',
            'session_name': 'ops-main', 'labels': ['infra'], 'url': 'ops.example.com', 'url_label': 'Wiki'})
        f = p['fields']
        self.assertEqual((f['project_key'], f['project_kind'], f['execution_mode'], f['repo'], f['managed_by']),
                         ('OPS', 'product', 'serial', '~/github/ops', '~/github/ops/.claude'))
        self.assertEqual(f['support_due_days'], {'C1': 1, 'C2': 7, 'C3': 10})  # a blank one is its default
        self.assertEqual(f['enabled_types'], ['initiative', 'story', 'support', 'spec', 'prd'])  # the ones it names, not its kind's
        self.assertEqual((f['session_name'], f['labels']), ('ops-main', ['infra']))
        self.assertEqual((f['url'], f['url_label']), ('https://ops.example.com', 'Wiki'))
        self.assertTrue(os.path.isdir(os.path.join(self.root, 'Ops', 'PRDs')))  # its folders follow its types
        self.assertFalse(os.path.exists(os.path.join(self.root, 'Ops', 'Hotfixes')))
        self.assertTrue(self.s.check()['ok'], self.s.check())
        with self.assertRaises(StoreError):  # checked as an edit of its settings is
            self.s.create('project', 'Bad', {'project_key': 'BAD', 'execution_mode': 'fast'})
        self.assertFalse(os.path.exists(os.path.join(self.root, 'Bad')))  # refused before anything is written

    def test_claude_starts_in_the_project_s_local_path(self):
        repo = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(os.rmdir, repo)
        self.s.update(self.hb['key'], {'local_path': repo})
        ini = self.s.create('initiative', 'Curación', {'project': 'HB'})
        task = self.s.create('task', 'Revisar', {'project': 'HB', 'related_to': ini['key']})
        loose = self.s.create('task', 'Suelta', {})
        self.assertEqual(self.s.claude_cwd(ini['key']), {'path': repo, 'source': 'parent', 'from_id': self.hb['id']})
        self.assertEqual(self.s.claude_cwd(task['key'])['path'], repo)  # through its initiative, then the project
        self.assertEqual(self.s.claude_cwd(self.hb['key'])['source'], 'item')
        self.assertEqual(self.s.claude_cwd(loose['key'])['source'], 'home')  # no project: nothing to inherit
        self.assertEqual(self.s.claude_cwd(self.s.create('support', 'Otro', {'project': 'ECD'})['key'])['source'], 'home')

    def test_turning_a_type_on_gives_the_project_its_folder(self):
        p = self.s.create('project', 'Lean Shop', {'project_key': 'LS', 'project_kind': 'product', 'enabled_types': []})
        hotfixes = os.path.join(self.root, 'Lean Shop', 'Hotfixes')
        self.assertFalse(os.path.exists(hotfixes))  # a product made with its optional types off
        with self.assertRaises(StoreError):  # off: none of its tickets
            self.s.create('hotfix', 'Caída', {'project': 'LS'})
        f = self.s.update(p['key'], {'enabled_types': ['hotfix']})['fields']
        self.assertEqual(f['enabled_types'], ['initiative', 'story', 'support', 'spec', 'hotfix'])  # the core ones stay, in order
        self.assertTrue(os.path.isdir(hotfixes))
        self.assertTrue(self.s.check()['ok'], self.s.check())
        sup = self.s.create('support', 'Rota', {'project': 'LS'})
        self.s.create('hotfix', 'Caída', {'project': 'LS', 'related_to': sup['id']})  # its tickets can be made now
        f = self.s.update(p['key'], {'enabled_types': []})['fields']  # turned off: the folder and its tickets stay
        self.assertEqual(f['enabled_types'], ['initiative', 'story', 'support', 'spec'])
        self.assertTrue(os.path.isdir(hotfixes))
        self.assertEqual(len([i for i in self.s.items() if i['type'] == 'hotfix' and i['fields'].get('project') == 'LS']), 1)


class StoryTest(TicketingBase):
    """Stories deliver an initiative: it starts with the first, closes with the last, and a serial project counts them."""

    def ready_initiative(self, project='ECD', stories=1):
        ini = self.s.create('initiative', 'Checkout', {'project': project})
        made = [self.s.create('story', f'Story {n}', {'project': project, 'related_to': ini['id'], **READY}, READY_BODY)
                for n in range(stories)]
        self.s.update(ini['id'], {'premise': 'verified', 'premise_verified': f'{date.today().isoformat()} @ abc123', 'status': 'ToDo'})
        return ini, made

    def status(self, key):
        return self.s.read(key)['fields']['status']

    def test_a_plan_is_made_under_its_item_and_moved_never_let_go_the_rest_may_hang_from_nothing(self):
        ini, (story,) = self.ready_initiative()
        sup = self.s.create('support', 'Broken', {'project': 'ECD'})
        with self.assertRaises(StoreError) as cm:
            self.s.create('plan', 'Loose', {'project': 'ECD'})
        self.assertEqual(cm.exception.status, 400)
        self.assertIn('hangs from an initiative, a story or a support', str(cm.exception))
        for kind in ('story', 'prd', 'hotfix'):  # in their project, hanging from nothing
            loose = self.s.create(kind, 'Loose', {'project': 'ECD'})
            self.assertEqual((loose['fields']['project'], loose['fields']['related_to']), ('ECD', None), kind)
        fix = self.s.create('hotfix', 'Patch', {'project': 'ECD', 'related_to': sup['id']})
        plan = self.s.create('plan', 'Steps', {'related_to': story['id']})
        for key in (story['id'], fix['id']):  # let go of what it hangs from: it stays in its project
            now = self.s.update(key, {'related_to': None})
            self.assertEqual((now['fields']['related_to'], now['fields']['project']), (None, 'ECD'))
        with self.assertRaises(StoreError) as cm:
            self.s.update(plan['key'], {'related_to': None})
        self.assertIn('pick another one instead of none', str(cm.exception))
        other = self.s.create('initiative', 'Payments', {'project': 'ECD'})
        self.assertEqual(self.s.update(story['id'], {'related_to': other['id']})['fields']['related_to'], other['id'])
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_a_story_is_a_file_of_its_project_linked_to_its_initiative(self):
        ini, (story,) = self.ready_initiative()
        self.assertEqual((story['id'], story['fields']['related_to']), ('ECD-STY-001', ini['id']))
        text = read(self.root, story['path'])
        self.assertTrue(story['path'].startswith('Acme Web/Stories/ECD-STY-001 '), story['path'])
        self.assertIn('initiative: "[[ECD-INI-001 Checkout]]"', text)
        self.assertIn('## Acceptance criteria', text)
        self.assertNotIn('kind:', read(self.root, ini['path']))  # no more umbrella / slice

    def test_a_story_is_ready_with_its_initiative_approved_a_scenario_and_its_spec_impact(self):
        ini = self.s.create('initiative', 'Checkout', {'project': 'ECD'})
        story = self.s.create('story', 'Pay', {'project': 'ECD', 'related_to': ini['id']})  # the template, untouched
        with self.assertRaises(StoreError) as cm:
            self.s.update(story['id'], {'status': 'ToDo'})
        for missing in ('initiative approved (ECD-INI-001 is in Backlog)', 'a written acceptance scenario', 'its spec impact'):
            self.assertIn(missing, str(cm.exception))
        self.s.update(ini['id'], {'premise': 'verified', 'premise_verified': f'{date.today().isoformat()} @ abc123', 'status': 'ToDo'})
        self.s.update(story['id'], {'spec_impact': 'none: a test'}, body=READY_BODY.replace('the cart goes to checkout', '…'))
        with self.assertRaises(StoreError) as cm:
            self.s.update(story['id'], {'status': 'ToDo'})
        self.assertIn('a written acceptance scenario', str(cm.exception))  # "- **WHEN** …" is the template's, not one written
        self.s.update(story['id'], {}, body=READY_BODY)
        self.assertEqual(self.s.update(story['id'], {'status': 'ToDo'})['fields']['status'], 'ToDo')
        loose = self.s.create('story', 'Loose', {'project': 'ECD', **READY}, READY_BODY)  # made with no initiative…
        with self.assertRaises(StoreError) as cm:  # …it is ready only once it has one
            self.s.update(loose['id'], {'status': 'ToDo'})
        self.assertIn('only with its initiative', str(cm.exception))

    def test_the_initiative_follows_its_stories(self):
        ini, (a, b) = self.ready_initiative(stories=2)
        self.s.update(a['id'], {'status': 'ToDo'})
        self.s.update(a['id'], {'status': 'InProgress'})
        self.assertEqual(self.status(ini['id']), 'InProgress')  # the first story started it
        with self.assertRaises(StoreError) as cm:
            self.s.update(ini['id'], {'status': 'Review'})
        self.assertIn(a['id'], str(cm.exception))  # not by hand while a story is open
        for st in ('Review', 'Done'):
            self.s.update(a['id'], {'status': st})
        self.assertEqual(self.status(ini['id']), 'InProgress')  # b is still open
        self.s.update(b['id'], {'status': 'Discarded', 'discard_reason': 'not needed after a'})
        self.assertEqual(self.status(ini['id']), 'Done')  # the last one closed, and one was done
        log = fm.parse(fm.split(read(self.root, self.s.read(ini['id'])['path']))[0])['status_log']
        self.assertEqual([(e['to'], e['by']) for e in log[-2:]], [('4. InProgress', 'rule'), ('6. Done', 'rule')])

    def test_every_story_discarded_leaves_the_initiative_to_its_owner(self):
        ini, (a,) = self.ready_initiative()
        self.s.update(a['id'], {'status': 'Discarded', 'discard_reason': 'wrong idea'})
        self.assertEqual(self.status(ini['id']), 'ToDo')

    def test_a_serial_project_counts_stories_not_the_initiative(self):
        note = os.path.join(self.root, self.ecd['path'])
        with open(note, encoding='utf-8') as f:
            text = f.read()
        with open(note, 'w', encoding='utf-8') as f:
            f.write(fm.patch(text, {'execution_mode': 'serial'}))
        ini, (a, b) = self.ready_initiative(stories=2)
        for story in (a, b):
            self.s.update(story['id'], {'status': 'ToDo'})
        self.s.update(a['id'], {'status': 'InProgress'})  # its initiative goes InProgress too, and is not "busy"
        with self.assertRaises(StoreError) as cm:
            self.s.update(b['id'], {'status': 'InProgress'})
        self.assertIn(a['id'], str(cm.exception))
        self.s.update(a['id'], {'status': 'Review'})
        self.s.update(b['id'], {'status': 'InProgress'})

    def test_a_project_without_a_stories_folder_still_checks(self):
        stories = os.path.join(self.root, 'Acme Web', 'Stories')
        self.assertTrue(os.path.isdir(stories))  # a new project has it
        os.rmdir(stories)  # one from before stories does not
        self.assertTrue(self.s.check()['ok'], self.s.check())
        self.ready_initiative()  # its first story makes it
        self.assertTrue(os.path.isdir(stories))

    def test_a_prd_s_old_umbrella_is_still_read_and_cleared_when_relinked(self):
        ini = self.s.create('initiative', 'Checkout', {'project': 'ECD'})
        write(self.root, 'Acme Web/PRDs/ECD-PRD-001 Old.md',
              '---\nfileClass: Ticket PRD\nid: "ECD-PRD-001"\nproject: "[[00 Acme Web]]"\nstatus_ticket: "1. Backlog"\n'
              'umbrella: "[[ECD-INI-001 Checkout]]"\n---\n\n# Old\n')
        self.assertEqual(self.s.read('ECD-PRD-001')['fields']['related_to'], ini['id'])
        other = self.s.create('initiative', 'Payments', {'project': 'ECD'})
        self.s.update('ECD-PRD-001', {'related_to': other['id']})
        raw = fm.parse(fm.split(read(self.root, 'Acme Web/PRDs/ECD-PRD-001 Old.md'))[0])
        self.assertEqual(raw['umbrella'], '')
        self.assertIn(other['id'], raw['initiative'])
        self.assertEqual(self.s.read('ECD-PRD-001')['fields']['related_to'], other['id'])
        loose = self.s.update('ECD-PRD-001', {'related_to': None})  # let go: in its project, hanging from nothing
        self.assertEqual((loose['fields']['related_to'], loose['fields']['project'], loose['path']),
                         (None, 'ECD', 'Acme Web/PRDs/ECD-PRD-001 Old.md'))
        self.assertEqual(fm.parse(fm.split(read(self.root, loose['path']))[0])['initiative'], '')


VALID_SPEC = ('## Purpose\n\nPay.\n\n## Requirements\n\n### Requirement: Cart is kept\nThe system SHALL keep the cart.\n\n'
              '#### Scenario: Leaving\n- **WHEN** the shopper leaves before paying\n- **THEN** the cart is there on return\n')


class SpecTest(TicketingBase):
    """A spec is a ticket of its project with statuses of its own, active only with valid requirements."""

    def test_a_spec_is_a_file_of_its_project_with_its_own_statuses(self):
        spec = self.s.create('spec', 'Checkout', {'project': 'ECD', 'capability': 'checkout'})
        self.assertEqual((spec['id'], spec['fields']['status']), ('ECD-SPEC-001', 'draft'))
        self.assertTrue(spec['path'].startswith('Acme Web/Specs/ECD-SPEC-001 '), spec['path'])
        raw = fm.parse(fm.split(read(self.root, spec['path']))[0])
        self.assertEqual((raw['status_spec'], raw['capability']), ('draft', 'checkout'))  # not "1. Backlog"

    def test_it_is_active_only_with_valid_requirements(self):
        spec = self.s.create('spec', 'Checkout', {'project': 'ECD'})  # the template's placeholders
        with self.assertRaises(StoreError) as cm:
            self.s.update(spec['id'], {'status': 'active'})
        self.assertIn('valid requirements', str(cm.exception))
        self.s.update(spec['id'], {}, body=VALID_SPEC)
        self.assertEqual(self.s.update(spec['id'], {'status': 'active'})['fields']['status'], 'active')
        self.assertEqual(self.s.update(spec['id'], {'status': 'retired'})['fields']['completed_at'] is not None, True)

    def test_a_story_s_ship_writes_its_sync_and_its_stories(self):
        ini = self.s.create('initiative', 'Checkout', {'project': 'ECD'})
        story = self.s.create('story', 'Pay', {'project': 'ECD', 'related_to': ini['id']})
        spec = self.s.create('spec', 'Checkout', {'project': 'ECD'}, VALID_SPEC)
        out = self.s.update(spec['id'], {'stories': [story['id']], 'synced_sha': 'abc1234', 'synced_date': '2026-10-20'})['fields']
        self.assertEqual((out['stories'], out['synced_sha']), ([story['id']], 'abc1234'))
        self.assertIn('stories: ["[[ECD-STY-001 Pay]]"]', read(self.root, spec['path']))

    def test_a_project_without_a_specs_folder_still_checks(self):
        os.rmdir(os.path.join(self.root, 'Acme Web', 'Specs'))
        self.assertTrue(self.s.check()['ok'], self.s.check())


class SpecTextTest(unittest.TestCase):
    """specs.problems: what keeps a spec's text from being valid."""

    def test_a_valid_spec_has_no_problems(self):
        self.assertEqual(specs.problems(VALID_SPEC), [])

    def test_what_is_missing_is_named(self):
        self.assertEqual(specs.problems('## Purpose\n'), ['no "## Requirements" section'])
        self.assertEqual(specs.problems('## Requirements\n\nNothing yet.\n'), ['no requirement under "## Requirements"'])
        wrong = specs.problems('## Requirements\n### Requirement: Kept\nThe cart is kept.\n'
                               '#### Scenario: Leaving\n- **WHEN** …\n- **THEN** it is there\n'
                               '### Requirement: Paid\nThe system MUST charge once.\n## Notes\n#### Scenario: not here\n')
        self.assertEqual(wrong, ['scenario "Leaving" of "Kept" has no written WHEN', 'requirement "Kept" says no SHALL or MUST',
                                 'requirement "Paid" has no scenario'])  # the scenario under ## Notes is not the spec's


class StructureTest(unittest.TestCase):
    def test_every_structure_answers_its_public_part(self):
        # What GET /api/structure sends: it must serialize (an error's own statuses once made it a 400).
        import json
        from tm.structures import REGISTRY
        for sid, s in REGISTRY.items():
            with self.subTest(sid):
                out = json.loads(json.dumps(s.public()))
                self.assertEqual(out['id'], sid)
        err = next(t for t in REGISTRY['ticketing'].public()['types'] if t['name'] == 'error')
        self.assertEqual((err['statuses'], err['closed']), (['open', 'mitigated', 'resolved'], ['resolved']))

    def test_lists_group_by_project_and_by_the_initiative_they_can_reach(self):
        from tm.structures import REGISTRY
        types = {t['name']: t for t in REGISTRY['ticketing'].public()['types']}

        def reaches_initiative(name, seen=()):
            # Up what it may hang from: a note → a task → an initiative. An initiative's own parent is its umbrella.
            return any(p == 'initiative' or (p not in seen and reaches_initiative(p, (*seen, name)))
                       for p in types[name]['parents'])
        for name, t in types.items():
            if not t['list'] or 'project' not in t['list']['columns']:
                continue
            with self.subTest(name):
                groups = t['list'].get('group_by', [])
                self.assertIn('project', groups)
                self.assertEqual('initiative' in groups, name != 'initiative' and reaches_initiative(name))


    def test_the_activity_list_leads_with_where_it_came_from_and_its_priority(self):
        from tm.structures import REGISTRY
        for sid, columns in {
            'ticketing': ['id', 'subject', 'source', 'from', 'priority', 'labels', 'date', 'time', 'related:Parent', 'project',
                          'initiative', 'resolved', 'updated', 'created'],
            'folders': ['id', 'subject', 'source', 'from', 'priority', 'labels', 'date', 'time', 'parent:Parent', 'resolved',
                       'updated', 'created'],
        }.items():
            with self.subTest(sid):
                types = {t['name']: t for t in REGISTRY[sid].public()['types']}
                act = types['activity']
                self.assertEqual(act['list']['columns'], columns)
                self.assertTrue({'priority', 'priority_reason', 'date', 'time'} <= set(act['fields']))
                meeting = types['meeting']['list']['columns']  # a meeting's time, right after its date
                self.assertEqual(meeting[meeting.index('date') + 1], 'time')
                self.assertFalse(act['plannable'])


class ActivityPriorityTest(TicketingBase):
    def test_an_activity_takes_a_priority_and_its_reason_in_its_file(self):
        a = self.s.create('activity', 'Mail from Ana', {'source': 'Slack', 'from': ['Ana']})
        self.assertEqual(a['fields']['priority'], 'P2')  # the structure's default
        f = self.s.update(a['key'], {'priority': 'P0', 'priority_reason': ' the client waits '})['fields']
        self.assertEqual((f['priority'], f['priority_reason']), ('P0', 'the client waits'))
        text = read(self.root, self.s.read(a['key'])['path'])
        self.assertIn('priority: P0', text)
        self.assertIn('priority_reason: "the client waits"', text)
        self.assertLess(text.index('from:'), text.index('priority:'))  # the template's place: right after who sent it
        with self.assertRaises(StoreError):
            self.s.update(a['key'], {'priority': 'Urgent'})


class WikilinksTest(unittest.TestCase):
    def test_targets_and_rewrites(self):
        self.assertEqual(wikilinks.target('[[HB-SUP-1 X|alias]]'), 'HB-SUP-1 X')
        self.assertEqual(wikilinks.target('"[[HB-SUP-1 X#h]]"'.strip('"')), 'HB-SUP-1 X')
        self.assertIsNone(wikilinks.target('direct'))
        text = '[[A]] [[A|x]] [[A#h]] [[A B]] [[AB]]'
        self.assertEqual(wikilinks.rewrite(text, 'A', 'Z'), '[[Z]] [[Z|x]] [[Z#h]] [[A B]] [[AB]]')


class FavouritesTest(TicketingBase):
    def test_a_new_initiative_says_it_is_not_a_favourite(self):
        # The codec writes only the keys it is given; a file without `sidebar` would read as a favourite
        ini = self.s.create('initiative', 'New one', {'project': 'HB'})
        with open(os.path.join(self.root, ini['path']), encoding='utf-8') as f:
            self.assertIn('\nsidebar: false\n', f.read())
        self.assertIs(self.s.read(ini['path'])['fields']['sidebar'], False)
        starred = self.s.create('initiative', 'Starred', {'project': 'HB', 'sidebar': True})
        self.assertIs(starred['fields']['sidebar'], True)


class ProjectStatusTest(TicketingBase):
    """A Projects project is the same container a Tasks project is: the shared project statuses, Planned · Start · Due,
    related to equals. Its status is `status_project`, the format's key, written as it is."""

    def test_a_project_takes_the_project_statuses_under_status_project(self):
        from tm.structures.traits import PROJECT_STATUSES
        self.assertEqual(tuple(self.s.structure.statuses_of('project')), PROJECT_STATUSES)
        before = read(self.root, self.ecd['path'])
        out = self.s.update(self.ecd['id'], {'status': 'InProgress', 'start': '2026-11-09', 'due': '2026-12-31'})
        after = read(self.root, out['path'])
        self.assertIn('\nstatus_project: InProgress', after)
        self.assertIn('\nstart: 2026-11-09', after)
        self.assertEqual(self.changed_keys(before, after) - {'updated_date'}, {'status_project', 'status_log', 'start', 'due'})  # status_log: the format's record of each move
        self.assertEqual(self.s.read(self.ecd['id'])['fields']['status'], 'InProgress')
        with self.assertRaises(StoreError):
            self.s.update(self.ecd['id'], {'status': 'Review'})  # a work item's, not a project's

    def test_a_project_can_be_related_and_planned(self):
        fields = self.s.structure.allowed_fields('project')
        self.assertIn('relations', fields)
        self.assertLessEqual({'plan_week', 'start', 'due'}, fields)
        self.assertTrue(self.s.structure.types['project'].plannable)
        out = self.s.update(self.ecd['id'], {'plan_week': '2026-W46'})
        self.assertEqual(self.s.read(out['id'])['fields']['plan_week'], '2026-W46')


class GoalTest(TicketingBase):
    """A goal (Goals/ at the vault's root) crosses projects: it hangs from nothing, has the basic statuses, closed by hand,
    and a plain-text description. A project, an initiative, a story or a task names it in its own `goal:`."""

    def test_a_goal_lives_at_the_root_with_its_own_statuses_and_description(self):
        self.assertEqual(tuple(self.s.structure.statuses_of('goal')), ('ToDo', 'InProgress', 'Done', 'Discarded'))
        goal = self.s.create('goal', 'Launch the new checkout', {'description': 'Pay on one page.\nDrop-off under 40%.', 'priority': 'P1'})
        self.assertEqual(goal['path'], f"Goals/{goal['ref']} Launch the new checkout.md")
        self.assertTrue(goal['ref'].startswith('GOL-'))
        text = read(self.root, goal['path'])
        self.assertIn('\nfileClass: Ticket Goal', text)
        self.assertIn("\nstatus_goal: ToDo", text)
        self.assertNotIn('project:', text)
        self.assertEqual(self.s.read(goal['key'])['fields']['description'], 'Pay on one page.\nDrop-off under 40%.')
        before = text
        out = self.s.update(goal['key'], {'status': 'Done'})
        self.assertEqual(self.changed_keys(before, read(self.root, out['path'])) - {'updated_date'}, {'status_goal', 'status_log'})
        self.assertTrue(out['fields']['completed_at'])
        with self.assertRaises(StoreError):
            self.s.update(goal['key'], {'status': 'Review'})  # a ticket's, not a goal's
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_an_item_joins_a_goal_with_only_its_goal_keys_written(self):
        goal = self.s.create('goal', 'Ship faster', {})
        task = self.s.create('task', 'Cache the deps', {'project': 'HB'})
        before = read(self.root, task['path'])
        out = self.s.update(task['key'], {'goal': goal['key'], 'goal_order': 1})
        after = read(self.root, out['path'])
        self.assertIn(f'\ngoal: "[[{goal["ref"]} Ship faster]]"', after)  # a wikilink, as every link of the format
        self.assertEqual(self.changed_keys(before, after) - {'updated_date'}, {'goal', 'goal_order'})
        self.assertEqual((out['fields']['goal'], out['fields']['goal_order']), (goal['key'], 1))
        before = read(self.root, self.ecd['path'])
        out = self.s.update(self.ecd['id'], {'goal': goal['key'], 'goal_order': 2})  # a project too
        self.assertEqual(self.changed_keys(before, read(self.root, out['path'])) - {'updated_date'}, {'goal', 'goal_order'})
        with self.assertRaises(StoreError):
            self.s.update(task['key'], {'goal_order': 'first'})

    def test_deleting_a_goal_lets_its_items_go_and_a_restore_takes_them_back(self):
        goal = self.s.create('goal', 'Ship faster', {})
        ini = self.s.create('initiative', 'Faster deploys', {'project': 'HB', 'goal': goal['key'], 'goal_order': 2})
        task = self.s.create('task', 'Cache the deps', {'goal': goal['key'], 'goal_order': 1})
        out = self.s.delete(goal['key'])
        self.assertEqual(out['unlinked'], 2)
        for it in (ini, task):
            self.assertFalse(self.s.read(it['key'])['fields'].get('goal'), it['key'])
        self.s.restore_trashed(out['trashed'])
        self.assertEqual([(self.s.read(it['key'])['fields']['goal'], self.s.read(it['key'])['fields']['goal_order']) for it in (ini, task)],
                         [(goal['key'], 2), (goal['key'], 1)])


class RelationKindsTest(TicketingBase):
    """The relation kinds every structure has; here "Blocked by" is `depends_on`, which templates and devflow read."""

    def test_depends_on_is_blocked_by_seen_both_ways(self):
        ini = self.s.create('initiative', 'Pay', {'project': 'ECD'})
        a = self.s.create('story', 'One', {'project': 'ECD', 'related_to': ini['id']})
        b = self.s.create('story', 'Two', {'project': 'ECD', 'related_to': ini['id'], 'depends_on': [a['id']]})
        a, b = self.s.read(a['id']), self.s.read(b['id'])
        self.assertEqual((self.s.relation_kind(b, a), self.s.relation_kind(a, b)), ('blocked', 'blocks'))
        self.assertEqual([i['id'] for i in self.s.related_of(a)], [b['id']])
        self.assertIn(f"{b['id']} · Two — Blocks", self.s.claude_prompt(a['id']))

    def test_any_other_kind_is_kept_in_relation_kinds_and_only_that_key_is_written(self):
        sup = self.s.create('support', 'Broken', {'project': 'ECD'})
        hfx = self.s.create('hotfix', 'Patch', {'project': 'ECD', 'related_to': sup['id']})
        before = read(self.root, sup['path'])
        out = self.s.update(sup['id'], {'relations': [hfx['id']], 'relation_kinds': {hfx['id']: 'precedes'}})
        self.assertEqual(out['fields']['relation_kinds'], {hfx['id']: 'precedes'})
        self.assertEqual(self.changed_keys(before, read(self.root, out['path'])) - {'updated_date'}, {'relations', 'relation_kinds'})
        self.assertEqual(self.s.relation_kind(self.s.read(hfx['id']), self.s.read(sup['id'])), 'follows')

    def test_a_project_has_watchers_and_docs_written_only_once_used(self):
        path = os.path.join(self.root, self.ecd['path'])
        self.assertNotIn('watchers', read(self.root, self.ecd['path']))
        self.assertNotIn('\ndocs:', read(self.root, self.ecd['path']))
        before = read(self.root, self.ecd['path'])
        out = self.s.update(self.ecd['path'], {'watchers': ['Ana']})
        self.assertEqual(out['fields']['watchers'], ['Ana'])
        self.assertEqual(self.changed_keys(before, read(self.root, self.ecd['path'])) - {'updated_date'}, {'watchers'})
        self.assertTrue(os.path.exists(path))

    def test_a_project_is_known_by_its_key_for_its_work_log_and_relations(self):
        prj = self.s.read('ECD')  # its key, as an id; its item key is still its note's path
        self.assertEqual((prj['id'], prj['key']), ('ECD', self.ecd['path']))
        self.s.log_work('ECD', 'dev', 'Planning', '2026-11-07', time='01:00')
        days = self.s.scan()[1]
        self.assertEqual([e['id'] for e in days['2026-11-07'][1]['entries']], ['ECD'])
        sup = self.s.create('support', 'Broken', {'project': 'ECD'})
        self.s.update(sup['id'], {'relations': ['ECD'], 'relation_kinds': {'ECD': 'follows'}})
        self.assertIn('relations: ["[[00 Acme Web]]"]', read(self.root, sup['path']))  # a wikilink to its note, read back as its key
        self.assertEqual(self.s.read(sup['id'])['fields']['relations'], ['ECD'])
        self.assertEqual(self.s.relation_kind(self.s.read('ECD'), self.s.read(sup['id'])), 'precedes')
        self.assertEqual([i['id'] for i in self.s.related_of(self.s.read('ECD'))], [sup['id']])
        self.assertTrue(self.s.check()['ok'])


if __name__ == '__main__':
    unittest.main()


class WatchersTicketingTest(TicketingBase):
    """TSK-051 in Ticketing: an initiative's and a task's `watchers`, written as a list of names, the rest of the file kept."""

    def test_watchers_round_trip_and_touch_only_their_key(self):
        for t in ('initiative', 'story', 'task'):
            self.assertIn('watchers', self.s.structure.allowed_fields(t), t)
        task = self.s.create('task', 'Revisar', {'project': 'HB'})
        path = os.path.join(self.root, task['path'])
        with open(path, encoding='utf-8') as f:
            before = f.read()
        self.s.update(task['key'], {'watchers': ['Ana', 'Ops']})
        with open(path, encoding='utf-8') as f:
            after = f.read()
        self.assertEqual(self.s.read(task['key'])['fields']['watchers'], ['Ana', 'Ops'])
        self.assertEqual(self.changed_keys(before, after) - {'updated_date'}, {'watchers'})


class PlanOrderTicketingTest(TicketingBase):
    """TSK-053 in Ticketing: `plan_order` is written as a number and touches only its key."""

    def test_plan_order_round_trips_and_touches_only_its_key(self):
        task = self.s.create('task', 'Revisar', {'project': 'HB'})
        path = os.path.join(self.root, task['path'])
        with open(path, encoding='utf-8') as f:
            before = f.read()
        self.s.update(task['key'], {'plan_order': 20})
        with open(path, encoding='utf-8') as f:
            after = f.read()
        self.assertEqual(self.s.read(task['key'])['fields']['plan_order'], 20)
        self.assertEqual(self.changed_keys(before, after) - {'updated_date'}, {'plan_order'})

    def test_week_column_touches_only_its_keys(self):
        task = self.s.create('task', 'Planificar', {'project': 'HB', 'plan_week': '2026-W44'})
        path = os.path.join(self.root, task['path'])
        with open(path, encoding='utf-8') as f:
            before = f.read()
        self.s.update(task['key'], {'week_list': 'waiting', 'week_order': 10, 'plan_month': '2026-11'})
        with open(path, encoding='utf-8') as f:
            after = f.read()
        fields = self.s.read(task['key'])['fields']
        self.assertEqual((fields['week_list'], fields['week_order'], fields['plan_month']), ('waiting', 10, '2026-11'))
        self.assertEqual(self.changed_keys(before, after) - {'updated_date'}, {'week_list', 'week_order', 'plan_month'})
