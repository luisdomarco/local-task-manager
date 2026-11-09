"""tools/migrate_structures.py: a folder-per-type vault (Initiatives, Tasks) moved to the Projects structure, into a new
folder, on temp copies only. The source is never written; the new vault is whole (--check) and the app reads it."""
import io
import json
import os
import shutil
import tempfile
import unittest

from tm import frontmatter as fm
from tm.store import Store
from tools import migrate_structures as mig

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLE = os.path.join(APP, 'sample-vault-legacy')


def read(root, rel):
    with open(os.path.join(root, rel), encoding='utf-8') as f:
        return f.read()


def head(root, rel):
    return fm.parse(fm.split(read(root, rel))[0])


def confirm(plan, **projects):
    """The user's answers: every project confirmed (renamed or re-kinded as `projects` says), every question answered."""
    for p in plan['projects']:
        p.update(projects.get(p['key'], {}))
        p['confirmed'] = True
    for q in plan['questions']:
        q['answered'] = True
    return plan


def find(root, prefix):
    """The one file under `root` whose name starts with `prefix` (an id), relative to it."""
    hits = [os.path.relpath(os.path.join(d, n), root) for d, _, ns in os.walk(root) for n in ns
            if n.startswith(prefix) and '.task-manager' not in d]
    assert len(hits) == 1, (prefix, hits)
    return hits[0]


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = tmp.name
        self.src = os.path.join(self.tmp, 'vault')
        self.dst = os.path.join(self.tmp, 'vault-projects')

    def plan(self, structure='folders'):
        return mig.make_plan(self.src, structure)

    def apply(self, plan, **kw):
        mig.apply_plan(plan, out=io.StringIO(), **kw)

    def check(self, plan):
        return mig.check(plan, out=io.StringIO())


class InitiativesVaultTest(Base):
    """The sample Initiatives vault: no sub-initiatives, so its initiatives go to one proposed project, asked about."""

    def setUp(self):
        super().setUp()
        shutil.copytree(SAMPLE, self.src)

    def test_the_plan_proposes_a_project_and_asks_where_each_initiative_goes(self):
        plan = self.plan()
        self.assertEqual([(p['key'], p['kind'], p['confirmed']) for p in plan['projects']], [('GEN', 'product', False)])
        self.assertEqual(plan['assign'], {'INI-0001': 'GEN', 'INI-0002': 'GEN', 'US-0001': 'GEN', 'US-0002': 'GEN'})
        self.assertEqual([q['about'] for q in plan['questions']], ['INI-0001', 'INI-0002'])
        self.assertEqual(plan['id_map'], {'INI-0001': 'GEN-INI-0001', 'INI-0002': 'GEN-INI-0002',
                                          'US-0001': 'GEN-STY-0001', 'US-0002': 'GEN-STY-0002'})
        self.assertEqual(plan['counts']['task'], 7)
        self.assertFalse(os.path.exists(self.dst))

    def test_nothing_is_written_until_every_project_and_question_is_settled(self):
        plan = self.plan()
        with self.assertRaisesRegex(mig.PlanError, 'confirmed'):
            self.apply(plan)
        for p in plan['projects']:
            p['confirmed'] = True
        with self.assertRaisesRegex(mig.PlanError, 'answered'):
            self.apply(plan)
        self.assertFalse(os.path.exists(self.dst))

    def test_the_new_vault_is_whole_and_the_source_untouched(self):
        before = mig.digest(self.src)
        plan = confirm(self.plan(), GEN={'name': 'Pricing'})
        self.apply(plan)
        self.assertEqual(self.check(plan), [])
        self.assertEqual(mig.digest(self.src), before)
        ini = find(self.dst, 'GEN-INI-0001')
        self.assertEqual(ini, os.path.join('Pricing', 'Initiatives', 'GEN-INI-0001 Pricing revamp.md'))
        f = head(self.dst, ini)
        self.assertEqual((f['fileClass'], f['status_ticket'], f['priority'], f['project']),
                         ('Ticket Initiative', '4. InProgress', 'P1', '[[00 Pricing]]'))
        self.assertEqual(f['aliases'], ['INI-0001'])
        self.assertEqual(f['ticket_id'], '4521')  # what the format knows too, carried over
        self.assertIn('## Goal\n\nSimplify pricing to three plans.', read(self.dst, ini))  # the body as it was
        story = head(self.dst, find(self.dst, 'GEN-STY-0001'))
        self.assertEqual((story['fileClass'], story['initiative']), ('Ticket Story', '[[GEN-INI-0001 Pricing revamp]]'))
        task = head(self.dst, find(self.dst, 'TSK-0002'))  # a root type keeps its id, and takes its parent's project
        self.assertEqual((task['related_to'], task['project']), ('[[GEN-INI-0001 Pricing revamp]]', '[[00 Pricing]]'))
        self.assertNotIn('aliases', task)
        note = head(self.dst, find(self.dst, 'NOTE-0001'))
        self.assertTrue(note['related_to'].startswith('[['))
        project = head(self.dst, os.path.join('Pricing', '00 Pricing.md'))
        self.assertEqual((project['project_key'], project['project_kind']), ('GEN', 'product'))
        self.assertTrue(os.path.isdir(os.path.join(self.dst, 'Pricing', 'Stories')))
        self.assertTrue(os.path.isfile(os.path.join(self.dst, 'Docs', 'Handbook', 'Pricing principles.md')))

    def test_the_work_log_and_the_ids_follow_the_id_map(self):
        plan = confirm(self.plan())
        self.apply(plan)
        day = read(self.dst, os.path.join('Work log', '2026', '2026-10-19.md'))
        self.assertIn('"id": "GEN-INI-0001"', day)
        self.assertIn('· GEN-INI-0001 Pricing revamp', day)
        self.assertNotIn('INI-0001 ', day.replace('GEN-INI-0001 ', ''))
        marks = json.loads(read(self.dst, '.task-manager/ids.json'))
        self.assertEqual((marks['TSK'], marks['GEN-INI'], marks['GEN-STY']), (7, 2, 2))
        self.assertNotIn('INI', marks)
        self.assertEqual(json.loads(read(self.dst, '.task-manager/legacy-ids.json'))['US-0002'], 'GEN-STY-0002')
        # The app reads it, and a new initiative of the project gets a number never used.
        store = Store(self.dst, structure='ticketing')
        self.assertTrue(store.check()['ok'])
        self.assertEqual(store.create('initiative', 'Next', {'project': 'GEN'})['id'], 'GEN-INI-003')

    def test_it_refuses_a_source_changed_since_the_plan_and_a_target_not_empty(self):
        plan = confirm(self.plan())
        os.makedirs(self.dst)
        open(os.path.join(self.dst, 'x.md'), 'w').close()
        with self.assertRaisesRegex(mig.PlanError, 'not empty'):
            self.apply(plan)
        shutil.rmtree(self.dst)
        with open(os.path.join(self.src, 'tasks', 'TSK-0001-benchmark-competitor-pricing.md'), 'a') as f:
            f.write('\nmore\n')
        with self.assertRaisesRegex(mig.PlanError, 'changed since the plan'):
            self.apply(plan)

    def test_bodies_keep_old_ids_unless_asked(self):
        rel = os.path.join('notes', 'NOTE-0001-pricing-ideas.md')
        with open(os.path.join(self.src, rel), 'a') as f:
            f.write('\nSee INI-0001 and US-0002; TSK-0001 stays.\n')
        plan = confirm(self.plan())
        self.assertEqual(plan['mentions'], [{'path': rel, 'ids': ['INI-0001', 'US-0002']}])
        self.apply(plan)
        self.assertIn('See INI-0001 and US-0002', read(self.dst, find(self.dst, 'NOTE-0001')))
        shutil.rmtree(self.dst)
        self.apply(plan, rewrite_bodies=True)
        self.assertIn('See GEN-INI-0001 and GEN-STY-0002; TSK-0001 stays.', read(self.dst, find(self.dst, 'NOTE-0001')))

    def test_a_story_cannot_go_to_a_project_without_stories(self):
        plan = confirm(self.plan(), GEN={'kind': 'simple'})
        with self.assertRaisesRegex(mig.PlanError, 'kind simple'):
            self.apply(plan)


class SafeAgainstTest(Base):
    """What the review of the tool found: links, partial writes, statuses, placeholders, ids, titles and names."""

    def setUp(self):
        super().setUp()
        shutil.copytree(SAMPLE, self.src)

    def edit(self, rel, **fields):
        path = os.path.join(self.src, rel)
        with open(path, encoding='utf-8') as f:
            text = f.read()
        with open(path, 'w', encoding='utf-8') as f:
            f.write(fm.patch(text, fields))

    def test_wikilinks_to_renamed_files_follow_them_in_bodies_and_docs(self):
        note = os.path.join(self.src, 'notes', 'NOTE-0001-pricing-ideas.md')
        with open(note, 'a', encoding='utf-8') as f:
            f.write('\nSee [[TSK-0001-benchmark-competitor-pricing]] and [[INI-0001-pricing-revamp|the initiative]].\n')
        with open(os.path.join(self.src, 'docs', 'Handbook', 'Links.md'), 'w', encoding='utf-8') as f:
            f.write('Read [[INI-0001-pricing-revamp#Goal]].\n')
        plan = confirm(self.plan())
        self.assertEqual(plan['linked'], 1)
        self.apply(plan, rewrite_bodies=True)  # its ids rewritten too: never inside a link
        body = read(self.dst, find(self.dst, 'NOTE-0001'))
        tsk = os.path.splitext(os.path.basename(find(self.dst, 'TSK-0001')))[0]
        ini = os.path.splitext(os.path.basename(find(self.dst, 'GEN-INI-0001')))[0]
        self.assertIn(f'See [[{tsk}]] and [[{ini}|the initiative]].', body)
        self.assertEqual(read(self.dst, os.path.join('Docs', 'Handbook', 'Links.md')), f'Read [[{ini}#Goal]].\n')
        self.assertEqual(self.check(plan), [])
        with open(os.path.join(self.dst, find(self.dst, 'NOTE-0001')), 'a', encoding='utf-8') as f:
            f.write('\n[[TSK-0002-draft-pricing-tiers]]\n')  # a link the tool did not write: --check says so
        self.assertTrue(any('a file of the old vault' in p for p in self.check(plan)))

    def test_an_error_while_writing_leaves_no_folder_behind(self):
        plan = confirm(self.plan())
        real = mig._meta
        mig._meta = lambda *a: 1 / 0
        try:
            with self.assertRaises(ZeroDivisionError):
                self.apply(plan)
        finally:
            mig._meta = real
        self.assertFalse(os.path.exists(self.dst))
        self.assertFalse(os.path.exists(self.dst + '.partial'))
        self.apply(plan)  # and the next run goes through
        self.assertEqual(self.check(plan), [])

    def test_every_initiative_and_story_needs_a_project_and_a_story_its_initiatives(self):
        plan = confirm(self.plan())
        del plan['assign']['US-0002']
        with self.assertRaisesRegex(mig.PlanError, 'US-0002'):
            self.apply(plan)
        plan = confirm(self.plan())
        plan['projects'].append({'key': 'WEB', 'name': 'Web', 'kind': 'product', 'from': None, 'confirmed': True, 'why': ''})
        plan['assign']['US-0001'] = 'WEB'
        with self.assertRaisesRegex(mig.PlanError, 'project of its initiative'):
            self.apply(plan)
        self.assertFalse(os.path.exists(self.dst))

    def test_a_status_the_projects_structure_lacks_is_asked_for(self):
        self.edit(os.path.join('tasks', 'TSK-0001-benchmark-competitor-pricing.md'), status='Waiting')
        plan = self.plan()
        self.assertEqual(plan['status_map'], {'Waiting': None})
        self.assertIn('status Waiting', [q['about'] for q in plan['questions']])
        confirm(plan)
        with self.assertRaisesRegex(mig.PlanError, 'status_map'):
            self.apply(plan)
        plan['status_map']['Waiting'] = 'OnHold'
        self.apply(plan)
        self.assertEqual(head(self.dst, find(self.dst, 'TSK-0001'))['status_ticket'], '3. OnHold')

    def test_it_refuses_icloud_placeholders_anywhere_and_items_without_an_id(self):
        os.makedirs(os.path.join(self.src, '.task-manager'), exist_ok=True)
        open(os.path.join(self.src, '.task-manager', '.ids.json.icloud'), 'w').close()
        with self.assertRaisesRegex(mig.PlanError, 'iCloud'):
            self.plan()
        os.remove(os.path.join(self.src, '.task-manager', '.ids.json.icloud'))
        with open(os.path.join(self.src, 'tasks', 'hand-written.md'), 'w', encoding='utf-8') as f:
            f.write('---\ntype: task\nsubject: "Hand written"\n---\n')
        with self.assertRaisesRegex(mig.PlanError, 'without an id'):
            self.plan()

    def test_a_title_a_file_name_cannot_hold_is_listed_and_kept_in_its_aliases(self):
        self.edit(os.path.join('initiatives', 'INI-0002-onboarding-emails.md'), subject='Onboarding: emails?')
        plan = self.plan()
        self.assertIn({'id': 'INI-0002', 'title': 'Onboarding: emails?', 'as': 'Onboarding emails'}, plan['retitled'])
        self.assertIn({'id': 'TSK-0005', 'title': 'Set up pricing A/B test', 'as': 'Set up pricing A B test'}, plan['retitled'])
        self.apply(confirm(plan))
        self.assertIn('Onboarding: emails?', head(self.dst, find(self.dst, 'GEN-INI-0002'))['aliases'])

    def test_a_project_is_not_named_as_a_vault_folder_nor_twice_but_for_capitals(self):
        for names, says in ((['Tasks'], 'folder of the vault'), (['Web', 'web'], 'share a name')):
            plan = confirm(self.plan())
            plan['projects'] = [{'key': k, 'name': n, 'kind': 'product', 'from': None, 'confirmed': True, 'why': ''}
                                for k, n in zip(('GEN', 'WEB'), names)]
            with self.subTest(names), self.assertRaisesRegex(mig.PlanError, says):
                self.apply(plan)


class EpicsTest(Base):
    """An initiative with sub-initiatives proposes a project; Blocked becomes On hold; trashed ids still count."""

    def setUp(self):
        super().setUp()
        shutil.copytree(SAMPLE, self.src)
        s = Store(self.src, structure='folders')
        s.update('INI-0002', {'related_to': 'INI-0001', 'status': 'ToDo'})  # an epic of INI-0001 (its change in its history)
        s.update('TSK-0003', {'status': 'Blocked'})
        s.update('US-0002', {'relations': ['US-0001'], 'relation_kinds': {'US-0001': 'blocked'}})
        gone = s.create('task', 'Thrown away')
        s.delete(gone['id'])  # TSK-0008, in the trash
        # A vault from before ids.json had no mark of it: only the trash says TSK-0008 was used.
        marks = os.path.join(self.src, '.task-manager', 'ids.json')
        with open(marks, encoding='utf-8') as f:
            kept = {k: v for k, v in json.load(f).items() if k != 'TSK'}
        with open(marks, 'w', encoding='utf-8') as f:
            json.dump(kept, f)

    def test_an_initiative_with_epics_becomes_a_project_and_its_epics_relate_to_it(self):
        plan = self.plan()
        self.assertEqual([(p['key'], p['name'], p['kind'], p['from']) for p in plan['projects']],
                         [('PR', 'Pricing revamp', 'product', 'INI-0001')])
        self.assertEqual(plan['questions'], [])
        self.assertEqual(plan['high_water']['TSK'], 8)
        self.apply(confirm(plan))
        self.assertEqual(self.check(plan), [])
        epic = head(self.dst, find(self.dst, 'PR-INI-0002'))
        self.assertEqual(epic['relations'], ['[[PR-INI-0001 Pricing revamp]]'])
        self.assertNotIn('initiative', epic)
        self.assertEqual(json.loads(read(self.dst, '.task-manager/ids.json'))['TSK'], 8)
        # Each item's history (what the app recorded of its changes) under its new id.
        self.assertTrue(os.path.isfile(os.path.join(self.dst, '.task-manager', 'history', 'PR-INI-0002.md')))

    def test_blocked_becomes_on_hold_and_blocked_by_goes_to_depends_on(self):
        plan = confirm(self.plan())
        self.apply(plan)
        task = head(self.dst, find(self.dst, 'TSK-0003'))
        self.assertEqual(task['status_ticket'], '3. OnHold')
        self.assertEqual(task['on_hold']['why'], 'Blocked (migrated)')
        story = head(self.dst, find(self.dst, 'PR-STY-0002'))
        self.assertEqual(story['depends_on'], ['[[PR-STY-0001 As a buyer I see three plans side by side]]'])
        self.assertFalse(story.get('relations'))


class TasksVaultTest(Base):
    """A Tasks vault, built here: its projects become projects (simple), by their key; the PRJ id names the key."""

    def setUp(self):
        super().setUp()
        os.makedirs(self.src)
        s = Store(self.src, structure='tasks')
        for d in ('tasks', 'initiatives', 'notes', 'meetings', 'inbox', 'activities', 'prompts', 'transcriptions', 'worklog'):
            os.makedirs(os.path.join(self.src, d), exist_ok=True)
        self.prj = s.create('project', 'Operations', {'project_key': 'OPS', 'priority': 'High'}, body='## Goal\n\nKeep it running.\n')
        self.ini = s.create('initiative', 'Backups', {'project': 'OPS', 'priority': 'Urgent'})
        s.create('task', 'Test a restore', {'related_to': self.ini['id']})
        s.create('task', 'Buy milk')
        s.log_work(self.prj['id'], 'Management', 'weekly', time='00:15')

    def test_its_projects_become_simple_projects_and_its_work_follows(self):
        plan = self.plan('tasks')
        self.assertEqual([(p['key'], p['name'], p['kind'], p['from']) for p in plan['projects']],
                         [('OPS', 'Operations', 'simple', self.prj['id'])])
        self.assertEqual(plan['assign'], {self.ini['id']: 'OPS'})
        self.assertEqual(plan['id_map'], {self.prj['id']: 'OPS', self.ini['id']: 'OPS-INI-0001'})
        self.apply(confirm(plan))
        self.assertEqual(self.check(plan), [])
        note = head(self.dst, os.path.join('Operations', '00 Operations.md'))
        self.assertEqual((note['project_key'], note['project_kind'], note['priority'], note['aliases']),
                         ('OPS', 'simple', 'P1', [self.prj['id']]))
        self.assertIn('Keep it running.', read(self.dst, os.path.join('Operations', '00 Operations.md')))
        ini = head(self.dst, find(self.dst, 'OPS-INI-0001'))
        self.assertEqual((ini['priority'], ini['project']), ('P0', '[[00 Operations]]'))
        self.assertEqual(head(self.dst, find(self.dst, 'TSK-0001'))['project'], '[[00 Operations]]')
        self.assertFalse(head(self.dst, find(self.dst, 'TSK-0002')).get('project'))
        day = next(os.path.join(d, n) for d, _, ns in os.walk(os.path.join(self.dst, 'Work log')) for n in ns)
        self.assertIn('"id": "OPS"', read(self.dst, day))


class CommandLineTest(Base):
    def test_plan_then_apply_then_check(self):
        shutil.copytree(SAMPLE, self.src)
        out = io.StringIO()
        self.assertEqual(mig.main(['--plan', self.src, '--structure', 'folders'], out=out), 0)
        path = f'{self.dst}.migration-plan.json'
        self.assertIn('? Which project does INI-0001', out.getvalue())
        self.assertEqual(mig.main(['--apply', path], out=io.StringIO()), 2)  # nothing confirmed yet
        with open(path, encoding='utf-8') as f:
            plan = confirm(json.load(f))
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(plan, f)
        self.assertEqual(mig.main(['--apply', path], out=io.StringIO()), 0)
        out = io.StringIO()
        self.assertEqual(mig.main(['--check', path], out=out), 0)
        self.assertIn('✓', out.getvalue())


if __name__ == '__main__':
    unittest.main()
