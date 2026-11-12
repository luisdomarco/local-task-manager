"""tools/migrate_short_ids.py: a Projects vault with long ids (ACME-INI-001) moved to short ones (a number, drawn
INI-482) in a NEW folder, the source never written (plans/short-ids.md, docs/migrate-short-ids.md)."""

import io
import json
import os
import shutil
import tempfile
import unittest

from tm.store import Store
from tm.structures.ticketing.definition import ROOT_FOLDERS, WORKLOG_FOLDER
from tools import migrate_short_ids as mig


def read(root, rel):
    with open(os.path.join(root, rel), encoding='utf-8') as f:
        return f.read()


def write(root, rel, text):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def snapshot(root):
    out = {}
    for here, _, files in os.walk(root):
        for name in files:
            full = os.path.join(here, name)
            with open(full, 'rb') as f:
                out[os.path.relpath(full, root)] = f.read()
    return out


class MigrateBase(unittest.TestCase):
    """A vault from before short ids: two projects, every kind of link, a plan, the work log, a history, pins, a doc
    that links to a ticket, a text that names an id in passing, an id from an older migration, the trash, and a plan
    and an analysis from before they had ids (named after their item and their date)."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = tmp.name
        self.src = os.path.join(self.dir, 'Tickets')
        for d in [*ROOT_FOLDERS.values(), WORKLOG_FOLDER]:
            os.makedirs(os.path.join(self.src, d))
        write(self.src, '.task-manager/ids.json', '{"TSK": 40}\n')  # a task numbered 40 was purged long ago
        s = Store(self.src, structure='ticketing', enforce_structure=True)
        s.create('project', 'Acme Web', {'project_key': 'ACME', 'project_kind': 'product'})
        s.create('project', 'Internal Tools', {'project_key': 'OPS', 'project_kind': 'system'})
        # Titled by a heading of its id, as every item was before default texts: the move renames it with the id.
        self.ini = s.create('initiative', 'Checkout', {'project': 'ACME'},
                            '# ACME-INI-001 — Checkout\n\n## Goal\n\nSee ACME-SUP-001 and [[TSK-041 Map it]].\n')
        self.sty = s.create('story', 'One page', {'project': 'ACME', 'related_to': self.ini['id']})
        self.sup = s.create('support', 'Empty invoice', {'project': 'ACME'})
        self.ops = s.create('initiative', 'Faster deploys', {'project': 'OPS'})
        self.task = s.create('task', 'Map it', {'project': 'ACME', 'related_to': self.ini['id']})
        self.gone = s.create('note', 'Old note', {})
        self.plan_item = s.create('plan', 'Plan', {'project': 'ACME', 'related_to': self.ini['id']})
        s.update(self.sty['key'], {'priority': 'P1'}, by='owner')  # a history file
        s.log_work(self.task['id'], 'Analysis', '', '2026-11-01', time='00:30')
        s.save_pins([self.ini['id'], self.task['id']])
        s.delete(self.gone['key'])
        write(self.src, 'Docs/Team/How we ship.md', '# How we ship\n\nStart from [[ACME-INI-001 Checkout|the checkout]].\n')
        write(self.src, 'Docs/Canvases/ACME-INI-001/Flow.excalidraw.md', '---\nexcalidraw-plugin: parsed\n---\n\n'
              '## Element Links\nabc: [[ACME-INI-001 Checkout]]\n')  # its Canvas tab's
        # The initiative came from an Initiatives vault (tools/migrate_structures.py): its first id is an alias.
        path = os.path.join(self.src, self.ini['path'])
        write(self.src, self.ini['path'], read(self.src, self.ini['path']).replace('aliases: []', 'aliases: [INI-0007]'))
        write(self.src, '.task-manager/legacy-ids.json', json.dumps({'INI-0007': 'ACME-INI-001'}) + '\n')
        # The story is the oldest: it gets the first number.
        write(self.src, self.sty['path'], read(self.src, self.sty['path']).replace(
            f"creation_date: {self.sty['fields']['created_at'][:10]}", 'creation_date: 2025-01-01'))
        # A plan and an analysis from before they had ids, as the templates wrote them then; the initiative links both.
        self.old_plan = 'Acme Web/Plans/ACME-INI-001 Plan.md'
        write(self.src, self.old_plan, '---\nfileClass: Ticket Plan\nitem: "[[ACME-INI-001 Checkout]]"\nproject: "[[00 Acme Web]]"\n'
              'lane: normal\ntags: []\ncreation_date: 2026-10-01\nupdated_date: 2026-10-01\n---\n\n'
              '# ACME-INI-001 — Plan: Checkout\n\nSteps.\n')
        self.old_analysis = 'Acme Web/Analyses/2026-10-12 Revisión P1.md'
        write(self.src, self.old_analysis, '---\nfileClass: Ticket Analysis\ntitle: "Revisión: P1"\nproject: "[[00 Acme Web]]"\n'
              'kind: review\nitem: "[[ACME-INI-001 Checkout]]"\ntags: []\ncreation_date: 2026-10-12\nupdated_date: 2026-10-12\n'
              '---\n\n# Revisión: P1\n\nFacts.\n')
        write(self.src, '.task-manager/history/' + mig.history_name(self.old_analysis) + '.md',  # its history, by its path
              f'---\ntype: history\nitem: "{self.old_analysis}"\nentries: []\n---\n')
        write(self.src, self.ini['path'], read(self.src, self.ini['path']).replace(
            'related_analyses: []', 'related_analyses: ["[[2026-10-12 Revisión P1]]"]'))
        self.assertTrue(os.path.isfile(path))
        self.new = os.path.join(self.dir, 'Tickets-short')
        self.before = snapshot(self.src)

    def plan(self, **kw):
        return mig.make_plan(self.src, self.new, **kw)

    def migrate(self, rewrite_bodies=False):
        plan = self.plan()
        mig.apply_plan(plan, rewrite_bodies, out=io.StringIO())
        return plan


class PlanTest(MigrateBase):
    def test_numbers_start_above_every_old_number_oldest_first(self):
        plan = self.plan()
        self.assertEqual(plan['start'], 42)  # above TSK-041 and the purged 40
        self.assertEqual(plan['id_map'][self.sty['id']], '42')
        self.assertEqual(plan['refs'][self.sty['id']], 'STY-42')
        numbers = [*plan['id_map'].values(), *(a['number'] for a in plan['annexes'])]
        self.assertEqual(sorted(numbers, key=int), [str(n) for n in range(42, 42 + len(numbers))])
        self.assertEqual(plan['top'], 42 + len(numbers) - 1)
        self.assertNotIn(self.gone['id'], plan['id_map'])  # in the trash: its long id stays, and counts
        self.assertEqual(snapshot(self.src), self.before)  # the plan writes nothing into the source

    def test_it_lists_the_texts_that_name_an_old_id_in_passing(self):
        plan = self.plan()
        self.assertEqual(plan['mentions'], [{'path': self.ini['path'], 'ids': [self.sup['id']]}])

    def test_start_may_go_higher_never_lower(self):
        self.assertEqual(self.plan(start=100)['start'], 100)
        with self.assertRaises(mig.PlanError):
            self.plan(start=10)


class ApplyTest(MigrateBase):
    def test_the_new_vault_is_whole_and_the_source_untouched(self):
        plan = self.migrate()
        out = io.StringIO()
        self.assertEqual(mig.check(plan, out=out), [], out.getvalue())
        self.assertEqual(snapshot(self.src), self.before)
        s = Store(self.new, structure='ticketing', enforce_structure=True)
        self.assertTrue(s.numbered())
        self.assertEqual(s.create('task', 'Next', {})['id'], str(plan['top'] + 1))

    def test_an_item_file_changes_only_in_its_id_its_aliases_its_links_and_its_heading(self):
        plan = self.migrate()
        ref = plan['refs'][self.ini['id']]
        new_rel = f'Acme Web/Initiatives/{ref} Checkout.md'
        old, new = read(self.src, self.ini['path']).split('\n'), read(self.new, new_rel).split('\n')
        self.assertEqual(len(old), len(new))
        changed = [b for a, b in zip(old, new) if a != b]
        number = plan['id_map'][self.ini['id']]
        # Its id, its aliases, its first heading and the lines with a wikilink to a renamed file; nothing else.
        self.assertTrue(all(b.startswith(('id:', 'aliases:', f'# {ref} — ')) or '[[' in b for b in changed), changed)
        self.assertIn(f'id: {number}', '\n'.join(new))
        self.assertIn(f'aliases: ["INI-0007", "{self.ini["id"]}"]', '\n'.join(new))
        self.assertIn(f'# {ref} — Checkout', new)
        self.assertIn('See ACME-SUP-001 and [[TSK-', '\n'.join(new))  # a mention stays; the wikilink follows the file

    def test_plans_and_analyses_from_before_ids_get_one_oldest_first(self):
        plan = self.plan()
        self.assertEqual([(a['path'], a['type'], a['number']) for a in plan['annexes']],
                         [(self.old_plan, 'plan', '43'), (self.old_analysis, 'analysis', '44')])  # after the story (2025)
        self.assertIn([self.old_plan, f"Acme Web/Plans/PLN-43 {plan['refs'][self.ini['id']]} Plan.md"], plan['renames'])
        self.assertIn([self.old_analysis, 'Acme Web/Analyses/ANL-44 Revisión P1.md'], plan['renames'])

    def test_links_docs_plans_follow_their_files(self):
        plan = self.migrate()
        ini, sty, task = (plan['refs'][x['id']] for x in (self.ini, self.sty, self.task))
        self.assertEqual(plan['refs'][self.plan_item['id']], f"PLN-{plan['id_map'][self.plan_item['id']]}")  # a plan with an id
        old_plan = read(self.new, f'Acme Web/Plans/PLN-43 {ini} Plan.md')  # one from before: its number, after its item
        self.assertIn('\nid: 43', old_plan)
        self.assertIn(f'# {ini} — Plan: Checkout', old_plan)
        self.assertIn(f'item: "[[{ini} Checkout]]"', old_plan)
        analysis = read(self.new, 'Acme Web/Analyses/ANL-44 Revisión P1.md')
        self.assertEqual(analysis, read(self.src, self.old_analysis).replace(
            'fileClass: Ticket Analysis\n', 'fileClass: Ticket Analysis\nid: 44'.ljust(66) + '# its number, drawn ANL-<n>\n').replace(
            '[[ACME-INI-001 Checkout]]', f'[[{ini} Checkout]]'))  # its id line and its link; nothing else
        self.assertIn('item: "44"', read(self.new, '.task-manager/history/44.md'))  # its history follows it
        self.assertIn('related_analyses: ["[[ANL-44 Revisión P1]]"]', read(self.new, f'Acme Web/Initiatives/{ini} Checkout.md'))
        s = Store(self.new, structure='ticketing', enforce_structure=True)
        self.assertEqual((s.find('ANL-44')['title'], s.find('PLN-43')['fields']['related_to']), ('Revisión P1', plan['id_map'][self.ini['id']]))
        self.assertIn(f'[[{ini} Checkout|the checkout]]', read(self.new, 'Docs/Team/How we ship.md'))
        self.assertIn(f'abc: [[{ini} Checkout]]', read(self.new, f'Docs/Canvases/{ini}/Flow.excalidraw.md'))  # its canvases follow it
        self.assertFalse(os.path.exists(os.path.join(self.new, 'Docs/Canvases/ACME-INI-001')))
        self.assertIn(f'initiative: "[[{ini} Checkout]]"', read(self.new, f'Acme Web/Stories/{sty} One page.md'))
        self.assertIn(f'[[{task} Map it]]', read(self.new, f'Acme Web/Initiatives/{ini} Checkout.md'))

    def test_work_log_history_pins_and_the_id_maps(self):
        plan = self.migrate()
        ids, refs = plan['id_map'], plan['refs']
        day = read(self.new, 'Work log/2026/2026-11-01.md')
        self.assertIn(f'"id": "{ids[self.task["id"]]}"', day)
        self.assertIn(f'· {refs[self.task["id"]]} Map it', day)
        self.assertTrue(os.path.isfile(os.path.join(self.new, '.task-manager/history', ids[self.sty['id']] + '.md')))
        self.assertFalse(os.path.exists(os.path.join(self.new, '.task-manager/history', self.sty['id'] + '.md')))
        s = Store(self.new, structure='ticketing', enforce_structure=True)
        self.assertEqual(s.pins(), {'items': [ids[self.ini['id']], ids[self.task['id']]]})
        marks = json.loads(read(self.new, '.task-manager/ids.json'))
        self.assertEqual((marks['number'], marks['TSK']), (plan['top'], 41))
        legacy = json.loads(read(self.new, '.task-manager/legacy-ids.json'))
        self.assertEqual(legacy['INI-0007'], ids[self.ini['id']])  # an older migration's id leads to the number too
        self.assertEqual(legacy[self.sup['id']], ids[self.sup['id']])
        for old in ('INI-0007', self.ini['id'], refs[self.ini['id']], ids[self.ini['id']]):
            self.assertEqual(s.find(old)['id'], ids[self.ini['id']], old)
        self.assertEqual(len(s.trash()), 1)  # the trash comes along, its long id as it was

    def test_rewrite_bodies_names_the_new_ref(self):
        plan = self.migrate(rewrite_bodies=True)
        ref = plan['refs'][self.ini['id']]
        self.assertIn(f"See {plan['refs'][self.sup['id']]} and", read(self.new, f'Acme Web/Initiatives/{ref} Checkout.md'))


class RefusalTest(MigrateBase):
    def test_a_target_that_is_not_empty(self):
        write(self.new, 'something.md', 'x')
        with self.assertRaises(mig.PlanError):
            self.migrate()

    def test_a_run_that_stops_halfway_leaves_nothing(self):
        plan = self.plan()
        real = mig._meta
        def boom(*a):
            raise RuntimeError('stopped')
        mig._meta = boom
        try:
            with self.assertRaises(RuntimeError):
                mig.apply_plan(plan, out=io.StringIO())
        finally:
            mig._meta = real
        self.assertFalse(os.path.exists(self.new))
        self.assertFalse(os.path.exists(self.new + '.partial'))
        mig.apply_plan(plan, out=io.StringIO())  # the next run starts afresh
        self.assertEqual(mig.check(plan, out=io.StringIO()), [])

    def test_a_source_that_changed_since_the_plan(self):
        plan = self.plan()
        write(self.src, 'Tasks/note.md', 'x')
        with self.assertRaises(mig.PlanError):
            mig.apply_plan(plan, out=io.StringIO())

    def test_a_vault_with_short_ids_already(self):
        plan = self.migrate()
        with self.assertRaises(mig.PlanError):
            mig.make_plan(plan['target'], os.path.join(self.dir, 'again'))

    def test_check_says_what_is_missing(self):
        plan = self.migrate()
        os.remove(os.path.join(self.new, f"Tasks/{plan['refs'][self.task['id']]} Map it.md"))
        problems = mig.check(plan, out=io.StringIO())
        self.assertTrue(any(p.startswith('task: 1 in the source, 0') for p in problems), problems)
        self.assertTrue(any('does not find' in p for p in problems), problems)


class CommandLineTest(MigrateBase):
    def test_plan_apply_check(self):
        out = io.StringIO()
        self.assertEqual(mig.main(['--plan', self.src, '--out', self.new], out=out), 0)
        plan_file = f'{self.new}.short-ids-plan.json'
        self.assertTrue(os.path.isfile(plan_file))
        self.assertEqual(mig.main(['--apply', plan_file], out=out), 0)
        self.assertEqual(mig.main(['--check', plan_file], out=out), 0, out.getvalue())
        shutil.rmtree(self.new)
        self.assertEqual(mig.main(['--check', plan_file], out=io.StringIO()), 1)


if __name__ == '__main__':
    unittest.main()
