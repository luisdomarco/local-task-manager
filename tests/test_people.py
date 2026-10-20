import os
import tempfile
import unittest

from tm import frontmatter as fm
from tm import people
from tm.store import Store, StoreError


class MatchTest(unittest.TestCase):
    RECORDS = [{'name': 'Ana', 'calendar_name': 'Ana García', 'emails': ['ana@x.com']},
               {'name': 'Jan Peeters', 'calendar_name': '', 'emails': []}]

    def test_email_first_then_names_ignoring_case_accents_and_spaces(self):
        self.assertEqual(people.match(self.RECORDS, 'ANA@x.com', 'Nobody')[0:2], ('email', self.RECORDS[0]))
        self.assertEqual(people.match(self.RECORDS, '', ' ana  garcia ')[0], 'name')
        self.assertEqual(people.match(self.RECORDS, 'jan.peeters@y.com', '')[1]['name'], 'Jan Peeters')  # name from the address
        self.assertEqual(people.match(self.RECORDS, 'z@x.com', 'Zoe'), ('new', None))

    def test_a_shared_name_is_ambiguous(self):
        two = [{'name': 'Ana López', 'calendar_name': 'Ana', 'emails': []}, {'name': 'Ana', 'calendar_name': '', 'emails': []}]
        how, who = people.match(two, '', 'ana')
        self.assertEqual((how, [r['name'] for r in who]), ('ambiguous', ['Ana López', 'Ana']))

    def test_emails_are_cleaned(self):
        self.assertEqual(people.clean_emails('A@X.com, b@y.org; not-an-email  a@x.com'), ['a@x.com', 'b@y.org'])


class PeopleStoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = Store(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def person(self, name):
        return next(p for p in self.s.people()['people'] if p['name'] == name)

    def test_an_old_people_file_with_names_only_still_reads(self):
        os.makedirs(os.path.join(self.tmp.name, '.task-manager'))
        with open(os.path.join(self.tmp.name, '.task-manager', 'people.md'), 'w', encoding='utf-8') as f:
            f.write(fm.build({'type': 'people', 'names': ['Ana', 'Pablo']}, '# People\n'))
        self.assertEqual([(p['name'], p['emails']) for p in self.s.people()['people']], [('Ana', []), ('Pablo', [])])
        self.s.update_person('Ana', {'emails': 'ana@x.com'})
        with open(os.path.join(self.tmp.name, '.task-manager', 'people.md'), encoding='utf-8') as f:
            fields, _ = fm.split(f.read())
        parsed = fm.parse(fields)
        self.assertEqual(parsed['names'], ['Ana', 'Pablo'])  # still there, for an older copy of the app
        self.assertEqual(parsed['people'][0], {'name': 'Ana', 'calendar_name': '', 'emails': ['ana@x.com'], 'redmine': '', 'slack': '',
                                             'notes': '', 'when_to_use': ''})

    def test_renaming_the_public_name_reaches_the_items_and_keeps_the_rest(self):
        self.s.create('meeting', 'M', {'attendees': ['Ana García']})
        self.s.update_person('Ana García', {'calendar_name': 'Ana Garcia Lopez', 'emails': ['ana@x.com']})
        self.s.update_person('Ana García', {'name': 'Ana'})
        self.assertEqual(self.s.read('MTG-0001')['fields']['attendees'], ['Ana'])
        self.assertEqual((self.person('Ana')['calendar_name'], self.person('Ana')['emails']), ('Ana Garcia Lopez', ['ana@x.com']))

    def test_redmine_and_slack_users_are_kept_and_may_be_empty(self):
        self.s.add_person('Ana')
        self.s.update_person('Ana', {'redmine': '  ana.garcia ', 'slack': 'U012AB3CD'})
        self.assertEqual((self.person('Ana')['redmine'], self.person('Ana')['slack']), ('ana.garcia', 'U012AB3CD'))
        self.s.update_person('Ana', {'name': 'Ana G.', 'slack': ''})  # renaming keeps them; '' clears one
        self.assertEqual((self.person('Ana G.')['redmine'], self.person('Ana G.')['slack']), ('ana.garcia', ''))
        self.s.add_person('Pablo')
        self.assertEqual((self.person('Pablo')['redmine'], self.person('Pablo')['slack']), ('', ''))

    def test_a_new_person_can_come_with_their_record(self):
        self.s.add_person('Ana', {'emails': 'ana@x.com', 'redmine': 'ana', 'slack': ''})
        self.assertEqual((self.person('Ana')['emails'], self.person('Ana')['redmine']), (['ana@x.com'], 'ana'))
        with self.assertRaises(StoreError) as cm:
            self.s.add_person('ANA', {'slack': 'U1'})  # someone has that name: not overwritten
        self.assertEqual((cm.exception.status, self.person('Ana')['slack']), (409, ''))
        self.s.add_person('Ana')  # by name alone, as before: already there is fine

    def test_mentions_are_found_once_and_renamed_in_place(self):
        self.assertEqual(people.mentions('Ask @[Ana  García] and @[ana garcía], cc @[Pablo]', 'no @one here', None), ['Ana García', 'Pablo'])
        self.assertEqual(people.rename_mentions('@[ana garcía], @[Anabel] · @[Ana García]', 'Ana García', 'Ana'), '@[Ana], @[Anabel] · @[Ana]')

    def test_renaming_a_person_rewrites_their_mentions(self):
        self.s.create('note', 'N', {}, body='Talk to @[Ana García] about @[Pablo].\n')
        self.s.create('meeting', 'M', {'attendees': ['Ana García']})
        self.s.update_person('Ana García', {'name': 'Ana'})
        self.assertEqual(self.s.read('NOTE-0001')['body'], 'Talk to @[Ana] about @[Pablo].\n')

    def test_the_claude_prompt_says_how_to_reach_who_it_mentions(self):
        self.s.add_person('Ana', {'emails': 'ana@x.com', 'slack': 'U1'})
        self.s.create('note', 'N', {}, body='Send it to @[Ana].')
        prompt = self.s.claude_prompt('NOTE-0001', 'and copy @[Nobody]')
        self.assertIn('## People mentioned\n\n- Ana: email ana@x.com · Slack U1\n- Nobody: not in Contacts', prompt)
        self.assertEqual(self.s.mentions_note('no mentions'), '')

    def test_renaming_onto_someone_merges_their_emails(self):
        self.s.create('meeting', 'M', {'attendees': ['Ana', 'A. García']})
        self.s.update_person('Ana', {'emails': 'ana@x.com'})
        self.s.update_person('A. García', {'emails': 'ana@gmail.com'})
        self.s.update_person('A. García', {'name': 'Ana'})
        self.assertEqual(self.s.read('MTG-0001')['fields']['attendees'], ['Ana'])
        self.assertEqual(self.person('Ana')['emails'], ['ana@x.com', 'ana@gmail.com'])

    def test_an_email_belongs_to_one_person(self):
        self.s.add_person('Ana')
        self.s.add_person('Pablo')
        self.s.update_person('Ana', {'emails': 'shared@x.com'})
        with self.assertRaises(StoreError) as e:
            self.s.update_person('Pablo', {'emails': 'shared@x.com'})
        self.assertEqual(e.exception.status, 409)

    def test_learning_never_moves_an_address(self):
        self.s.learn_people(new=[{'name': 'Ana', 'emails': ['a@x.com']}])
        self.s.learn_people(new=[{'name': 'Other', 'emails': ['a@x.com']}], learned=[{'name': 'Ana', 'email': 'a2@x.com'}])
        self.assertEqual({p['name']: p['emails'] for p in self.s.people()['people']}, {'Ana': ['a@x.com', 'a2@x.com'], 'Other': []})

    def test_deleting_a_person_drops_their_record(self):
        self.s.update_person(self.s.add_person('Ana')['people'][0]['name'], {'emails': 'a@x.com'})
        self.s.delete_person('Ana')
        self.s.add_person('Ana')
        self.assertEqual(self.person('Ana')['emails'], [])


if __name__ == '__main__':
    unittest.main()


class ContactsTest(unittest.TestCase):
    """TSK-050: People and Groups, each with notes and when to use them."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = Store(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def group(self, name):
        return next((g for g in self.s.groups()['groups'] if g['name'] == name), None)

    def test_a_person_keeps_notes_and_when_to_use_on_several_lines(self):
        self.s.add_person('Ana', {'notes': 'Product lead.\n  ', 'when_to_use': 'Pricing questions.\nNever on Fridays.'})
        ana = next(p for p in self.s.people()['people'] if p['name'] == 'Ana')
        self.assertEqual((ana['notes'], ana['when_to_use']), ('Product lead.', 'Pricing questions.\nNever on Fridays.'))
        self.s.update_person('Ana', {'notes': ''})
        self.assertEqual(next(p for p in self.s.people()['people'] if p['name'] == 'Ana')['notes'], '')

    def test_groups_are_added_edited_and_deleted(self):
        self.s.add_person('Ana')
        self.s.add_group('Dev team', {'channel': 'Slack', 'address': '#dev', 'members': ['Ana', 'ana', 'Jan'],
                                      'when_to_use': 'Deploys and outages.'})
        self.assertEqual(self.group('Dev team'), {'name': 'Dev team', 'channel': 'slack', 'address': '#dev', 'members': ['Ana', 'Jan'],
                                                  'notes': '', 'when_to_use': 'Deploys and outages.', 'count': 0})
        self.s.update_group('Dev team', {'name': 'Developers', 'channel': 'email', 'address': 'dev@x.com'})
        self.assertIsNone(self.group('Dev team'))
        self.assertEqual((self.group('Developers')['channel'], self.group('Developers')['members']), ('email', ['Ana', 'Jan']))
        self.s.delete_group('Developers')
        self.assertEqual(self.s.groups()['groups'], [])
        with self.assertRaises(StoreError) as e:
            self.s.delete_group('Developers')
        self.assertEqual(e.exception.status, 404)

    def test_a_name_is_a_person_or_a_group_never_both(self):
        self.s.add_person('Ana')
        self.s.add_group('Ops')
        for call in (lambda: self.s.add_group('ana'), lambda: self.s.add_group('OPS'), lambda: self.s.add_person('Ops'),
                     lambda: self.s.update_person('Ana', {'name': 'Ops'}), lambda: self.s.add_group('')):
            with self.assertRaises(StoreError):
                call()

    def test_a_person_renamed_or_deleted_follows_into_their_groups(self):
        self.s.add_person('Ana')
        self.s.add_person('Jan')
        self.s.add_group('Ops', {'members': ['Ana', 'Jan']})
        self.s.update_person('Ana', {'name': 'Ana García'})
        self.assertEqual(self.group('Ops')['members'], ['Ana García', 'Jan'])
        self.s.delete_person('Jan')
        self.assertEqual(self.group('Ops')['members'], ['Ana García'])

    def test_a_prompt_names_a_mentioned_group_and_when_to_use_a_contact(self):
        self.s.add_person('Ana', {'emails': 'ana@x.com', 'when_to_use': 'Pricing.'})
        self.s.add_group('Ops', {'channel': 'slack', 'address': '#ops', 'members': ['Ana'], 'notes': 'On call: rotates weekly.'})
        note = self.s.mentions_note('Tell @[Ana] and @[Ops] about it')
        self.assertIn('- Ana: email ana@x.com\n  When to use: Pricing.', note)
        self.assertIn('- Ops (group): Slack channel #ops · members Ana\n  Notes: On call: rotates weekly.', note)


class WatchersTest(unittest.TestCase):
    """TSK-051: an initiative, a story or a task names the people and groups to tell when its status changes."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = Store(self.tmp.name)
        self.s.add_person('Ana', {'emails': 'ana@x.com'})
        self.s.add_group('Ops', {'channel': 'slack', 'address': '#ops', 'when_to_use': 'When it is done.'})

    def tearDown(self):
        self.tmp.cleanup()

    def watchers(self, key):
        return self.s.read(key)['fields'].get('watchers')

    def test_initiatives_stories_and_tasks_have_watchers_and_the_rest_not(self):
        for t in ('initiative', 'story', 'task'):
            self.assertIn('watchers', self.s.structure.allowed_fields(t), t)
        for t in ('note', 'meeting', 'activity'):
            self.assertNotIn('watchers', self.s.structure.allowed_fields(t), t)

    def test_watchers_are_a_clean_list_and_a_new_name_becomes_a_person(self):
        task = self.s.create('task', 'T', {'watchers': ['Ana', ' ana ', 'Ops', 'Jan  Peeters']})
        self.assertEqual(self.watchers(task['key']), ['Ana', 'Ops', 'Jan Peeters'])
        names = [p['name'] for p in self.s.people()['people']]
        self.assertIn('Jan Peeters', names)
        self.assertNotIn('Ops', names)  # a group stays a group
        self.s.update(task['key'], {'watchers': []})
        self.assertEqual(self.watchers(task['key']), [])

    def test_renaming_or_deleting_a_contact_reaches_what_it_watches(self):
        task = self.s.create('task', 'T', {'watchers': ['Ana', 'Ops']})
        self.assertEqual(self.s.groups()['groups'][0]['count'], 1)
        self.assertEqual(next(p for p in self.s.people()['people'] if p['name'] == 'Ana')['watcher'], 1)
        self.s.update_person('Ana', {'name': 'Ana García'})
        self.s.update_group('Ops', {'name': 'Operations'})
        self.assertEqual(self.watchers(task['key']), ['Ana García', 'Operations'])
        self.s.delete_group('Operations')
        self.s.delete_person('Ana García')
        self.assertEqual(self.watchers(task['key']), [])

    def test_the_claude_prompt_lists_the_watchers_and_how_to_reach_them(self):
        task = self.s.create('task', 'T', {'watchers': ['Ana', 'Ops']})
        prompt = self.s.claude_prompt(task['key'])
        self.assertIn('- Watchers: Ana, Ops', prompt)
        self.assertIn('## Watchers\n\nTell them when its status changes, as each one says:\n\n- Ana: email ana@x.com\n'
                      '- Ops (group): Slack channel #ops\n  When to use: When it is done.', prompt)
