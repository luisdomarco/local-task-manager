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
        self.assertEqual(FOLDER_PER_TYPE.allowed_fields('initiative') - FOLDER_PER_TYPE.allowed_fields('task') >= {'user_stories', 'sidebar'}, True)
        self.assertIn('legacy_id', store_mod.ALLOWED_FIELDS['story'])

    def test_registered_by_id(self):
        self.assertIs(get('folders'), FOLDER_PER_TYPE)
        self.assertEqual(STRUCTURES, {k: {'label': s.label, 'legacy': k in ('folders', 'tasks')} for k, s in REGISTRY.items()})

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
                                      fields=(*FOLDER_PER_TYPE.types['task'].fields, 'bug_id', 'bug_url'),
                                      statuses=('Open', 'Fixed', 'WontFix'), closed=frozenset({'Fixed', 'WontFix'})),
           'inbox': FOLDER_PER_TYPE.types['inbox']},
    statuses=('Open', 'Fixed', 'WontFix'), closed=frozenset({'Fixed', 'WontFix'}), priorities=('P0', 'P1'),
    id_re=re.compile(r'^([A-Z]+)-(\d{3,})$'), id_pad=3, defaults={'status': 'Open', 'priority': 'P1'},
    external_ref={'id_key': 'bug_id', 'url_key': 'bug_url', 'label': 'Ticket'},
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
        bug = self.s.create('bug', 'Crash', {'bug_id': '12'})
        self.assertIn('- Ticket: #12', self.s.claude_prompt(bug['id']))
        self.assertNotIn('Redmine', self.s.claude_prompt(bug['id']))

    def test_no_user_story_migration(self):
        self.assertEqual(self.s.migrate_user_stories(), [])


class LayoutTest(unittest.TestCase):
    """Where the page shows each type: as a page of its own or a card, the tables on its page, and the tab of each of
    its own fields (Ticketing follows the folder-per-type structure's layout: properties in the main column, the rest in the side panel)."""

    def types(self, structure):
        return {t['name']: t for t in structure.public()['types']}

    def test_folders_has_one_page_the_initiatives_with_its_five_tables(self):
        types = self.types(FOLDER_PER_TYPE)
        self.assertEqual([n for n, t in types.items() if t.get('page')], ['initiative'])
        # Its tasks first, then its epics: the sub-initiatives whose tracker says Epic.
        self.assertEqual(types['initiative']['children'], ['task', 'initiative', 'story', 'note', 'meeting'])
        self.assertEqual(types['initiative']['child_tables'], {'initiative': {'label': 'Epics', 'noun': 'Epic', 'where': {'tracker': 'Epic'}}})
        self.assertNotIn('child_tables', types['story'])
        # One rule everywhere (traits.parent_label): the parent type's label when it can be one type only, else Parent.
        self.assertEqual((types['initiative']['parent_label'], types['task']['parent_label'], types['transcription']['parent_label']),
                         ('Initiative', 'Parent', 'Meeting'))

    def test_tasks_lead_every_project_and_initiative_page(self):
        for sid in ('folders', 'tasks', 'ticketing'):
            types = self.types(get(sid))
            for name in ('project', 'initiative'):
                if types.get(name, {}).get('page'):
                    self.assertEqual(types[name]['children'][0], 'task', f'{sid}: {name}')

    def test_ticketing_has_pages_for_its_projects_initiatives_prds_and_goals(self):
        types = self.types(get('ticketing'))
        self.assertEqual(sorted(n for n, t in types.items() if t.get('page')), ['goal', 'initiative', 'prd', 'project'])
        # A goal holds what names it, across projects, then its notes; it hangs from nothing and lives in no project.
        self.assertEqual(types['goal']['children'], ['project', 'initiative', 'story', 'task', 'note'])
        self.assertNotIn('parent_label', types['goal'])
        self.assertNotIn('project', types['goal']['fields'])
        for name, t in types.items():
            for child in t.get('children', []):
                self.assertIn(child, types, f'{name} lists a table of {child}, which is not a type')
        self.assertNotIn('parent_label', types['initiative'])  # an initiative hangs from nothing: its stories hang from it
        self.assertEqual(types['initiative']['children'][:2], ['task', 'story'])
        self.assertEqual(types['project']['children'][:2], ['task', 'initiative'])
        self.assertEqual(types['project']['children'][-2:], ['note', 'meeting'])  # its Overview: Tasks · Notes · Meetings
        self.assertEqual((types['story']['parent_label'], types['prd']['parent_label']), ('Initiative', 'Initiative'))
        self.assertEqual((types['hotfix']['parent_label'], types['error']['parent_label']), ('Support', 'Parent'))
        # What always hangs from another item (a plan) is not listed nor added on a project's page: it is its item's. The
        # rest is, whatever it hangs from (a story under an initiative, or under none).
        public = get('ticketing').public()
        needs = public['needs_parent']
        self.assertEqual(needs, ['plan'])
        self.assertEqual([c for c in types['project']['children'] if c in needs], [])
        self.assertTrue({'story', 'hotfix', 'prd'} <= set(types['project']['children']))
        # The tickets that may be in no project: all of a project's folders but its sub-documents.
        self.assertEqual(public['leaves_project'], ['initiative', 'story', 'spec', 'support', 'hotfix', 'prd'])
        self.assertEqual(sorted(set(public['project_scoped']) - set(public['leaves_project'])), ['analysis', 'error', 'learning', 'plan'])

    def test_ticketing_sidebar_has_its_sections_and_every_list_a_place(self):
        # The sidebar: Projects · Initiatives · Tasks | Notes, then one link per section, a tab per type (static/js/sections.js).
        public = get('ticketing').public()
        types = self.types(get('ticketing'))
        sections = {s['key']: s['types'] for s in public['sections']}
        self.assertEqual(sections, {'meetings': ['meeting', 'transcription'], 'brief': ['analysis', 'spec', 'prd', 'plan'],
                                    'issues': ['story', 'support', 'hotfix'], 'records': ['learning', 'error']})
        in_section = [n for ts in sections.values() for n in ts]
        self.assertEqual(len(in_section), len(set(in_section)), 'a type is a tab of one section only')
        for name in in_section:
            self.assertTrue(types[name].get('list'), f'{name} is a tab, so it has a list')
        linked = sorted((t['nav']['order'], n) for n, t in types.items()
                        if t.get('list') and t.get('nav', {}).get('group') == 'types' and n not in in_section)
        self.assertEqual([n for _, n in linked], ['project', 'initiative', 'task', 'note'])
        for name, t in types.items():  # every list is somewhere: a link of its own or a tab
            if t.get('list'):
                self.assertTrue(t.get('nav') or name in in_section, f'{name} has a list and no place in the sidebar')
        for sid in ('folders', 'tasks'):  # legacy structures keep a link per type
            self.assertNotIn('sections', get(sid).public())

    def test_every_text_in_settings_says_what_goes_in_it(self):
        # quiet fields: no frame at rest, so an empty one shows its helper text (area: the app's own, with objective)
        for name, t in self.types(get('ticketing')).items():
            for p in t.get('props', []):
                if p['kind'] == 'text' and p['tab'] in ('delivery', 'settings') and p['key'] != 'area':
                    self.assertTrue(p.get('placeholder'), f'{name}.{p["key"]} has no helper text')

    def test_every_link_is_in_relations_and_the_execution_fields_in_delivery(self):
        types = self.types(get('ticketing'))
        for name, t in types.items():
            for p in t.get('props', []):
                self.assertIn(p['tab'], ('main', 'delivery', 'relations', 'details', 'settings', 'hidden'), f'{name}.{p["key"]}')
                if p['kind'] in ('link', 'links'):  # hidden: shown elsewhere (a PRD and a plan in their tabs, depends on as Blocked by)
                    self.assertIn(p['tab'], ('relations', 'hidden'), f'{name}.{p["key"]}')
        tab = {p['key']: p['tab'] for p in types['initiative']['props']}
        self.assertEqual([k for k, v in tab.items() if v == 'hidden'], ['prd', 'plan', 'depends_on', 'goal_order'])
        self.assertEqual(tab['goal'], 'relations')  # the goal it is part of; its place there is the Goals view's
        self.assertEqual([k for k, v in tab.items() if v == 'main'], [])  # area and objective: the app's; size: in Readiness
        self.assertEqual(tab['size'], 'delivery')
        self.assertNotIn('branch', tab)  # delivered by its stories
        story = [(p['group'], p['key']) for p in types['story']['props'] if p['tab'] == 'delivery']
        self.assertEqual(story, [('Readiness', 'size'), ('Execution', 'executor'), ('Execution', 'branch'), ('Execution', 'baseline'),
                                 ('Spec and release', 'spec_impact'), ('Spec and release', 'changelog_ref'),
                                 ('Paused or discarded', 'on_hold'), ('Paused or discarded', 'discard_reason')])
        # On hold's keys each a row under its own name (itemform.js propField, a map with key_labels), wherever it is.
        for name in ('initiative', 'story', 'support'):
            hold = next(p for p in types[name]['props'] if p['key'] == 'on_hold')
            self.assertEqual(hold['key_labels'], {'by': 'On hold by', 'why': 'Why on hold', 'resume_when': 'Resume when'}, name)
            self.assertEqual(sorted(hold['key_labels']), sorted(hold['keys']), name)
        for name, t in types.items():  # every Delivery field has its group, and a group's fields sit together
            groups = [p.get('group') for p in t.get('props', []) if p['tab'] == 'delivery']
            self.assertNotIn(None, groups, name)
            self.assertEqual(groups, sorted(groups, key=groups.index), name)
        self.assertEqual({p['tab'] for p in types['project']['props']}, {'settings', 'hidden', 'relations'})  # relations: its goal
        settings = [(p['group'], p['key']) for p in types['project']['props'] if p['tab'] == 'settings']
        self.assertEqual(settings, [('Global', 'project_kind'), ('Global', 'enabled_types'), ('Global', 'execution_mode'),
                                    ('Code', 'repo'), ('Code', 'managed_by'), ('Support due days', 'support_due_days')])

    def test_what_a_later_step_writes_is_not_asked_on_create(self):
        from tm.structures.ticketing.definition import LATER
        types = self.types(get('ticketing'))
        keys = {p['key'] for t in types.values() for p in t.get('props', [])}
        self.assertLessEqual(LATER, keys)  # names only fields that exist
        for name, t in types.items():
            for p in t.get('props', []):
                later = p.get('group') in ('Execution', 'Spec and release', 'Triage', 'Paused or discarded') or p['key'] in LATER
                self.assertEqual(bool(p.get('later')), later, f'{name}.{p["key"]}')
        support = {p['key'] for p in types['support']['props'] if not p.get('later')}
        self.assertEqual(support & {'disposition', 'resolution', 'signature', 'branch'}, set())
        self.assertLessEqual({'level', 'level_reason', 'origin', 'area'}, support)
        initiative = [p['key'] for p in types['initiative']['props'] if p['tab'] == 'delivery' and not p.get('later')]
        self.assertEqual(initiative, ['regime', 'size'])  # Readiness, less the premise: verified later
        self.assertFalse(any(p.get('later') for t in self.types(get('folders')).values() for p in t.get('props', [])))

    def test_a_type_turned_off_leaves_the_pages_tables_and_the_optional_types(self):
        s = get('ticketing').without(['plan', 'hotfix'])
        types = self.types(s)
        self.assertNotIn('plan', types['initiative']['children'])
        self.assertNotIn('plan', types['project']['children'])
        self.assertEqual(s.public()['optional_types'], ['prd'])
        self.assertEqual(get('ticketing').public()['optional_types'], ['hotfix', 'prd'])


class RegistryTest(unittest.TestCase):
    def test_three_structures_in_the_order_settings_offers_them(self):
        self.assertEqual([(k, s.label) for k, s in REGISTRY.items()],
                         [('folders', 'Initiatives'), ('tasks', 'Tasks'), ('ticketing', 'Projects')])

    def test_only_a_structure_of_one_folder_per_type_lets_a_vault_move_its_folders(self):
        self.assertEqual(get('folders').type_choices()['folders'], FOLDER_PER_TYPE.default_folders)
        self.assertNotIn('story', get('tasks').type_choices()['folders'])
        self.assertEqual(get('ticketing').type_choices()['folders'], {})


class TasksStructureTest(unittest.TestCase):
    """Tasks: Initiatives without user stories, and with projects. A task hangs straight from an initiative."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        self.tasks = get('tasks')

    def test_every_type_but_the_story_and_nothing_names_it(self):
        self.assertEqual(list(self.tasks.types), [*(t for t in FOLDER_PER_TYPE.types if t != 'story'), 'project'])
        self.assertNotIn('story', json.dumps(self.tasks.public()['types']))
        pub = {t['name']: t for t in self.tasks.public()['types']}
        self.assertEqual(pub['task']['parents'], ['initiative'])
        self.assertEqual(pub['initiative']['children'], ['task', 'initiative', 'note', 'meeting'])
        self.assertEqual(pub['project']['children'], ['task', 'initiative', 'note', 'meeting'])
        self.assertEqual((pub['task']['list']['relation_label'], pub['task']['list']['relation_any']), ('Initiative', 'Any initiative'))
        self.assertEqual(self.tasks.public()['relation_kinds']['types'], ['task', 'initiative', 'note', 'transcription', 'meeting', 'agent', 'activity', 'project'])
        self.assertNotIn('story', self.tasks.default_folders)

    def test_same_files_and_ids_as_initiatives(self):
        for k in ('statuses', 'priorities', 'id_pattern', 'id_pad', 'external_ref'):
            self.assertEqual(self.tasks.public()[k], FOLDER_PER_TYPE.public()[k], k)
        for name, t in self.tasks.types.items():
            if name == 'project':
                continue
            # The same fields, and `project` on the types that can be in one
            them = [f for f in t.fields if f != 'project']
            self.assertEqual((t.prefix, t.folder, them), (FOLDER_PER_TYPE.types[name].prefix, FOLDER_PER_TYPE.types[name].folder,
                                                          list(FOLDER_PER_TYPE.types[name].fields)), name)
            # every type that hangs from something (traits: child) can be in a project
            self.assertEqual('project' in t.fields, name in ('initiative', 'task', 'note', 'meeting', 'agent', 'activity', 'transcription'), name)

    def test_a_vault_of_it_has_no_stories(self):
        s = Store(self.root, structure='tasks', enforce_structure=True)
        self.assertNotIn('stories', s.check()['missing_folders'])
        s.create_missing_folders()
        self.assertTrue(s.check()['ok'], s.check())
        ini = s.create('initiative', 'Launch')
        task = s.create('task', 'Write the post', {'related_to': ini['id']})
        self.assertEqual((ini['id'], task['id'], task['fields']['related_to']), ('INI-0001', 'TSK-0001', 'INI-0001'))
        with self.assertRaises(StoreError):
            s.create('story', 'Not a type here')
        # a project is related as any other, with a kind
        prj = s.create('project', 'Site', {'project_key': 'WEB'})
        s.update(task['id'], {'relations': [prj['id']], 'relation_kinds': {prj['id']: 'blocked'}})
        self.assertEqual(s.relation_kind(s.read(prj['id']), s.read(task['id'])), 'blocks')
        self.assertEqual([i['id'] for i in s.related_of(s.read(prj['id']))], [task['id']])

    def test_an_initiatives_vault_is_not_a_tasks_one_nor_the_other_way(self):
        for d in FOLDER_PER_TYPE.default_folders.values():
            os.makedirs(os.path.join(self.root, d), exist_ok=True)
        self.assertTrue(Store(self.root, structure='folders').check()['ok'])
        self.assertFalse(Store(self.root, structure='tasks').check()['ok'])  # stories/ is a folder it does not have
        os.rmdir(os.path.join(self.root, 'stories'))
        self.assertTrue(Store(self.root, structure='tasks').check()['ok'])
        self.assertFalse(Store(self.root, structure='folders').check()['ok'])  # stories/ is missing


class TasksProjectTest(unittest.TestCase):
    """A Tasks vault's project: PRJ-0001 in projects/ (optional), its key fixed once made, the work in it by `project`."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        self.s = Store(self.root, structure='tasks', enforce_structure=True)
        self.s.create_missing_folders()

    def test_a_vault_from_before_projects_still_matches(self):
        self.assertTrue(self.s.check()['ok'], self.s.check())
        self.assertNotIn('projects', self.s.check()['missing_folders'])

    def test_a_project_is_a_file_with_its_key_its_own_statuses_and_sections(self):
        p = self.s.create('project', 'Website', {'project_key': 'web', 'local_path': '~/code/web', 'start': '2026-11-09',
                                                 'due': '2026-12-31', 'plan_month': '2026-11'})
        self.assertEqual((p['id'], p['path']), ('PRJ-0001', 'projects/PRJ-0001-website.md'))
        f = p['fields']
        self.assertEqual((f['project_key'], f['status'], f['priority'], f['start'], f['due'], f['plan_month']),
                         ('WEB', 'Backlog', 'Normal', '2026-11-09', '2026-12-31', '2026-11'))
        self.assertTrue(self.s.structure.types['project'].plannable)  # Planned · Start · Due, like the work it holds
        self.assertIn('## Goal', p['body'])
        self.assertEqual(self.s.structure.groups_of('project'), {'Backlog': 'not_started', 'ToDo': 'not_started', 'OnHold': 'in_progress',
                                                                 'InProgress': 'in_progress', 'Done': 'closed', 'Discarded': 'closed'})
        self.assertTrue(self.s.update('PRJ-0001', {'status': 'Done'})['fields']['completed_at'])
        with self.assertRaises(StoreError):
            self.s.update('PRJ-0001', {'status': 'Review'})  # a work item's, not a project's
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_its_key_is_two_to_four_capitals_unique_and_fixed(self):
        self.s.create('project', 'Website', {'project_key': 'WEB'})
        for bad in ('', 'W', 'WEBSITE', 'W3B'):
            with self.subTest(bad), self.assertRaises(StoreError):
                self.s.create('project', 'Other', {'project_key': bad})
        with self.assertRaises(StoreError) as cm:
            self.s.create('project', 'Other', {'project_key': 'web'})
        self.assertEqual(cm.exception.status, 409)
        self.assertEqual(self.s.update('PRJ-0001', {'project_key': 'OPS', 'subject': 'Site'})['fields']['project_key'], 'WEB')

    def test_work_is_in_a_project_by_its_key_and_can_move(self):
        self.s.create('project', 'Website', {'project_key': 'WEB'})
        self.s.create('project', 'Operations', {'project_key': 'OPS'})
        ini = self.s.create('initiative', 'Redesign', {'project': 'WEB'})
        task = self.s.create('task', 'Pick a font', {'project': 'WEB', 'related_to': ini['id']})
        loose = self.s.create('task', 'Renew the domain', {'project': 'OPS'})  # no initiative needed
        self.assertEqual((task['id'], task['fields']['project'], loose['fields']['related_to']), ('TSK-0001', 'WEB', None))
        self.assertEqual(self.s.update(task['id'], {'project': 'OPS'})['fields']['project'], 'OPS')
        self.assertIsNone(self.s.update(task['id'], {'project': ''})['fields']['project'])
        with self.assertRaises(StoreError):
            self.s.create('note', 'N', {'project': 'NOPE'})
        with self.assertRaises(StoreError):
            self.s.update(task['id'], {'project': 'NOPE'})
        self.assertIsNone(self.s.create('prompt', 'P', {'project': 'WEB'})['fields'].get('project'))  # not a type that is in one

    def test_claude_starts_in_the_projects_folder(self):
        other = tempfile.TemporaryDirectory()  # outside the vault: a folder there would not be one of its structure
        self.addCleanup(other.cleanup)
        code = other.name
        self.s.create('project', 'Website', {'project_key': 'WEB', 'local_path': code})
        task = self.s.create('task', 'Pick a font', {'project': 'WEB'})
        self.assertEqual(self.s.claude_cwd(task['id'])['path'], os.path.realpath(code))

    def test_initiatives_has_no_projects(self):
        self.assertNotIn('project', FOLDER_PER_TYPE.types)
        self.assertNotIn('project', FOLDER_PER_TYPE.types['task'].fields)


class ProjectsPromptsAndTranscriptionsTest(unittest.TestCase):
    """Projects (Ticketing) has prompts and transcriptions, at the top of the vault like the agents: optional folders."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        for d in ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log'):
            os.makedirs(os.path.join(self.root, d))
        self.s = Store(self.root, structure='ticketing', enforce_structure=True)

    def read(self, rel):
        with open(os.path.join(self.root, rel), encoding='utf-8') as f:
            return f.read()

    def test_a_vault_from_before_them_still_matches(self):
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_a_prompt_is_a_file_of_its_own_with_no_parent(self):
        p = self.s.create('prompt', 'Weekly review', {'labels': ['ops']}, 'List what I closed this week.\n')
        self.assertEqual(p['path'], 'Prompts/PRM-1 Weekly review.md')
        text = self.read(p['path'])
        self.assertIn('fileClass: Ticket Prompt', text)
        self.assertNotIn('related_to', text)
        self.assertIn('List what I closed this week.', text)
        t = self.s.structure.types['prompt']
        self.assertEqual((t.relatable, t.convertible, t.parents), (False, False, ()))
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_a_transcription_hangs_from_its_meeting(self):
        m = self.s.create('meeting', 'Kick-off', {'date': '2026-11-06'})
        tr = self.s.create('transcription', 'Kick-off transcript', {'related_to': m['id']}, 'Ana: hello.\n')
        self.assertEqual(tr['path'], 'Transcriptions/TRN-2 Kick-off transcript.md')
        self.assertIn('related_to: "[[MTG-1 Kick-off]]"', self.read(tr['path']))
        self.assertEqual(self.s.read(tr['key'])['fields']['related_to'], m['id'])
        with self.assertRaises(StoreError):
            self.s.create('transcription', 'Of a note', {'related_to': self.s.create('note', 'N')['id']})
        self.assertTrue(self.s.check()['ok'], self.s.check())


class PageCopyTest(unittest.TestCase):
    def test_the_pages_copies_are_the_servers(self):
        """static/js/structure.js: Projects, what the page shows before it has its vault's structure, and the legacy
        folder-per-type one most node tests run on (tools/sync_structure_js.py writes both)."""
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'static', 'js', 'structure.js')
        with open(path, encoding='utf-8') as f:
            text = f.read()
        for name, structure in (('PROJECTS', get('ticketing')), ('FOLDER_PER_TYPE', FOLDER_PER_TYPE)):
            start = text.index(f'export const {name} = ') + len(f'export const {name} = ')
            literal = text[start:text.index('\n};\n', start) + 2]
            self.assertEqual(json.loads(literal), json.loads(json.dumps(structure.public())), name)


class StoreDefaultsToFolderPerTypeTest(unittest.TestCase):
    def test_a_store_without_a_structure_is_folder_per_type(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertIs(Store(root).structure, FOLDER_PER_TYPE)
            self.assertIs(Store(root, structure='folders').structure, FOLDER_PER_TYPE)
            self.assertIn('- Ticket: #4521', Store(root).claude_prompt(Store(root).create('story', 'S', {'ticket_id': '4521'})['id']))


if __name__ == '__main__':
    unittest.main()
