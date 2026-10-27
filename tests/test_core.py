import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest

from tm import frontmatter as fm
from tm.launch import SESSION_RE, claude_flags, claude_script, resume_flags, session_flags
from tm.store import (ALLOWED_FIELDS, CLAUDE_DEFAULT_INSTRUCTION, CLAUDE_MAX_PROMPT, ITEM_TYPES, TYPE_FIELDS, Store,
                      StoreError)


class FrontmatterTest(unittest.TestCase):
    def test_round_trip_values(self):
        fields = {'id': 'TSK-0001', 'title': 'Fix: pricing #12', 'labels': ['a', 'b c'],
                  'order': 1.5, 'done': True, 'due': '2026-10-14', 'parent': None,
                  'created': '2026-10-14T10:22', 'num_title': '2026'}
        parsed = fm.parse(fm.split(fm.build(fields, 'body'))[0])
        self.assertEqual(parsed, fields)

    def test_tolerant_hand_written_yaml(self):
        text = "---\ntype: task\ntitle: 'It''s here'\ntags:\n  - x\n  - y\nflow: [a, b]\n---\nhi\n"
        f, body = fm.split(text)
        self.assertEqual(fm.parse(f), {'type': 'task', 'title': "It's here",
                                       'tags': ['x', 'y'], 'flow': ['a', 'b']})
        self.assertEqual(body, 'hi\n')

    def test_patch_keeps_unknown_lines(self):
        text = "---\ntype: task\n# a comment\ntags:\n  - x\ncustom: keep me\n---\n\nbody\n"
        out = fm.patch(text, {'tags': ['z'], 'new': 'v'})
        self.assertIn('# a comment', out)
        self.assertIn('custom: keep me', out)
        self.assertEqual(fm.parse(fm.split(out)[0])['tags'], ['z'])
        self.assertTrue(out.endswith('\nbody\n'))


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = Store(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_create_ids_and_relations(self):
        ini = self.s.create('initiative', 'Pricing revamp')
        t1 = self.s.create('task', 'Benchmark', {'related_to': ini['id']})
        t2 = self.s.create('task', 'Draft')
        self.assertEqual((ini['id'], t1['id'], t2['id']), ('INI-0001', 'TSK-0001', 'TSK-0002'))
        f = self.s.read('TSK-0001')['fields']
        self.assertEqual((f['related_to'], f['status'], f['priority'], f['archived']),
                         ('INI-0001', 'Backlog', 'Normal', False))
        self.assertTrue(f['created_at'] and f['updated_at'])
        self.assertNotIn('status', self.s.create('note', 'N')['fields'])

    def test_relation_rules_and_cycles(self):
        self.s.create('initiative', 'A')
        self.s.create('initiative', 'B', {})
        self.s.create('task', 'T')
        self.s.update('INI-0002', {'related_to': 'INI-0001'})      # sub-initiative ok
        with self.assertRaises(StoreError):
            self.s.update('INI-0001', {'related_to': 'INI-0002'})  # cycle
        with self.assertRaises(StoreError):
            self.s.update('TSK-0001', {'related_to': 'TSK-0001'})  # task under task
        with self.assertRaises(StoreError):
            self.s.update('TSK-0001', {'related_to': 'INI-9999'})  # missing

    def test_relations_link_equals_both_ways(self):
        self.s.create('initiative', 'A')
        self.s.create('task', 'T')
        self.s.create('note', 'N')
        t = self.s.update('TSK-0001', {'relations': ['INI-0001', 'NOTE-0001', 'INI-0001', ' ']})
        self.assertEqual(t['fields']['relations'], ['INI-0001', 'NOTE-0001'])  # each once, blanks out
        self.assertEqual(self.s.create('note', 'M')['fields']['relations'], [])
        # Kept on the task only, seen from both sides.
        ini = self.s.read('INI-0001')
        self.assertEqual(ini['fields']['relations'], [])
        self.assertEqual([r['id'] for r in self.s.related_of(ini)], ['TSK-0001'])
        self.assertEqual(sorted(r['id'] for r in self.s.related_of(self.s.read('TSK-0001'))), ['INI-0001', 'NOTE-0001'])
        self.assertIn('Related: TSK-0001 · T', self.s.claude_prompt('INI-0001'))

    def test_relation_targets_are_checked(self):
        self.s.create('task', 'T')
        self.s.create('inbox', 'Captured')
        self.s.create('prompt', 'P')
        for bad in (['TSK-0001'], ['INI-9999'], ['INB-0001'], ['PRM-0001']):  # itself, missing, an inbox item, a prompt
            with self.assertRaises(StoreError) as e:
                self.s.update('TSK-0001', {'relations': bad})
            self.assertEqual(e.exception.status, 400)
        with self.assertRaises(StoreError):
            self.s.update('INB-0001', {'relations': ['TSK-0001']})  # an inbox item relates to nothing
        self.assertEqual(self.s.update('TSK-0001', {'relations': []})['fields']['relations'], [])

    def test_a_relation_has_a_redmine_kind_seen_inverse_from_the_other_side(self):
        self.s.create('story', 'S')
        self.s.create('task', 'T')
        self.s.create('note', 'N')
        t = self.s.update('TSK-0001', {'relations': ['US-0001', 'NOTE-0001'], 'relation_kinds': {'US-0001': 'blocks', 'NOTE-0001': 'relates'}})
        self.assertEqual(t['fields']['relation_kinds'], {'US-0001': 'blocks'})  # `relates`, the default, is not kept
        story, task = self.s.read('US-0001'), self.s.read('TSK-0001')
        self.assertEqual((self.s.relation_kind(task, story), self.s.relation_kind(story, task)), ('blocks', 'blocked'))
        self.assertEqual(self.s.relation_kind(task, self.s.read('NOTE-0001')), 'relates')
        self.assertIn('TSK-0001 · T (Blocked by)', self.s.claude_prompt('US-0001'))
        # removing the relation takes its kind with it; a relation without one (from before) is `relates`
        self.assertEqual(self.s.update('TSK-0001', {'relations': ['NOTE-0001']})['fields']['relation_kinds'], {})
        self.assertEqual(self.s.relation_kind(self.s.read('US-0001'), self.s.read('TSK-0001')), 'relates')

    def test_a_relation_kind_is_checked(self):
        self.s.create('task', 'T')
        self.s.create('task', 'U')
        self.s.create('note', 'N')
        for bad in ({'TSK-0002': 'parent'}, {'NOTE-0001': 'blocks'}, ['TSK-0002']):  # no such kind; a note only relates; not a map
            with self.assertRaises(StoreError) as e:
                self.s.update('TSK-0001', {'relations': ['TSK-0002', 'NOTE-0001'], 'relation_kinds': bad})
            self.assertEqual(e.exception.status, 400)
        made = self.s.create('task', 'V', {'relations': ['TSK-0001', 'TSK-0002'], 'relation_kinds': {'TSK-0001': 'precedes', 'TSK-0009': 'blocks'}})
        self.assertEqual(made['fields']['relation_kinds'], {'TSK-0001': 'precedes'})  # only for what it relates to
        self.assertNotIn('relation_kinds', self.s.update('NOTE-0001', {'relation_kinds': {'TSK-0001': 'blocks'}})['fields'])

    def test_the_ticket_tracker_is_free_text(self):
        s = self.s.create('story', 'S', {'redmine_id': '4521', 'tracker': '  Story '})
        self.assertEqual(s['fields']['tracker'], 'Story')
        self.assertIsNone(self.s.update('US-0001', {'tracker': ''})['fields']['tracker'])
        self.assertNotIn('tracker', self.s.create('task', 'T', {'tracker': 'Epic'})['fields'])  # a task has no ticket
        self.s.update('US-0001', {'tracker': 'Epic'})
        self.assertIn('- Tracker: Epic', self.s.claude_prompt('US-0001'))

    def test_status_drives_completed_at_and_validation(self):
        self.s.create('task', 'T')
        self.assertTrue(self.s.update('TSK-0001', {'status': 'Done'})['fields']['completed_at'])
        self.assertIsNone(self.s.update('TSK-0001', {'status': 'Review'})['fields']['completed_at'])
        for bad in ({'status': 'Doing'}, {'priority': 'p1'}, {'url': 'not a url'}, {'links': ['ftp:x']}):
            with self.assertRaises(StoreError):
                self.s.update('TSK-0001', bad)

    def test_user_stories(self):
        self.s.create('initiative', 'I', {'redmine_id': '4521', 'redmine_url': 'https://redmine.example/issues/4521'})
        out = self.s.update('INI-0001', {'user_stories': [
            {'id': 'US-1', 'subject': 'Login', 'local_path': '~/specs/login', 'extra': 'dropped'},
            {'id': 'US-2', 'subject': 'Logout', 'status': 'Review', 'redmine_url': 'https://r.io/2'}]})
        self.assertEqual(out['fields']['user_stories'], [
            {'id': 'US-1', 'subject': 'Login', 'local_path': '~/specs/login', 'status': 'Backlog'},
            {'id': 'US-2', 'subject': 'Logout', 'redmine_url': 'https://r.io/2', 'status': 'Review'}])
        self.assertEqual(out['fields']['redmine_id'], '4521')
        for bad in ([{'id': 'US-1'}], [{'id': 'A', 'subject': 's'}, {'id': 'A', 'subject': 't'}],
                    [{'id': 'A', 'subject': 's', 'status': 'Nope'}]):
            with self.assertRaises(StoreError):
                self.s.update('INI-0001', {'user_stories': bad})

    def test_convert_inbox(self):
        self.s.create('initiative', 'I')
        inb = self.s.create('inbox', 'Call the bank', {'url': 'bank.es', 'labels': ['admin']}, 'ask about fees')
        self.assertEqual(inb['id'], 'INB-0001')
        self.assertEqual(inb['fields']['url'], 'https://bank.es')
        out = self.s.convert('INB-0001', 'task', {'related_to': 'INI-0001', 'priority': 'High'})
        self.assertEqual(out['id'], 'TSK-0001')
        self.assertEqual(out['fields']['converted_from'], 'INB-0001')
        self.assertEqual(out['fields']['related_to'], 'INI-0001')
        self.assertEqual(out['fields']['status'], 'Backlog')
        self.assertEqual(out['fields']['labels'], ['admin'])
        self.assertEqual(out['fields']['created_at'], inb['fields']['created_at'])
        self.assertEqual(out['body'].strip(), 'ask about fees')
        self.assertTrue(out['path'].startswith('tasks/'))
        with self.assertRaises(StoreError):
            self.s.find('INB-0001')  # the inbox file is gone
        with self.assertRaises(StoreError):
            self.s.convert('TSK-0001', 'note')  # only inbox items convert
        self.assertEqual(self.s.create('inbox', 'x')['id'], 'INB-0002')  # INB-0001 is not reused
        with self.assertRaises(StoreError):
            self.s.convert('INB-0002', 'inbox')
        with self.assertRaises(StoreError):
            self.s.update('INB-0002', {'related_to': 'INI-0001'})  # inbox items relate to nothing

    def test_priority_reason_is_free_text_on_the_types_with_a_priority(self):
        f = self.s.create('task', 'T', {'priority': 'High', 'priority_reason': '  blocks the release '})['fields']
        self.assertEqual(f['priority_reason'], 'blocks the release')
        self.assertIsNone(self.s.update('TSK-0001', {'priority_reason': '  '})['fields']['priority_reason'])
        for t in ('story', 'initiative'):
            self.assertEqual(self.s.create(t, 'X', {'priority_reason': 'client'})['fields']['priority_reason'], 'client')
        self.assertNotIn('priority_reason', self.s.create('note', 'N', {'priority_reason': 'x'})['fields'])

    def test_an_activity_has_a_priority_and_its_reason(self):
        f = self.s.create('activity', 'Mail from Ana', {'source': 'Email', 'from': ['Ana']})['fields']
        self.assertEqual((f['priority'], f['priority_reason']), ('Normal', None))  # the default, like a task's
        f = self.s.update('ACT-0001', {'priority': 'Urgent', 'priority_reason': '  the client waits '})['fields']
        self.assertEqual((f['priority'], f['priority_reason']), ('Urgent', 'the client waits'))
        self.assertNotIn('status', f)  # a priority, not a plan: an activity is still resolved, not closed
        with self.assertRaises(StoreError):
            self.s.update('ACT-0001', {'priority': 'P1'})

    def test_activity_resolution_and_session_name(self):
        self.s.create('task', 'T', {'session_name': '  pricing-fix '})
        self.assertEqual(self.s.read('TSK-0001')['fields']['session_name'], 'pricing-fix')
        self.s.create('note', 'N')
        act = self.s.create('activity', 'Re: invoice', {'source': 'Email', 'from': 'ana@x.io',
                                                        'url': 'mail.google.com/x', 'related_to': 'NOTE-0001'},
                            'Could you resend the invoice?')
        self.assertEqual(act['id'], 'ACT-0001')
        self.assertTrue(act['path'].startswith('activities/'))
        f = act['fields']
        self.assertEqual((f['source'], f['from'], f['url'], f['related_to']), ('Email', ['ana@x.io'], 'https://mail.google.com/x', 'NOTE-0001'))
        self.assertIsNone(f['resolution'])
        self.assertIsNone(f['resolved_at'])
        self.assertNotIn('status', f)
        out = self.s.update('ACT-0001', {'resolution': 'Sent it again.', 'resolved_at': 'hand-set'})
        self.assertEqual(out['fields']['resolution'], 'Sent it again.')
        self.assertTrue(out['fields']['resolved_at'] and out['fields']['resolved_at'] != 'hand-set')
        stamp = out['fields']['resolved_at']
        self.assertEqual(self.s.update('ACT-0001', {'resolution': 'Sent it twice.'})['fields']['resolved_at'], stamp)
        self.assertIsNone(self.s.update('ACT-0001', {'resolution': '  '})['fields']['resolved_at'])
        self.assertTrue(self.s.create('activity', 'Done already', {'resolution': 'nothing to do'})['fields']['resolved_at'])
        # an explicit action resolves or reopens without touching the text
        self.s.update('ACT-0001', {'resolution': 'Sent it again.'})
        stamp = self.s.update('ACT-0001', {'resolved': True})['fields']['resolved_at']
        self.assertTrue(stamp)
        reopened = self.s.update('ACT-0001', {'resolved': False})['fields']
        self.assertIsNone(reopened['resolved_at'])
        self.assertEqual(reopened['resolution'], 'Sent it again.')
        self.assertIsNone(self.s.update('ACT-0001', {'resolution': 'Sent it again, typo fixed.'})['fields']['resolved_at'])
        self.assertTrue(self.s.update('ACT-0001', {'resolved': True})['fields']['resolved_at'])
        self.assertNotIn('resolved', self.s.read('ACT-0001')['fields'])
        with self.assertRaises(StoreError):
            self.s.update('TSK-0001', {'resolved': True})
        with self.assertRaises(StoreError):
            self.s.update('ACT-0001', {'source': 'Pigeon'})
        with self.assertRaises(StoreError):
            self.s.create('task', 'Under an activity', {'related_to': 'ACT-0001'})
        inb = self.s.create('inbox', 'ping')
        self.assertEqual(self.s.convert(inb['id'], 'activity', {'source': 'Slack'})['fields']['source'], 'Slack')

    def test_pins(self):
        self.assertEqual(self.s.pins(), {'items': []})
        self.s.create('task', 'A')
        self.s.create('note', 'B')
        self.assertEqual(self.s.save_pins(['NOTE-0001', 'TSK-0001', 'NOTE-0001']), {'items': ['NOTE-0001', 'TSK-0001']})
        self.assertEqual(self.s.pins()['items'], ['NOTE-0001', 'TSK-0001'])
        self.assertTrue(os.path.exists(os.path.join(self.tmp.name, '.task-manager', 'pins.md')))
        for bad in ('x', [''], ['../etc'], [{'id': 'TSK-0001'}]):
            with self.assertRaises(StoreError):
                self.s.save_pins(bad)
        self.assertEqual(self.s.save_pins([]), {'items': []})

    def test_sidebar_order(self):
        self.assertEqual(self.s.sidebar_order(), {'items': []})
        self.s.create('initiative', 'A')
        self.s.create('initiative', 'B')
        self.assertEqual(self.s.save_sidebar_order(['INI-0002', 'INI-0001']), {'items': ['INI-0002', 'INI-0001']})
        self.assertEqual(self.s.sidebar_order()['items'], ['INI-0002', 'INI-0001'])
        self.assertTrue(os.path.exists(os.path.join(self.tmp.name, '.task-manager', 'sidebar.md')))
        self.assertEqual(self.s.pins(), {'items': []})  # a list of its own
        with self.assertRaises(StoreError):
            self.s.save_sidebar_order(['../etc'])

    def test_today_board(self):
        self.assertEqual(self.s.today_lists()['lists'], [{'id': 'uncategorized', 'name': 'Uncategorized'}])
        out = self.s.save_today_lists([{'id': 'morning', 'name': 'Morning'}, {'id': 'uncategorized', 'name': 'Later'}])
        self.assertEqual([l['id'] for l in out['lists']], ['morning', 'uncategorized'])
        out = self.s.save_today_lists([{'id': 'morning', 'name': 'Morning'}])  # default column cannot go away
        self.assertEqual([l['id'] for l in out['lists']], ['uncategorized', 'morning'])
        self.assertEqual(self.s.today_lists()['lists'], out['lists'])
        with self.assertRaises(StoreError):
            self.s.save_today_lists([{'id': 'a'}, {'id': 'a'}])
        self.s.create('task', 'T', {'plan_day': '2026-10-14', 'plan_week': '2026-W42'})
        it = self.s.update('TSK-0001', {'today_list': 'morning'})
        self.assertEqual(it['fields']['today_list'], 'morning')
        it = self.s.update('TSK-0001', {'priority': 'High'})  # unrelated edit keeps the column
        self.assertEqual(it['fields']['today_list'], 'morning')
        it = self.s.update('TSK-0001', {'plan_day': '2026-10-15'})  # a new day starts in Uncategorized
        self.assertIsNone(it['fields']['today_list'])

    def test_prioritization_board(self):
        self.assertEqual([l['id'] for l in self.s.prio_lists()['lists']], ['now', 'next', 'later'])
        out = self.s.save_prio_lists([{'id': 'next', 'name': 'Next'}, {'id': 'now', 'name': 'Right now'}])
        self.assertEqual(out['lists'], [{'id': 'next', 'name': 'Next'}, {'id': 'now', 'name': 'Right now'}])
        self.assertEqual(self.s.prio_lists(), out)
        self.assertTrue(os.path.exists(os.path.join(self.tmp.name, '.task-manager', 'prioritization.md')))
        self.assertEqual(self.s.save_prio_lists([])['lists'], [])  # no fixed column: every one can go
        self.assertEqual(self.s.prio_lists()['lists'], [])  # and the defaults do not come back
        for bad in ([{'id': 'a'}, {'id': 'a'}], [{'name': 'No id'}], 'now'):
            with self.assertRaises(StoreError):
                self.s.save_prio_lists(bad)
        for t in ('initiative', 'story', 'task'):
            self.assertIn('prio_list', self.s.structure.allowed_fields(t), t)
            self.assertIn('prio_order', self.s.structure.allowed_fields(t), t)
        self.s.create('task', 'T', {'plan_week': '2026-W42'})
        it = self.s.update('TSK-0001', {'prio_list': 'now', 'prio_order': 10})
        self.assertEqual((it['fields']['prio_list'], it['fields']['prio_order']), ('now', 10))
        it = self.s.update('TSK-0001', {'plan_day': '2026-10-20', 'plan_week': '2026-W43'})  # replanning keeps the column
        self.assertEqual(it['fields']['prio_list'], 'now')
        with self.assertRaises(StoreError):
            self.s.update('TSK-0001', {'prio_order': 'first'})
        it = self.s.update('TSK-0001', {'prio_list': None, 'prio_order': None})  # back to the pool
        self.assertIsNone(it['fields'].get('prio_list'))

    def test_comments(self):
        self.s.create('meeting', 'M')
        out = self.s.add_comment('MTG-0001', 'first')
        out = self.s.add_comment('MTG-0001', '  second  ')
        self.assertEqual([c['text'] for c in out['fields']['comments']], ['first', 'second'])
        self.assertTrue(all(c['at'] for c in out['fields']['comments']))
        with self.assertRaises(StoreError):
            self.s.add_comment('MTG-0001', '   ')
        out = self.s.delete_comment('MTG-0001', 0)
        self.assertEqual([c['text'] for c in out['fields']['comments']], ['second'])
        with self.assertRaises(StoreError):
            self.s.delete_comment('MTG-0001', 5)
        self.s.create('task', 'T')
        self.assertEqual(self.s.add_comment('TSK-0001', 'on a task')['fields']['comments'][0]['text'], 'on a task')

    def test_delete_and_restore(self):
        it = self.s.create('task', 'Gone')
        out = self.s.delete('TSK-0001')
        self.assertTrue(out['trashed'].startswith('.task-manager/trash/'))
        self.assertEqual(out['restore_to'], it['path'])
        with self.assertRaises(StoreError):
            self.s.find('TSK-0001')
        back = self.s.restore(out['trashed'], out['restore_to'])
        self.assertEqual(back['id'], 'TSK-0001')
        self.assertEqual(back['title'], 'Gone')
        with self.assertRaises(StoreError):
            self.s.restore('tasks/not-trash.md', 'tasks/x.md')
        with self.assertRaises(StoreError):
            self.s.restore(out['trashed'], out['restore_to'])  # already restored

    def test_delete_unlinks_what_was_related(self):
        self.s.create('initiative', 'Parent')
        self.s.create('task', 'Child', {'related_to': 'INI-0001'})
        self.s.create('note', 'Other child', {'related_to': 'INI-0001'})
        self.s.create('initiative', 'Elsewhere')
        before = self.s.read('TSK-0001')['fields']['updated_at']
        out = self.s.delete('INI-0001')
        self.assertEqual(out['unlinked'], 2)
        # nothing points at a deleted item any more, and updated_at is untouched
        self.assertIsNone(self.s.read('TSK-0001')['fields']['related_to'])
        self.assertIsNone(self.s.read('NOTE-0001')['fields']['related_to'])
        self.assertEqual(self.s.read('TSK-0001')['fields']['updated_at'], before)
        # relate one elsewhere meanwhile; restoring relinks only what is still free
        self.s.update('NOTE-0001', {'related_to': 'INI-0002'})
        self.s.restore(out['trashed'], out['restore_to'])
        self.assertEqual(self.s.read('TSK-0001')['fields']['related_to'], 'INI-0001')
        self.assertEqual(self.s.read('NOTE-0001')['fields']['related_to'], 'INI-0002')
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, out['trashed'] + '.meta.json')))
        # an item nobody hangs from reports nothing unlinked
        self.assertEqual(self.s.delete('INI-0002')['unlinked'], 1)
        self.assertEqual(self.s.delete('TSK-0001')['unlinked'], 0)

    def test_trash_lists_restores_and_purges(self):
        self.s.create('initiative', 'Parent')
        self.s.create('task', 'Child', {'related_to': 'INI-0001'})
        self.assertEqual(self.s.trash(), [])
        out = self.s.delete('INI-0001')
        (entry,) = self.s.trash()
        self.assertEqual((entry['id'], entry['type'], entry['title'], entry['unlinked']), ('INI-0001', 'initiative', 'Parent', 1))
        self.assertEqual(entry['original_path'], out['restore_to'])
        self.assertRegex(entry['deleted_at'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$')
        # restoring from the view puts it back where it was and relinks the child
        self.s.restore_trashed(entry['trashed'])
        self.assertEqual(self.s.trash(), [])
        self.assertEqual(self.s.read('TSK-0001')['fields']['related_to'], 'INI-0001')
        # purge deletes for good, with its sidecar; an unknown or outside path is refused
        out = self.s.delete('TSK-0001')
        self.s.purge(out['trashed'])
        self.assertEqual(self.s.trash(), [])
        self.assertEqual(os.listdir(os.path.join(self.tmp.name, '.task-manager', 'trash')), [])
        for bad in ('tasks/nothing.md', '../outside.md', 'initiatives/INI-0001-parent.md'):
            with self.assertRaises(StoreError):
                self.s.purge(bad)
        self.assertEqual(self.s.read('INI-0001')['title'], 'Parent')  # the live one is untouched

    def test_trash_empty_and_ids_are_never_reused(self):
        self.s.create('task', 'One')
        self.s.create('task', 'Two')
        self.s.delete('TSK-0002')
        # the id of the deleted task is not handed out again, so a restore can never collide
        self.assertEqual(self.s.create('task', 'Three')['id'], 'TSK-0003')
        self.s.restore_trashed(self.s.trash()[0]['trashed'])
        self.assertEqual(sorted(i['id'] for i in self.s.items() if i['type'] == 'task'), ['TSK-0001', 'TSK-0002', 'TSK-0003'])
        self.s.delete('TSK-0001')
        self.s.delete('TSK-0003')
        self.assertEqual(self.s.empty_trash(), {'purged': 2, 'attachments': 0, 'files': 0})
        self.assertEqual(self.s.trash(), [])

    def test_trash_reads_entries_without_a_meta_file(self):
        self.s.create('note', 'Old one')
        out = self.s.delete('NOTE-0001')
        trashed = os.path.join(self.tmp.name, out['trashed'])
        os.remove(trashed + '.meta.json')  # how an older delete left it: no sidecar
        (entry,) = self.s.trash()
        self.assertEqual(entry['original_path'], out['restore_to'])
        self.assertRegex(entry['deleted_at'], r'^\d{4}-')
        self.assertEqual(self.s.restore_trashed(entry['trashed'])['id'], 'NOTE-0001')

    def test_claude_prompt_carries_the_item(self):
        self.s.create('initiative', 'Pricing', {'local_path': self.tmp.name})
        self.s.create('story', 'Tiers', {'related_to': 'INI-0001', 'status': 'InProgress', 'priority': 'High', 'due': '2026-11-01',
                                          'redmine_id': '4521', 'url': 'https://e.io/a', 'labels': ['billing']}, 'Offer three tiers.\n\n- [ ] draft')
        text = self.s.claude_prompt('US-0001')
        for needle in ('# US-0001 · Tiers', '- Status: InProgress', '- Priority: High', '- Due: 2026-11-01', '- Related to: INI-0001 · Pricing',
                       '- Labels: billing', '- Ticket: #4521', 'https://e.io/a', 'Offer three tiers.', '- [ ] draft', CLAUDE_DEFAULT_INSTRUCTION):
            self.assertIn(needle, text)
        self.assertIn(f"- Item file: {self.s.abs(self.s.find('US-0001')['path'])}", text)
        self.assertTrue(self.s.claude_prompt('US-0001', 'Write the tests first').rstrip().endswith('Write the tests first'))
        self.assertNotIn(CLAUDE_DEFAULT_INSTRUCTION, self.s.claude_prompt('US-0001', 'Write the tests first'))

    def test_claude_prompt_is_capped(self):
        self.s.create('note', 'Huge', {}, 'x' * (CLAUDE_MAX_PROMPT * 2))
        text = self.s.claude_prompt('NOTE-0001')
        self.assertLessEqual(len(text.encode('utf-8')), CLAUDE_MAX_PROMPT)
        self.assertIn('the description was cut here', text)
        self.assertIn(CLAUDE_DEFAULT_INSTRUCTION, text)  # the instruction always survives the cut

    def test_claude_cwd_follows_the_relations(self):
        proj = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, proj, True)
        home = os.path.expanduser('~')
        self.s.create('initiative', 'Parent', {'local_path': proj})
        self.s.create('story', 'Mid', {'related_to': 'INI-0001'})
        self.s.create('task', 'Leaf', {'related_to': 'US-0001'})
        self.s.create('task', 'Loose')
        self.s.create('initiative', 'Bad path', {'local_path': '/no/such/folder'})
        self.assertEqual(self.s.claude_cwd('INI-0001'), {'path': proj, 'source': 'item', 'from_id': 'INI-0001'})
        self.assertEqual(self.s.claude_cwd('TSK-0001'), {'path': proj, 'source': 'parent', 'from_id': 'INI-0001'})
        self.assertEqual(self.s.claude_cwd('TSK-0002', proj), {'path': proj, 'source': 'settings', 'from_id': None})
        self.assertEqual(self.s.claude_cwd('TSK-0002'), {'path': home, 'source': 'home', 'from_id': None})
        self.assertEqual(self.s.claude_cwd('INI-0002', '/also/missing')['source'], 'home')  # a path that does not exist is never used

    def test_claude_flags_come_from_closed_lists(self):
        self.assertEqual(claude_flags(), [])
        self.assertEqual(claude_flags('opus', ''), ['--model', 'opus'])
        self.assertEqual(claude_flags('', 'xhigh'), ['--effort', 'xhigh'])
        self.assertEqual(claude_flags('sonnet', 'low'), ['--model', 'sonnet', '--effort', 'low'])
        for bad in (('gpt-5', ''), ('opus; rm -rf ~', ''), ('', 'extreme'), ('--dangerously-skip-permissions', '')):
            with self.assertRaises(ValueError):
                claude_flags(*bad)

    def test_claude_script_never_runs_what_the_item_says(self):
        if sys.platform == 'win32' or not shutil.which('zsh'):
            self.skipTest('needs zsh')
        nasty = 'quote \' and " and `touch HACKED` and $(touch HACKED2) and $HOME and \\ backslash\nsecond line\n'
        work = tempfile.mkdtemp(prefix='tm folder with spaces ')
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, work, True)
        self.addCleanup(shutil.rmtree, tmp, True)
        prompt = os.path.join(tmp, 'prompt.md')
        with open(prompt, 'w', encoding='utf-8') as f:
            f.write(nasty)
        script = os.path.join(tmp, 'run.command')
        out = os.path.join(work, 'received.txt')
        # the "claude" here writes its first argument to a file, so we can compare it byte for byte
        fake = os.path.join(work, 'fake claude.sh')  # outside tmp: the script deletes tmp before it starts claude
        with open(fake, 'w') as f:
            f.write(f'#!/bin/sh\nprintf %s "$3" > {out!r}\nprintf %s "$1 $2" > {out + ".flags"!r}\npwd > {out + ".cwd"!r}\n')
        os.chmod(fake, 0o700)
        with open(script, 'w', encoding='utf-8') as f:
            f.write(claude_script(work, prompt, tmp, f"'{fake}'", claude_flags('opus', 'high')[:2]))
        subprocess.run(['zsh', script], check=True, capture_output=True, timeout=20)
        with open(out, encoding='utf-8') as f:
            self.assertEqual(f.read(), nasty.rstrip('\n'))  # arrives intact (a trailing newline is what $(…) drops)
        with open(out + '.flags') as f:
            self.assertEqual(f.read(), '--model opus')  # the flags come before the prompt, as separate arguments
        with open(out + '.cwd') as f:
            self.assertEqual(os.path.realpath(f.read().strip()), os.path.realpath(work))
        for hacked in ('HACKED', 'HACKED2'):
            self.assertFalse(os.path.exists(os.path.join(work, hacked)))
        self.assertFalse(os.path.exists(prompt))  # the temp folder removed itself once the prompt was read

    def test_claude_script_resumes_without_a_prompt(self):
        if sys.platform == 'win32' or not shutil.which('zsh'):
            self.skipTest('needs zsh')
        work = tempfile.mkdtemp(prefix='tm folder with spaces ')
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, work, True)
        self.addCleanup(shutil.rmtree, tmp, True)
        out = os.path.join(work, 'received.txt')
        fake = os.path.join(work, 'fake claude.sh')
        with open(fake, 'w') as f:
            f.write(f'#!/bin/sh\nprintf %s "$#:$1 $2" > {out!r}\npwd > {out + ".cwd"!r}\n')
        os.chmod(fake, 0o700)
        sid = '0f1e2d3c-4b5a-4978-8a6b-5c4d3e2f1a0b'
        script = os.path.join(tmp, 'run.command')
        with open(script, 'w', encoding='utf-8') as f:
            f.write(claude_script(work, None, tmp, f"'{fake}'", resume_flags(sid)))
        subprocess.run(['zsh', script], check=True, capture_output=True, timeout=20)
        with open(out) as f:
            self.assertEqual(f.read(), f'2:--resume {sid}')  # exactly the two words: no empty prompt argument after them
        with open(out + '.cwd') as f:
            self.assertEqual(os.path.realpath(f.read().strip()), os.path.realpath(work))
        self.assertFalse(os.path.exists(tmp))  # the temp folder still removes itself

    def test_session_flags_are_an_id_and_a_short_name(self):
        sid = '0f1e2d3c-4b5a-4978-8a6b-5c4d3e2f1a0b'
        self.assertEqual(session_flags(sid), ['--session-id', sid])
        self.assertEqual(session_flags(sid, '  TSK-0001  ·\n Fix   it '), ['--session-id', sid, '--name', 'TSK-0001 · Fix it'])
        self.assertEqual(len(session_flags(sid, 'x' * 200)[3]), 60)
        self.assertEqual(resume_flags(sid), ['--resume', sid])
        for bad in ('', 'TSK-0001', sid.upper(), sid + '; rm -rf ~', '--dangerously-skip-permissions'):
            with self.assertRaises(ValueError):
                session_flags(bad)
            with self.assertRaises(ValueError):
                resume_flags(bad)

    def test_claude_sessions_are_kept_on_the_item(self):
        self.s.create('task', 'A')
        self.s.create('prompt', 'P')
        sid = '0F1E2D3C-4B5A-4978-8A6B-5C4D3E2F1A0B'
        entry = {'id': sid, 'cwd': '/tmp/work', 'instruction': 'First line that is long ' * 10 + '\nsecond line', 'model': 'opus', 'junk': 1}
        kept = self.s.add_claude_session('TSK-0001', entry)['fields']['claude_sessions']
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0]['id'], sid.lower())  # stored the way --resume wants it
        self.assertEqual(kept[0]['cwd'], '/tmp/work')
        self.assertEqual(kept[0]['model'], 'opus')
        self.assertNotIn('junk', kept[0])
        self.assertNotIn('effort', kept[0])  # empty flags are not written
        self.assertNotIn('second line', kept[0]['instruction'])
        self.assertLessEqual(len(kept[0]['instruction']), 120)
        self.assertRegex(kept[0]['at'], r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$')
        self.assertEqual(self.s.claude_session('TSK-0001', sid)['cwd'], '/tmp/work')  # the lookup a resume starts from
        with self.assertRaises(StoreError) as cm:
            self.s.claude_session('TSK-0001', '0f1e2d3c-4b5a-4978-8a6b-000000000000')
        self.assertEqual(cm.exception.status, 404)
        for bad in ({'id': 'TSK-0001', 'cwd': '/tmp'}, {'id': sid}, {'id': sid + '; rm -rf ~', 'cwd': '/tmp'}, 'text'):
            with self.assertRaises(StoreError):
                self.s.add_claude_session('TSK-0001', bad)
        with self.assertRaises(StoreError):
            self.s.add_claude_session('PRM-0001', {'id': sid, 'cwd': '/tmp'})  # a prompt keeps none; refused, not dropped
        with self.assertRaises(StoreError) as cm:
            self.s.forget_claude_session('TSK-0001', 3)
        self.assertEqual(cm.exception.status, 404)
        self.assertEqual(self.s.forget_claude_session('TSK-0001', 0)['fields']['claude_sessions'], [])
        # A new file carries no claude_sessions key until the first launch.
        with open(self.s.abs(self.s.find('PRM-0001')['path']), encoding='utf-8') as f:
            self.assertNotIn('claude_sessions', f.read())

    def test_global_claude_sessions_live_in_the_meta_folder(self):
        self.assertEqual(self.s.global_claude_sessions(), {'sessions': []})
        sid = '0f1e2d3c-4b5a-4978-8a6b-5c4d3e2f1a0b'
        kept = self.s.add_global_claude_session({'id': sid, 'cwd': self.tmp.name, 'instruction': 'Tidy the vault'})['sessions']
        self.assertEqual((kept[0]['id'], kept[0]['instruction']), (sid, 'Tidy the vault'))
        path = os.path.join(self.tmp.name, '.task-manager', 'claude-sessions.md')
        with open(path, encoding='utf-8') as f:
            text = f.read()
        self.assertIn('type: claude-sessions', text)
        self.assertIn(f'`{sid}`', text)  # the body is a readable list too
        self.assertEqual(Store(self.tmp.name).global_claude_sessions()['sessions'], kept)  # a fresh store reads it back
        self.assertEqual(self.s.claude_session(None, sid)['cwd'], self.tmp.name)
        with self.assertRaises(StoreError):
            self.s.forget_global_claude_session(1)
        self.assertEqual(self.s.forget_global_claude_session(0), {'sessions': []})

    def test_claude_cwd_without_an_item(self):
        self.assertEqual(self.s.claude_cwd(None, self.tmp.name), {'path': os.path.realpath(self.tmp.name), 'source': 'settings', 'from_id': None})
        self.assertEqual(self.s.claude_cwd(None, '')['source'], 'home')

    def test_prompt_is_an_item_active_until_archived(self):
        made = self.s.create('prompt', 'Review this PR', {'labels': ['review']}, 'Review the diff.\nList risks first.')
        self.assertEqual((made['id'], made['type']), ('PRM-0001', 'prompt'))
        self.assertEqual(made['path'].split('/')[0], 'prompts')
        got = self.s.read('PRM-0001')
        self.assertEqual((got['fields']['labels'], got['fields']['archived']), (['review'], False))
        self.assertNotIn('status', got['fields'])  # like a note: no status, just active or archived
        self.assertEqual(got['body'].strip(), 'Review the diff.\nList risks first.')
        self.assertTrue(got['fields']['created_at'] and got['fields']['updated_at'])
        # it relates to nothing and nothing hangs from it
        with self.assertRaises(StoreError):
            self.s.create('task', 'T', {'related_to': 'PRM-0001'})
        self.assertTrue(self.s.update('PRM-0001', {'archived': True})['fields']['archived'])
        # deleting goes to the trash like any item, and the id is not reused
        self.s.delete('PRM-0001')
        self.assertEqual(self.s.trash()[0]['type'], 'prompt')
        self.assertEqual(self.s.create('prompt', 'Another')['id'], 'PRM-0002')

    def test_transcription_hangs_from_a_meeting(self):
        self.s.create('meeting', 'Kickoff', {'date': '2026-10-15'})
        self.s.create('task', 'A task')
        made = self.s.create('transcription', 'Kickoff transcript', {'related_to': 'MTG-0001', 'labels': ['q4']}, 'Ana: hello\nLuis: hi')
        self.assertEqual((made['id'], made['type']), ('TRN-0001', 'transcription'))
        self.assertEqual(made['path'].split('/')[0], 'transcriptions')
        got = self.s.read('TRN-0001')
        self.assertEqual((got['fields']['related_to'], got['fields']['labels']), ('MTG-0001', ['q4']))
        self.assertEqual(got['body'].strip(), 'Ana: hello\nLuis: hi')
        self.assertNotIn('status', got['fields'])  # like a note
        for parent in ('TSK-0001', 'TRN-0001'):  # only a meeting can be transcribed
            with self.assertRaises(StoreError):
                self.s.create('transcription', 'Wrong parent', {'related_to': parent})
        # deleting the meeting detaches the transcription; restoring the meeting relinks it
        out = self.s.delete('MTG-0001')
        self.assertIsNone(self.s.read('TRN-0001')['fields']['related_to'])
        self.s.restore(out['trashed'], out['restore_to'])
        self.assertEqual(self.s.read('TRN-0001')['fields']['related_to'], 'MTG-0001')

    def test_links(self):
        self.s.create('task', 'T')
        out = self.s.update('TSK-0001', {'url': 'https://a.io', 'links': ['https://b.io', {'label': 'Figma', 'url': 'https://f.io'}]})
        self.assertEqual(out['fields']['links'], [{'url': 'https://b.io'}, {'label': 'Figma', 'url': 'https://f.io'}])
        out = self.s.update('TSK-0001', {'url': 'dominio.com', 'links': ['www.b.io/x?y=1', {'label': 'Dev', 'url': 'localhost:3000'}]})
        self.assertEqual(out['fields']['url'], 'https://dominio.com')
        self.assertEqual(out['fields']['links'], [{'url': 'https://www.b.io/x?y=1'}, {'label': 'Dev', 'url': 'https://localhost:3000'}])

    def test_people(self):
        # from / attendees are lists of people; blanks and repeats (any case) are dropped
        a = self.s.create('activity', 'Ping', {'from': [' Ana  Ruiz ', 'pablo', 'ana ruiz', '']})
        self.assertEqual(a['fields']['from'], ['Ana Ruiz', 'pablo'])
        m = self.s.create('meeting', 'Sync', {'attendees': 'Ana Ruiz, Luis , ,luis'})
        self.assertEqual(m['fields']['attendees'], ['Ana Ruiz', 'Luis'])
        self.assertIsNone(self.s.update('ACT-0001', {'from': []})['fields']['from'])
        self.assertEqual(self.s.update('MTG-0001', {'attendees': []})['fields']['attendees'], [])
        # the history keeps everyone ever named, even when nobody uses them any more, most used first
        names = [p['name'] for p in self.s.people()['people']]
        self.assertEqual(sorted(names), ['Ana Ruiz', 'Luis', 'pablo'])
        self.s.create('meeting', 'Again', {'attendees': ['Luis', 'Carla']})
        self.s.create('meeting', 'And again', {'attendees': ['luis']})
        people = self.s.people()['people']
        self.assertEqual((people[0]['name'], people[0]['count']), ('Luis', 2))  # the meeting that was emptied no longer counts
        self.s.delete('MTG-0002')
        self.s.delete('MTG-0003')
        self.assertIn('Carla', [p['name'] for p in self.s.people()['people']])  # deleted items do not erase the history
        # a legacy plain-text sender still counts as one person
        self.s.create('activity', 'Old', {})
        path = self.s.abs(self.s.read('ACT-0002')['path'])
        text = open(path, encoding='utf-8').read().replace('from:', 'from: legacy@x.io', 1)
        open(path, 'w', encoding='utf-8').write(text)
        self.assertIn('legacy@x.io', [p['name'] for p in self.s.people()['people']])

    def test_story_item(self):
        self.s.create('initiative', 'I')
        st = self.s.create('story', 'S', {'related_to': 'INI-0001', 'status': 'InProgress'})
        self.assertEqual(st['id'], 'US-0001')
        self.assertTrue(st['path'].startswith('stories/'))
        # tasks, notes and meetings can hang from a story; a story from an initiative or from nothing
        t = self.s.create('task', 'T', {'related_to': 'US-0001'})
        self.assertEqual(t['fields']['related_to'], 'US-0001')
        self.s.create('note', 'N', {'related_to': 'US-0001'})
        solo = self.s.create('story', 'Solo')
        self.assertIsNone(solo['fields']['related_to'])
        for parent in ('TSK-0001', 'US-0001'):
            with self.assertRaises(StoreError):
                self.s.update('US-0002', {'related_to': parent})
        with self.assertRaises(StoreError):
            self.s.update('INI-0001', {'related_to': 'US-0001'})  # an initiative cannot hang from a story
        # deleting the story leaves its tasks unrelated, not pointing at nothing
        self.s.delete('US-0001')
        self.assertIsNone(self.s.read('TSK-0001')['fields']['related_to'])
        # an inbox item can become a story
        self.s.create('inbox', 'Idea')
        self.assertEqual(self.s.convert('INB-0001', 'story')['id'], 'US-0003')

    def test_migrate_user_stories(self):
        self.s.create('initiative', 'I', {'user_stories': [
            {'id': 'US-1', 'subject': 'First', 'status': 'Review', 'redmine_url': 'redmine.example.com/issues/1'},
            {'id': 'US-2', 'subject': 'Second'}]})
        self.s.create('initiative', 'Other', {'user_stories': [{'id': 'US-1', 'subject': 'Same old id'}]})
        moved = self.s.migrate_user_stories()
        self.assertEqual([(m['initiative'], m['was']) for m in moved], [('INI-0001', 'US-1'), ('INI-0001', 'US-2'), ('INI-0002', 'US-1')])
        stories = sorted((i for i in self.s.items() if i['type'] == 'story'), key=lambda i: i['id'])
        self.assertEqual([x['id'] for x in stories], ['US-0001', 'US-0002', 'US-0003'])  # the old ids repeated; the new ones do not
        self.assertEqual(stories[0]['fields']['status'], 'Review')
        self.assertEqual(stories[0]['fields']['redmine_url'], 'https://redmine.example.com/issues/1')
        self.assertEqual([x['fields']['related_to'] for x in stories], ['INI-0001', 'INI-0001', 'INI-0002'])
        self.assertEqual(self.s.read('INI-0001')['fields']['user_stories'], [])
        self.assertTrue(os.listdir(os.path.join(self.tmp.name, '.task-manager', 'backup')))
        self.assertEqual(self.s.migrate_user_stories(), [])  # a second run changes nothing
        self.assertEqual(len([i for i in self.s.items() if i['type'] == 'story']), 3)

    def test_initiative_sidebar_flag(self):
        # A favourite once starred, never on its own (a file without the key, from before, still is: the page's rule)
        ini = self.s.create('initiative', 'Not a favourite yet')
        self.assertIs(ini['fields']['sidebar'], False)
        self.assertIs(self.s.update('INI-0001', {'sidebar': True})['fields']['sidebar'], True)
        self.assertIs(self.s.update('INI-0001', {'sidebar': False})['fields']['sidebar'], False)
        self.assertIs(self.s.create('initiative', 'Starred', {'sidebar': True})['fields']['sidebar'], True)

    def test_label_management(self):
        self.s.create('task', 'A', {'labels': ['urgent', 'api']})
        self.s.create('note', 'B', {'labels': ['api']})
        before = self.s.read('TSK-0001')['fields']['updated_at']
        names = {l['name']: l['count'] for l in self.s.labels()['labels']}
        self.assertEqual(names, {'urgent': 1, 'api': 2})
        self.assertEqual(self.s.labels()['labels'][0]['types'], {'task': 1, 'note': 1})
        # a label can exist before anything uses it, and a leading '#' is dropped
        self.assertEqual({l['name']: l['count'] for l in self.s.add_label('#idea')['labels']}['idea'], 0)
        with self.assertRaises(StoreError):
            self.s.add_label('  ')
        # rename reaches every item and keeps their updated_at
        self.s.rename_label('api', 'backend')
        self.assertEqual(self.s.read('TSK-0001')['fields']['labels'], ['urgent', 'backend'])
        self.assertEqual(self.s.read('NOTE-0001')['fields']['labels'], ['backend'])
        self.assertEqual(self.s.read('TSK-0001')['fields']['updated_at'], before)
        # renaming onto another label merges them
        self.s.rename_label('urgent', 'backend')
        self.assertEqual(self.s.read('TSK-0001')['fields']['labels'], ['backend'])
        self.assertEqual({l['name'] for l in self.s.labels()['labels']}, {'backend', 'idea'})
        # delete removes it from the items and the history
        self.s.delete_label('backend')
        self.assertEqual(self.s.read('TSK-0001')['fields']['labels'], [])
        self.assertEqual({l['name'] for l in self.s.labels()['labels']}, {'idea'})
        for bad in (lambda: self.s.rename_label('nope', 'x'), lambda: self.s.delete_label('nope'), lambda: self.s.rename_label('idea', ' ')):
            with self.assertRaises(StoreError):
                bad()

    def test_people_management(self):
        self.s.create('activity', 'Ping', {'from': ['Ana Ruiz', 'Pablo']})
        self.s.create('meeting', 'Sync', {'attendees': ['ana ruiz', 'Luis']})
        ana = [p for p in self.s.people()['people'] if p['name'].lower() == 'ana ruiz'][0]
        self.assertEqual((ana['count'], ana['sender'], ana['attendee']), (2, 1, 1))
        self.s.add_person('Carla')
        self.assertEqual([p['count'] for p in self.s.people()['people'] if p['name'] == 'Carla'], [0])
        # rename: activities and meetings both follow; renaming onto another person merges
        self.s.rename_person('Ana Ruiz', 'Ana R.')
        self.assertEqual(self.s.read('ACT-0001')['fields']['from'], ['Ana R.', 'Pablo'])
        self.assertEqual(self.s.read('MTG-0001')['fields']['attendees'], ['Ana R.', 'Luis'])
        self.s.rename_person('Pablo', 'ana r.')
        self.assertEqual(self.s.read('ACT-0001')['fields']['from'], ['Ana R.'])
        # delete: gone from the items and from the history
        self.s.delete_person('Luis')
        self.assertEqual(self.s.read('MTG-0001')['fields']['attendees'], ['Ana R.'])
        self.s.delete_person('Ana R.')
        self.assertIsNone(self.s.read('ACT-0001')['fields']['from'])
        self.assertEqual(self.s.read('MTG-0001')['fields']['attendees'], [])
        names = [p['name'].lower() for p in self.s.people()['people']]
        self.assertNotIn('ana r.', names)
        self.assertNotIn('luis', names)
        with self.assertRaises(StoreError):
            self.s.delete_person('Nobody')

    def test_main_link_label(self):
        # the main link has its own label; it survives conversion and blank means none
        inb = self.s.create('inbox', 'Spec', {'url': 'docs.google.com/d/1', 'url_label': ' G. Doc '})
        self.assertEqual(inb['fields']['url_label'], 'G. Doc')
        out = self.s.convert('INB-0001', 'task')
        self.assertEqual((out['fields']['url'], out['fields']['url_label']), ('https://docs.google.com/d/1', 'G. Doc'))
        out = self.s.update('TSK-0001', {'url_label': 'Contrato 2026'})  # a file made before the field existed gets it added
        self.assertEqual(out['fields']['url_label'], 'Contrato 2026')
        self.assertIsNone(self.s.update('TSK-0001', {'url_label': '  '})['fields']['url_label'])
        self.assertEqual(self.s.update('TSK-0001', {'url': 'redmine.example/issues/1', 'url_label': 'Redmine'})['fields']['url_label'], 'Redmine')

    def test_update_body_and_updated(self):
        self.s.create('task', 'A')
        out = self.s.update('TSK-0001', {'list': 'doing', 'id': 'HACK', 'created_at': 'x'}, '- [x] one\n- [ ] two\n')
        self.assertEqual(out['id'], 'TSK-0001')
        self.assertEqual(out['fields']['list'], 'doing')
        self.assertNotEqual(out['fields']['created_at'], 'x')
        self.assertEqual(out['checklist'], {'done': 1, 'total': 2})
        self.assertEqual(out['body'], '- [x] one\n- [ ] two\n')

    def test_scans_whole_tree_and_assigns_missing_ids(self):
        deep = os.path.join(self.tmp.name, 'a', 'b')
        os.makedirs(deep)
        with open(os.path.join(deep, 'manual.md'), 'w') as f:
            f.write('---\ntype: task\ntitle: Manual\n---\n')  # legacy `title` still read
        with open(os.path.join(deep, 'plain.md'), 'w') as f:
            f.write('# not an item\n')
        self.assertEqual([i['key'] for i in self.s.items()], ['a/b/manual.md'])
        self.assertEqual(self.s.assign_missing_ids(), [{'path': 'a/b/manual.md', 'id': 'TSK-0001'}])
        self.assertEqual(self.s.find('TSK-0001')['title'], 'Manual')

    def test_delete_goes_to_trash(self):
        self.s.create('note', 'N')
        self.s.delete('NOTE-0001')
        self.assertEqual(self.s.items(), [])
        self.assertTrue(os.listdir(os.path.join(self.tmp.name, '.task-manager', 'trash')))

    def test_worklog(self):
        self.s.create('task', 'A')
        self.s.log_work('TSK-0001', 'Analysis', 'dig', '2026-10-14')
        self.s.log_work('TSK-0001', 'Testing', '', '2026-10-14')
        entries = self.s.worklog()
        self.assertEqual([e['kind'] for e in entries], ['Analysis', 'Testing'])
        self.assertEqual(self.s.items()[0]['type'], 'task')  # worklog file is not an item
        self.s.unlog_work('2026-10-14', 0)
        self.assertEqual([e['kind'] for e in self.s.worklog()], ['Testing'])
        with self.assertRaises(StoreError):
            self.s.log_work('TSK-0001', 'Coding', kinds=['Analysis'])

    def test_tentative_work_is_confirmed_or_discarded_and_a_confirmed_one_never_touched(self):
        self.s.create('task', 'A')
        self.s.log_work('TSK-0001', 'Analysis', 'mine', '2026-10-14', time='01:00')
        self.s.log_work('TSK-0001', 'Testing', 'proposed', '2026-10-14', time='00:30', tentative=True, source='proposal')
        self.s.log_work('TSK-0001', 'Meeting', 'proposed too', '2026-10-14', time='00:45', tentative=True, source='proposal')
        e = self.s.worklog()
        self.assertEqual([(x.get('status'), x.get('source')) for x in e], [(None, None), ('tentative', 'proposal'), ('tentative', 'proposal')])
        with self.assertRaises(StoreError) as err:
            self.s.confirm_log('2026-10-14', 0)  # a confirmed entry is not a tentative one
        self.assertEqual(err.exception.status, 404)
        self.assertEqual(self.s.confirm_log('2026-10-14', 1), {'confirmed': 1})
        self.assertEqual(self.s.discard_log('2026-10-14'), {'discarded': 1})  # every tentative one left: the Meeting
        self.assertEqual([(x['kind'], x.get('status')) for x in self.s.worklog()], [('Analysis', None), ('Testing', None)])
        with open(os.path.join(self.s.root, 'worklog', '2026', '2026-10-14.md'), encoding='utf-8') as f:
            self.assertNotIn('tentative', f.read())

    def test_work_can_be_logged_on_every_type_of_item(self):
        made = [self.s.create(t, f'x {t}') for t in ('inbox', 'initiative', 'story', 'task', 'note', 'meeting', 'activity')]
        for it in made:
            self.s.log_work(it['id'], 'Meeting', 'on it', '2026-10-14', time='00:30')
        self.assertEqual(sorted(e['id'] for e in self.s.worklog()), sorted(it['id'] for it in made))
        self.assertEqual(len(self.s.items()), len(made))  # the log files are still not items

    def test_worklog_time_and_edit(self):
        self.s.create('task', 'A')
        first = self.s.log_work('TSK-0001', 'Analysis', 'dig', '2026-10-14')
        self.assertEqual(first['time'], '00:00')  # every entry has a time spent; none given means 00:00
        self.s.log_work('TSK-0001', 'Testing', '', '2026-10-14', time='1:30')
        self.assertEqual([e['time'] for e in self.s.worklog()], ['00:00', '01:30'])
        for bad in ('90', '1:75', 'abc', '1:5'):
            with self.assertRaises(StoreError):
                self.s.log_work('TSK-0001', 'Testing', time=bad)
        # edit in place
        out = self.s.update_log('2026-10-14', 0, {'kind': 'Definition', 'time': '00:45', 'note': '  fixed  '}, ['Analysis', 'Definition', 'Testing'])
        self.assertEqual((out['kind'], out['time'], out['note'], out['index']), ('Definition', '00:45', 'fixed', 0))
        self.assertNotIn('note', self.s.update_log('2026-10-14', 0, {'note': ' '})) # a blank note is dropped
        with self.assertRaises(StoreError):
            self.s.update_log('2026-10-14', 0, {'kind': 'Coding'}, ['Analysis'])
        with self.assertRaises(StoreError):
            self.s.update_log('2026-10-14', 5, {'kind': 'Analysis'})
        # change the day: it moves to that day's file
        moved = self.s.update_log('2026-10-14', 0, {'new_date': '2026-10-15'})
        self.assertEqual((moved['date'], moved['index']), ('2026-10-15', 0))
        self.assertEqual([(e['date'], e['kind']) for e in self.s.worklog()], [('2026-10-14', 'Testing'), ('2026-10-15', 'Definition')])
        with self.assertRaises(StoreError):
            self.s.update_log('2026-10-15', 0, {'new_date': 'tomorrow'})

    def test_board_validation(self):
        self.assertEqual([l['status'] for l in self.s.board()['lists']][-2:], ['Done', 'Discarded'])
        with self.assertRaises(StoreError):
            self.s.save_board([{'id': 'a', 'status': 'ToDo'}, {'id': 'a', 'status': 'ToDo'}])
        with self.assertRaises(StoreError):
            self.s.save_board([{'id': 'a', 'status': 'Nope'}])
        self.s.save_board([{'id': 'x', 'name': 'X', 'status': 'ToDo', 'wip': '2'}])
        self.assertEqual(self.s.board(), {'lists': [{'id': 'x', 'name': 'X', 'status': 'ToDo', 'wip': 2}]})

    def test_path_escape_rejected(self):
        with self.assertRaises(StoreError):
            self.s.abs('../../etc/passwd')

    # ── phase B: integrity of writes and of the cache ───────────────────────
    def test_cache_sees_a_replacement_with_the_same_size_and_mtime(self):
        self.s.create('task', 'T', {'status': 'ToDo'})
        path = self.s.abs(self.s.find('TSK-0001')['path'])
        self.assertEqual(self.s.read('TSK-0001')['fields']['status'], 'ToDo')  # now cached
        st = os.stat(path)
        with open(path, encoding='utf-8') as f:
            text = f.read().replace('status: ToDo', 'status: Done')  # same length
        other = path + '.new'
        with open(other, 'w', encoding='utf-8') as f:
            f.write(text)
        os.utime(other, ns=(st.st_atime_ns, st.st_mtime_ns))  # a coarse clock: same mtime, same size
        os.replace(other, path)
        self.assertEqual(os.stat(path).st_size, st.st_size)
        self.assertEqual(self.s.read('TSK-0001')['fields']['status'], 'Done')

    def test_readers_never_lose_an_item_while_it_is_written(self):
        self.s.create('note', 'Busy', {}, 'start')
        bodies = ['alpha ' * 4000, 'beta ' * 3000]
        stop, bad = threading.Event(), []

        def reader():
            reader_store = Store(self.tmp.name)  # its own cache, so it really reads the files
            while not stop.is_set():
                items = reader_store.items()
                if [i['id'] for i in items] != ['NOTE-0001']:
                    bad.append('missing')
                elif reader_store.read('NOTE-0001')['body'] not in bodies + ['start']:
                    bad.append('partial body')

        def writer(n):
            for i in range(25):
                self.s.update('NOTE-0001', {'labels': [f'w{n}']}, bodies[(i + n) % 2])

        threads = [threading.Thread(target=reader)] + [threading.Thread(target=writer, args=(n,)) for n in range(3)]
        for t in threads:
            t.start()
        for t in threads[1:]:
            t.join()
        stop.set()
        threads[0].join()
        self.assertEqual(bad, [])
        notes = os.listdir(os.path.join(self.tmp.name, 'notes'))
        self.assertEqual(len(notes), 1)  # no temporary left behind

    def test_restore_refuses_a_target_the_app_would_not_see(self):
        self.s.create('task', 'Gone')
        out = self.s.delete('TSK-0001')
        for bad in ('tasks/x.txt', '', None, '.task-manager/x.md', '.task-manager/trash/x.md', 'a/.hidden/x.md',
                    'node_modules/x.md', 'tasks/.x.md', '../outside.md'):
            with self.subTest(to=bad):
                with self.assertRaises(StoreError) as ctx:
                    self.s.restore(out['trashed'], bad)
                self.assertEqual(ctx.exception.status, 400)
        self.assertEqual([e['id'] for e in self.s.trash()], ['TSK-0001'])  # still safe in the trash
        self.assertEqual(self.s.restore(out['trashed'], 'elsewhere/Gone.md')['id'], 'TSK-0001')

    def test_update_refuses_an_empty_subject(self):
        self.s.create('task', 'Named')
        for bad in ('', '   ', None):
            with self.assertRaises(StoreError):
                self.s.update('TSK-0001', {'subject': bad})
        self.assertEqual(self.s.read('TSK-0001')['title'], 'Named')
        self.assertEqual(self.s.update('TSK-0001', {'subject': '  Renamed '})['title'], 'Renamed')

    # ── phase C: foreign fields, ids that are never reused, titles in the work log ──
    # A valid value for every field any type has, plus fields no type has.
    EVERYTHING = {
        'status': 'ToDo', 'priority': 'High', 'priority_reason': 'why', 'related_to': None, 'url': 'https://x.io', 'url_label': 'X', 'links': [],
        'archived': False, 'session_name': 's', 'sidebar': True, 'redmine_id': '7', 'redmine_url': 'https://r.io/7',
        'local_path': '/tmp', 'due': '2026-11-01', 'plan_week': '2026-W44', 'plan_day': '2026-10-30', 'today_list': 'am',
        'labels': ['l'], 'comments': [], 'user_stories': [], 'list': 'todo', 'order': 1, 'date': '2026-10-30',
        'attendees': ['Ana'], 'source': 'Email', 'from': ['Bea'], 'resolution': 'done', 'legacy_id': 'US-9',
        'completed_at': 'by hand', 'resolved_at': 'by hand', 'bogus': 'x', 'sprint': 3,
    }

    def test_foreign_fields_are_dropped_on_create_per_type(self):
        for t in ITEM_TYPES:
            with self.subTest(type=t):
                # An agent has statuses of its own (Idea … Retired): ToDo is not one of them.
                f = self.s.create(t, f'all {t}', {**self.EVERYTHING, **({'status': 'Build'} if t == 'agent' else {})})['fields']
                self.assertLessEqual(set(f), ALLOWED_FIELDS[t])
                self.assertNotIn('bogus', f)
                self.assertNotEqual(f.get('completed_at'), 'by hand')  # PROTECTED: still dropped
                self.assertNotEqual(f.get('resolved_at'), 'by hand')
                for k in TYPE_FIELDS[t]:
                    self.assertIn(k, f)  # its own fields are all there
        # each type kept exactly what it may carry
        f = {t: self.s.read(f'{ITEM_TYPES[t]}-0001')['fields'] for t in ITEM_TYPES}
        self.assertEqual((f['task']['list'], f['task']['status']), ('todo', 'ToDo'))
        self.assertNotIn('resolution', f['task'])
        self.assertNotIn('resolved_at', f['task'])  # the resolution rule never ran for a task
        self.assertTrue(f['activity']['resolved_at'])  # it did for the activity
        self.assertEqual(f['story']['legacy_id'], 'US-9')
        self.assertEqual(f['initiative']['user_stories'], [])  # legacy, still accepted on an initiative
        self.assertNotIn('legacy_id', f['task'])
        self.assertEqual(set(f['prompt']) - {'id', 'type', 'subject', 'created_at', 'updated_at'}, {'archived', 'labels'})
        self.assertNotIn('status', f['note'])
        self.assertEqual(f['meeting']['date'], '2026-10-30')

    def test_foreign_fields_are_dropped_on_update_before_the_rules(self):
        self.s.create('note', 'N')
        out = self.s.update('NOTE-0001', {'status': 'Done', 'plan_day': '2026-10-30', 'resolution': 'x', 'list': 'a',
                                          'labels': ['kept']})['fields']
        for k in ('status', 'completed_at', 'plan_day', 'today_list', 'resolution', 'resolved_at', 'list'):
            self.assertNotIn(k, out)  # neither the field nor what it would have triggered
        self.assertEqual(out['labels'], ['kept'])
        # a task turned into a Prompt in the form sends what the task had: only the prompt's fields land
        self.s.create('prompt', 'P')
        out = self.s.update('PRM-0001', {'session_name': 's', 'url': 'https://x.io', 'status': 'Done', 'archived': True})['fields']
        self.assertEqual({k for k in out if k in self.EVERYTHING}, {'archived', 'labels'})
        self.assertTrue(out['archived'])
        # a foreign value that would not even validate is dropped, not a 400
        self.s.create('task', 'T')
        self.assertNotIn('source', self.s.update('TSK-0001', {'source': 'Pigeon', 'user_stories': [{'id': 'x'}]})['fields'])
        # the explicit actions keep their own rules
        with self.assertRaises(StoreError):
            self.s.update('TSK-0001', {'resolved': True})  # only activities resolve
        with self.assertRaises(StoreError):
            self.s.update('PRM-0001', {'related_to': 'TSK-0001'})  # a prompt relates to nothing
        self.assertEqual(self.s.update('TSK-0001', {'subject': 'Renamed'})['title'], 'Renamed')

    def test_foreign_fields_are_dropped_on_convert(self):
        self.s.create('inbox', 'Idea', {'url': 'https://x.io', 'labels': ['a']})
        out = self.s.convert('INB-0001', 'note', {'status': 'Done', 'priority': 'High', 'list': 'x', 'bogus': 1})
        f = out['fields']
        self.assertLessEqual(set(f), ALLOWED_FIELDS['note'])
        self.assertNotIn('completed_at', f)
        self.assertEqual((f['url'], f['labels'], f['converted_from']), ('https://x.io', ['a'], 'INB-0001'))

    def test_new_initiatives_have_no_embedded_user_stories(self):
        self.assertNotIn('user_stories', self.s.create('initiative', 'I')['fields'])
        self.assertNotIn('user_stories', TYPE_FIELDS['initiative'])
        self.assertEqual(self.s.migrate_user_stories(), [])

    def test_ids_are_not_reused_after_the_trash_is_emptied(self):
        self.s.create('task', 'One')
        self.s.create('task', 'Two')
        self.s.log_work('TSK-0002', 'Analysis', '', '2026-10-14')
        self.s.delete('TSK-0002')
        self.s.unlog_work('2026-10-14', 0)  # nothing else remembers TSK-0002 now…
        self.s.empty_trash()
        self.assertEqual(self.s.create('task', 'Three')['id'], 'TSK-0003')  # …but ids.json does
        self.s.delete('TSK-0003')
        self.s.purge(self.s.trash()[0]['trashed'])
        self.assertEqual(self.s.create('task', 'Four')['id'], 'TSK-0004')
        with open(os.path.join(self.tmp.name, '.task-manager', 'ids.json'), encoding='utf-8') as f:
            self.assertEqual(json.load(f), {'TSK': 4})

    def test_ids_are_not_reused_after_a_file_is_deleted_by_hand(self):
        made = self.s.create('note', 'Doomed')
        os.remove(self.s.abs(made['path']))
        self.assertEqual(self.s.create('note', 'Next')['id'], 'NOTE-0002')
        inbox = self.s.create('inbox', 'x')
        self.s.convert(inbox['id'], 'task')
        os.remove(self.s.abs(self.s.find('TSK-0001')['path']))  # converted_from went with it
        self.assertEqual(self.s.create('inbox', 'y')['id'], 'INB-0002')

    def test_ids_come_from_every_source_when_ids_json_is_missing_or_broken(self):
        ids_json = os.path.join(self.tmp.name, '.task-manager', 'ids.json')
        self.s.create('task', 'A')
        self.s.create('task', 'B')
        self.s.log_work('TSK-0002', 'Analysis', '', '2026-10-14')
        # a vault from before ids.json: the work log alone still keeps TSK-0002 taken after a purge
        os.remove(ids_json)
        self.s.delete('TSK-0002')
        trashed = os.path.join(self.tmp.name, self.s.trash()[0]['trashed'])
        os.remove(trashed)  # gone by hand, so nothing recorded it
        self.assertEqual(self.s.create('task', 'C')['id'], 'TSK-0003')
        for broken in ('{not json', '[1, 2]', '{"TSK": "lots", "NOTE": true}', '', '\xff\xfe'):
            with self.subTest(content=broken):
                with open(ids_json, 'w', encoding='latin-1') as f:
                    f.write(broken)
                made = self.s.create('task', 'D')
                with open(ids_json, encoding='utf-8') as f:
                    self.assertEqual(json.load(f)['TSK'], int(made['id'].split('-')[1]))  # rewritten, valid again

    def test_a_damaged_ids_json_is_rebuilt_for_every_prefix_and_kept_aside(self):
        ids_json = os.path.join(self.tmp.name, '.task-manager', 'ids.json')
        self.s.create('task', 'A')
        self.s.create('note', 'N1')
        self.s.create('note', 'N2')
        self.s.log_work('NOTE-0002', 'Analysis', '', '2026-10-14')  # the work log is what still remembers it
        self.s.delete('NOTE-0002')
        self.s.purge(self.s.trash()[0]['trashed'])
        with open(ids_json, 'w', encoding='utf-8') as f:
            f.write('{broken')
        self.s.create('task', 'B')  # writes the marks again: it must not lose the NOTE prefix
        with open(ids_json, encoding='utf-8') as f:
            marks = json.load(f)
        self.assertEqual(marks['TSK'], 2)
        self.assertGreaterEqual(marks['NOTE'], 2)  # rebuilt from the work log: the NOTE prefix is not lost
        self.assertTrue(os.path.exists(ids_json + '.damaged'))  # the bad file is not thrown away
        self.assertEqual(self.s.create('note', 'N3')['id'], 'NOTE-0003')  # NOTE-0002 does not come back

    def test_slugs_keep_letters_of_every_script(self):
        from tm.store import slugify
        self.assertEqual(slugify('Café déjà vu'), 'cafe-deja-vu')
        self.assertEqual(slugify('日本語 ✅ emoji'), '日本語-emoji')
        self.assertEqual(slugify('がぎ グ'), 'がぎ-グ')  # a voicing mark is part of the letter
        self.assertEqual(slugify('Привет мир'), 'привет-мир')
        self.assertEqual(slugify('a_b  c--d'), 'a-b-c-d')
        self.assertEqual(slugify('!!!'), 'untitled')
        self.assertEqual(self.s.create('note', '日本語のメモ')['path'].split('/')[-1], 'NOTE-0001-日本語のメモ.md')

    def test_purging_an_old_item_records_its_id(self):
        self.s.create('task', 'A')
        self.s.create('task', 'B')
        os.remove(os.path.join(self.tmp.name, '.task-manager', 'ids.json'))  # made before ids.json existed
        self.s.delete('TSK-0002')
        self.s.empty_trash()
        self.assertEqual(self.s.create('task', 'C')['id'], 'TSK-0003')

    def test_concurrent_creates_get_distinct_ids(self):
        out, errors = [], []

        def make(n):
            try:
                out.append(self.s.create('task', f'T{n}')['id'])
            except Exception as e:  # noqa: BLE001 - surfaced by the assertion below
                errors.append(e)

        threads = [threading.Thread(target=make, args=(n,)) for n in range(12)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])
        self.assertEqual(sorted(out), [f'TSK-{n:04d}' for n in range(1, 13)])

    def test_work_log_entries_keep_the_title_they_were_logged_with(self):
        self.s.create('task', 'Write the spec')
        logged = self.s.log_work('TSK-0001', 'Analysis', 'dig', '2026-10-14')
        self.assertEqual(logged['title'], 'Write the spec')
        self.s.update('TSK-0001', {'subject': 'Renamed later'})
        moved = self.s.update_log('2026-10-14', 0, {'kind': 'Testing', 'new_date': '2026-10-15'})
        self.assertEqual(moved['title'], 'Write the spec')  # an edit keeps it
        self.s.delete('TSK-0001')
        self.s.empty_trash()
        (entry,) = self.s.worklog()
        self.assertEqual((entry['id'], entry['title']), ('TSK-0001', 'Write the spec'))  # the item is gone; its name is not
        self.s.create('task', 'Other')
        self.s.log_work('TSK-0002', 'Analysis', '', '2026-10-15')  # rewrites the day file's readable list
        with open(os.path.join(self.tmp.name, 'worklog', '2026', '2026-10-15.md'), encoding='utf-8') as f:
            self.assertIn('TSK-0001 Write the spec', f.read())
        # an entry from before titles were stored reads as before
        day = os.path.join(self.tmp.name, 'worklog', '2026', '2026-10-16.md')
        os.makedirs(os.path.dirname(day), exist_ok=True)
        with open(day, 'w', encoding='utf-8') as f:
            f.write('---\ntype: worklog\ndate: 2026-10-16\nentries: [{"at": "09:00", "id": "TSK-0001", "kind": "Analysis"}]\n---\n')
        old = [e for e in self.s.worklog() if e['date'] == '2026-10-16'][0]
        self.assertNotIn('title', old)
        self.assertNotIn('title', self.s.update_log('2026-10-16', 0, {'time': '00:15'}))

    # ── phase E: edits made elsewhere, and concurrent comments ─────────────
    def edit_outside(self, key, old, new):
        """What Claude or Obsidian does: rewrite the file in place."""
        path = self.s.abs(self.s.find(key)['path'])
        with open(path, encoding='utf-8') as f:
            text = f.read()
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text.replace(old, new))

    def test_items_carry_a_file_rev_and_a_body_rev(self):
        made = self.s.create('note', 'N', {}, 'the body')
        (listed,) = self.s.items()
        self.assertEqual((listed['rev'], listed['body_rev']), (made['rev'], made['body_rev']))
        self.assertRegex(made['rev'], r'^[0-9a-f]+-[0-9a-f]+-[0-9a-f]+$')
        self.assertEqual(made['body_rev'], hashlib.sha1(b'the body').hexdigest()[:16])
        self.assertEqual(self.s.read('NOTE-0001')['body_rev'], made['body_rev'])

    def test_a_field_change_moves_rev_but_not_body_rev(self):
        made = self.s.create('note', 'N', {}, 'the body')
        out = self.s.update('NOTE-0001', {'labels': ['x']})
        self.assertNotEqual(out['rev'], made['rev'])
        self.assertEqual(out['body_rev'], made['body_rev'])
        # so the editor's base is still good after the panel saved a field
        self.assertEqual(self.s.update('NOTE-0001', {}, 'mine', base_body_rev=made['body_rev'])['body'], 'mine')

    def test_an_edit_made_elsewhere_moves_both_revs(self):
        made = self.s.create('note', 'N', {}, 'the body')
        self.edit_outside('NOTE-0001', 'the body', 'the body, edited by Claude')
        now = self.s.read('NOTE-0001')
        self.assertNotEqual(now['rev'], made['rev'])
        self.assertNotEqual(now['body_rev'], made['body_rev'])
        # and a replacement with the same size and mtime still moves the file rev (new inode)
        path = self.s.abs(now['path'])
        st = os.stat(path)
        with open(path, encoding='utf-8') as f:
            text = f.read().replace('Claude', 'Claud3')
        with open(path + '.x', 'w', encoding='utf-8') as f:
            f.write(text)
        os.utime(path + '.x', ns=(st.st_atime_ns, st.st_mtime_ns))
        os.replace(path + '.x', path)
        self.assertNotEqual(self.s.read('NOTE-0001')['rev'], now['rev'])

    def test_a_stale_body_is_refused_with_409(self):
        made = self.s.create('note', 'N', {}, 'original')
        self.edit_outside('NOTE-0001', 'original', 'rewritten by Obsidian')
        with self.assertRaises(StoreError) as ctx:
            self.s.update('NOTE-0001', {}, 'my edit of the original', base_body_rev=made['body_rev'])
        self.assertEqual(ctx.exception.status, 409)
        now = self.s.read('NOTE-0001')
        self.assertEqual(now['body'], 'rewritten by Obsidian')  # the edit made elsewhere survives
        self.assertEqual(ctx.exception.extra, {'rev': now['rev'], 'body_rev': now['body_rev']})
        # a field-only save does not care about the body's base
        self.assertEqual(self.s.update('NOTE-0001', {'labels': ['a']}, base_body_rev=made['body_rev'])['fields']['labels'], ['a'])
        # with the current base it goes through; without one, last write wins as before
        out = self.s.update('NOTE-0001', {}, 'merged', base_body_rev=now['body_rev'])
        self.assertEqual(out['body'], 'merged')
        self.assertEqual(self.s.update('NOTE-0001', {}, 'no base given')['body'], 'no base given')

    def test_a_stale_file_rev_is_refused_with_409(self):
        made = self.s.create('task', 'T')
        self.edit_outside('TSK-0001', 'priority: Normal', 'priority: High')
        with self.assertRaises(StoreError) as ctx:
            self.s.update('TSK-0001', {'status': 'Done'}, base_rev=made['rev'])
        self.assertEqual(ctx.exception.status, 409)
        self.assertEqual(self.s.read('TSK-0001')['fields']['status'], 'Backlog')
        fresh = self.s.read('TSK-0001')['rev']
        self.assertEqual(self.s.update('TSK-0001', {'status': 'Done'}, base_rev=fresh)['fields']['priority'], 'High')

    def test_concurrent_comments_all_survive(self):
        self.s.create('task', 'Busy')
        threads, per = 6, 5
        start = threading.Barrier(threads)
        errors = []

        def comment(n):
            start.wait()
            for i in range(per):
                try:
                    self.s.add_comment('TSK-0001', f'c{n}-{i}')
                except Exception as e:  # noqa: BLE001 - surfaced by the assertion below
                    errors.append(e)

        pool = [threading.Thread(target=comment, args=(n,)) for n in range(threads)]
        for t in pool:
            t.start()
        for t in pool:
            t.join()
        self.assertEqual(errors, [])
        texts = [c['text'] for c in self.s.read('TSK-0001')['fields']['comments']]
        self.assertEqual(sorted(texts), sorted(f'c{n}-{i}' for n in range(threads) for i in range(per)))

    def test_concurrent_comment_deletes_each_remove_one(self):
        self.s.create('task', 'T')
        for i in range(6):
            self.s.add_comment('TSK-0001', f'c{i}')
        start = threading.Barrier(3)

        def drop_first():
            start.wait()
            self.s.delete_comment('TSK-0001', 0)

        pool = [threading.Thread(target=drop_first) for _ in range(3)]
        for t in pool:
            t.start()
        for t in pool:
            t.join()
        self.assertEqual([c['text'] for c in self.s.read('TSK-0001')['fields']['comments']], ['c3', 'c4', 'c5'])

    def test_a_prompt_takes_no_comments(self):
        self.s.create('prompt', 'P')
        with self.assertRaises(StoreError):
            self.s.add_comment('PRM-0001', 'hello')  # refused, not silently dropped

    def test_a_linked_day_file_stays_a_link(self):
        self.s.create('task', 'A')
        self.s.log_work('TSK-0001', 'Analysis', '', '2026-10-14')
        day = os.path.join(self.tmp.name, 'worklog', '2026', '2026-10-14.md')
        real = os.path.join(self.tmp.name, 'elsewhere.md')
        os.rename(day, real)
        os.symlink(real, day)
        self.s.log_work('TSK-0001', 'Testing', '', '2026-10-14')
        self.assertTrue(os.path.islink(day))
        self.assertEqual([e['kind'] for e in self.s.worklog()], ['Analysis', 'Testing'])
        with open(real, encoding='utf-8') as f:
            self.assertIn('Testing', f.read())


if __name__ == '__main__':
    unittest.main()


class PlanOrderTest(unittest.TestCase):
    """TSK-053: a card's place on Today and Week, `plan_order`, on what can be planned."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = Store(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_a_number_is_kept_and_anything_else_refused(self):
        for t in ('initiative', 'story', 'task'):
            self.assertIn('plan_order', self.s.structure.allowed_fields(t), t)
        task = self.s.create('task', 'T', {'plan_day': '2026-10-20', 'plan_week': '2026-W43'})
        self.s.update(task['key'], {'plan_order': 15})
        self.assertEqual(self.s.read(task['key'])['fields']['plan_order'], 15)
        self.s.update(task['key'], {'plan_order': 7.5})
        self.assertEqual(self.s.read(task['key'])['fields']['plan_order'], 7.5)
        for bad in ('first', True, [1]):
            with self.assertRaises(StoreError):
                self.s.update(task['key'], {'plan_order': bad})
        self.s.update(task['key'], {'plan_order': None})
        self.assertIsNone(self.s.read(task['key'])['fields'].get('plan_order'))
