"""migrate_repo_roadmaps, the items phase: the HB dialects, the mapping and what --apply writes.

Each test builds a tiny source tree and a tiny Projects vault, so nothing reads or writes a real one.
"""
import io
import os
import shutil
import tempfile
import types
import unittest

from tm.store import Store
from tm.structures import REGISTRY
from tm.structures.ticketing.definition import ROOT_FOLDERS, WORKLOG_FOLDER
from tm.store import META_DIR
from tools import _roadmap_dialects as rd
from tools import migrate_repo_roadmaps as mig

INI = """---
id: {ref}
name: {slug}
date: 2026-09-28
status: {status}
priority: P1
area: hb
size: M
scope: "lo que abarca: {title} de punta a punta"
objective: "hacer algo"
premise: {premise}
premise_verified: 2026-10-01 @ abc1234
regime: {regime}
updated: 2026-10-05
approved: 2026-09-29
depends_on: {depends}
plan: {plan}
related_learnings: {learnings}
---

# {ref} — {title}

## Prior context

lo que sea
"""
SUP = """---
id: {ref}
name: {slug}
date: 2026-10-13
status: {status}
area: hb
level: C3
level_base: C3
due_from: 2026-10-13
due: 2026-11-12
origin: {origin}
signature: "manual|hb|abcd"
occurrences: 1
disposition: {disposition}
hb_sha: deadbeef
executor: claude
promoted_to: {promoted}
updated: 2026-10-14
---

# {ref} — {title}

## Síntoma

algo
"""


class ItemsPhaseTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.vault = os.path.join(self.tmp, 'vault')
        self.gh = os.path.join(self.tmp, 'github')
        for f in (*ROOT_FOLDERS.values(), WORKLOG_FOLDER):
            os.makedirs(os.path.join(self.vault, f), exist_ok=True)
        os.makedirs(os.path.join(self.vault, META_DIR), exist_ok=True)
        self.work = os.path.join(self.gh, 'work')
        for d in ('initiatives/completed', 'initiatives/on_hold', 'support/completed', 'support/discarded',
                  'plans', 'analyses', 'learnings'):
            os.makedirs(os.path.join(self.work, d), exist_ok=True)
        Store(self.vault, structure=REGISTRY['ticketing']).create(
            'project', 'Acme System', {'project_key': 'HB'}, 'x')
        # Un inventario de PRUEBA: el real no está en este repo, lo carga `--sources`.
        # Así estos casos ejercitan el mapeo sin pedir prestados dialectos ni claves de nadie.
        self.srcs = types.SimpleNamespace(
            FICHAS=os.path.join('Docs', 'Fichas'),
            PROJECTS={'HB': {'name': 'Acme System', 'kind': 'system', 'repo': '~/x/hb',
                             'managed_by': '~/x/hb/.claude', 'sources': ['work']}},
            POOL_OF_FICHA={},
            ITEM_SOURCES={'HB': [
                rd.Dialect('HB-INI', 'work/initiatives', 'initiative', 'status-folders', 'HB'),
                rd.Dialect('HB-SUP', 'work/support', 'support', 'status-folders', 'HB'),
                rd.Dialect('HB-PLN', 'work/plans', 'plan', 'flat', 'HB'),
                rd.Dialect('HB-ANL', 'work/analyses', 'analysis', 'flat', 'HB'),
                rd.Dialect('HB-LRN', 'work/learnings', 'learning', 'flat', 'HB'),
            ]},
            LEFT_IN_REPO=[],
        )
        self._saved, mig.SOURCES = mig.SOURCES, self.srcs

    def tearDown(self):
        mig.SOURCES = self._saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write(self, rel, text):
        path = os.path.join(self.work, rel)
        with io.open(path, 'w', encoding='utf-8') as fh:
            fh.write(text)
        return path

    def ini(self, folder, ref, slug, title, status='completed', premise='verified', regime='estándar',
            depends='[]', plan='""', learnings='[]'):
        return self.write(f'initiatives/{folder}/2026-09-28-{slug}.md',
                          INI.format(ref=ref, slug=slug, title=title, status=status, premise=premise,
                                     regime=regime, depends=depends, plan=plan, learnings=learnings))

    def sup(self, folder, ref, slug, title, status='completed', origin='manual', disposition='arreglar',
            promoted='""'):
        return self.write(f'support/{folder}/2026-10-13-{slug}.md',
                          SUP.format(ref=ref, slug=slug, title=title, status=status, origin=origin,
                                     disposition=disposition, promoted=promoted))

    def plan_(self):
        return mig.make_items_plan(self.vault, self.gh)

    def confirm(self, plan):
        for p in plan['projects']:
            p['confirmed'] = True
        for q in plan['questions']:
            q['answered'] = True
        return plan

    def applied(self):
        plan = self.confirm(self.plan_())
        mig.apply_items(plan, io.StringIO())
        return plan

    def item(self, ref_or_alias):
        return Store(self.vault, structure=REGISTRY['ticketing']).find(ref_or_alias)

    # ── what it reads ───────────────────────────────────────────────────
    def test_the_status_comes_from_the_folder_not_from_the_key(self):
        self.ini('completed', 'INI-001', 'uno', 'Uno', status='in_progress')   # the key lies, the folder wins
        rows = {r['old_ref']: r for r in self.plan_()['items']}
        self.assertEqual(rows['INI-001']['status'], 'Done')

    def test_templates_boards_and_docs_are_not_items(self):
        for name in ('TEMPLATE.md', 'BOARD.md', 'board-initiatives.md', 'strategy.md'):
            self.write(f'initiatives/{name}', '---\nid: X\n---\n# x\n')
        self.ini('completed', 'INI-001', 'uno', 'Uno')
        self.assertEqual([r['old_ref'] for r in self.plan_()['items']], ['INI-001'])

    def test_a_worktree_copy_is_never_read(self):
        self.ini('completed', 'INI-001', 'uno', 'Uno')
        wt = os.path.join(self.gh, 'work', '.claude', 'worktrees', 'x', 'initiatives', 'completed')
        os.makedirs(wt, exist_ok=True)
        with io.open(os.path.join(wt, '2026-09-28-uno.md'), 'w', encoding='utf-8') as fh:
            fh.write(INI.format(ref='INI-001', slug='uno', title='Uno', status='completed', premise='verified',
                                regime='estándar', depends='[]', plan='""', learnings='[]'))
        self.assertEqual(len(self.plan_()['items']), 1)

    def test_a_file_with_no_frontmatter_gets_its_title_and_date_from_itself(self):
        self.write('learnings/2026-09-29-una-leccion.md', '# 2026-09-29 — Una lección aprendida\n\ncuerpo\n')
        row = self.plan_()['items'][0]
        self.assertEqual(row['subject'], 'Una lección aprendida')
        self.assertEqual(row['stamp'][:10], '2026-09-29')
        self.assertTrue(row['notes'])

    def test_a_plan_or_an_analysis_never_claims_the_ref_of_what_it_is_about(self):
        self.ini('completed', 'INI-006', 'seis', 'Seis')
        self.write('plans/INI-006-seis.md', '---\ninitiative: INI-006\nwritten: 2026-09-30\n---\n\n# INI-006 — Plan\n')
        rows = {r['stem'].split()[0]: r for r in self.plan_()['items']}
        plan_row = [r for r in self.plan_()['items'] if r['type'] == 'plan'][0]
        self.assertEqual(plan_row['old_ref'], '')
        self.assertEqual(plan_row['aliases'], ['INI-006-seis'])
        self.assertEqual(plan_row['parent'], 'INI-006')

    def test_an_initiative_that_names_its_learning_gives_it_its_parent(self):
        self.ini('completed', 'INI-001', 'uno', 'Uno', learnings='["2026-09-29-una-leccion.md"]')
        self.write('learnings/2026-09-29-una-leccion.md', '# 2026-09-29 — Una lección\n\ncuerpo\n')
        row = [r for r in self.plan_()['items'] if r['type'] == 'learning'][0]
        self.assertEqual(row['parent'], 'INI-001')

    # ── what it refuses or asks ─────────────────────────────────────────
    def test_a_value_the_vault_does_not_have_becomes_a_question(self):
        self.ini('completed', 'INI-001', 'uno', 'Uno', premise='quizá')
        asks = [q['ask'] for q in self.plan_()['questions']]
        self.assertTrue(any('premise' in a and 'quizá' in a for a in asks), asks)

    def test_the_four_values_the_owner_settled_need_no_question(self):
        """holds → verified, knowledge → curation, and the two analysis kinds left empty (owner, 2026-11-21)."""
        self.ini('completed', 'INI-001', 'uno', 'Uno', premise='holds')
        self.sup('completed', 'SUP-001', 'ese', 'Ese', origin='knowledge')
        self.write('analyses/2026-10-12-deuda.md', '---\nkind: original\ndate: 2026-10-12\n---\n\n# Deuda\n')
        plan = self.plan_()
        self.assertEqual(plan['questions'], [], plan['questions'])
        mig.apply_items(self.confirm(plan), io.StringIO())
        self.assertEqual(self.item('INI-001')['fields']['premise'], 'verified')
        self.assertEqual(self.item('SUP-001')['fields']['origin'], 'curation')
        anl = [r for r in plan['items'] if r['type'] == 'analysis'][0]
        self.assertFalse(self.item(str(anl['id']))['fields'].get('kind'))
        self.assertTrue(anl['notes'], 'the file says why its kind is empty')

    def test_an_alias_the_vault_already_answers_to_is_not_stolen(self):
        from tm import frontmatter as fm
        st = Store(self.vault, structure=REGISTRY['ticketing'])
        it = st.create('initiative', 'Algo mío', {'project': 'HB', 'initiative_kind': 'system'}, 'x')
        # Written into the file, not through the Store: `allowed_values` drops `aliases`, which is why the
        # importer cannot go through `Store.create` either.
        path = os.path.join(self.vault, it['path'])
        with io.open(path, encoding='utf-8') as fh:
            text = fh.read()
        with io.open(path, 'w', encoding='utf-8') as fh:
            fh.write(fm.patch(text, {'aliases': ['INI-001']}))
        self.ini('completed', 'INI-001', 'uno', 'Uno')
        plan = self.plan_()
        row = plan['items'][0]
        self.assertNotIn('INI-001', row['aliases'])
        self.assertIn('HB/INI-001', row['aliases'])
        self.assertEqual(len(plan['alias_collisions']), 1)

    def test_apply_refuses_an_unanswered_question_or_a_source_that_moved(self):
        self.ini('completed', 'INI-001', 'uno', 'Uno', premise='quizá')
        plan = self.plan_()
        for p in plan['projects']:
            p['confirmed'] = True
        with self.assertRaises(mig.PlanError):
            mig.apply_items(plan, io.StringIO())
        self.confirm(plan)
        self.ini('completed', 'INI-002', 'dos', 'Dos')          # the source grew after the plan
        with self.assertRaises(mig.PlanError):
            mig.apply_items(plan, io.StringIO())

    def test_apply_refuses_while_another_process_holds_the_lock(self):
        from tm.fsutil import vault_lock
        self.ini('completed', 'INI-001', 'uno', 'Uno')
        plan = self.confirm(self.plan_())
        with vault_lock(os.path.join(self.vault, META_DIR), timeout=1):
            with self.assertRaises(mig.PlanError) as e:
                mig.apply_items(plan, io.StringIO())
        self.assertIn(':3200', str(e.exception))

    # ── what it writes ──────────────────────────────────────────────────
    def test_a_closed_item_keeps_its_dates_and_gets_a_history(self):
        self.ini('completed', 'INI-001', 'uno', 'Uno')
        self.applied()
        it = self.item('INI-001')
        self.assertEqual(it['fields']['status'], 'Done')
        self.assertEqual(str(it['fields']['created_at'])[:10], '2026-09-28')
        log = it['fields']['status_log']
        # The log says the numbered status, which is what the app itself writes (`codec.py:266-270` builds
        # the entry from `disk_status`). `_closed_at` normalises it with `app_status`, and that is what makes
        # `completed_at` land.
        self.assertEqual(log[-1]['to'], '6. Done')
        self.assertEqual(log[-1]['from'], '2. ToDo')
        self.assertEqual(it['fields']['status'], 'Done')
        self.assertEqual({e['by'] for e in log}, {'migration'})
        self.assertTrue(it['fields']['completed_at'], 'without a log a closed item has no completed_at')

    def test_values_in_spanish_become_the_values_the_vault_has(self):
        self.ini('completed', 'INI-001', 'uno', 'Uno', regime='crítico')
        self.sup('discarded', 'SUP-001', 'ese', 'Ese', status='discarded', disposition='descartar')
        self.applied()
        self.assertEqual(self.item('INI-001')['fields']['regime'], 'critical')
        sup = self.item('SUP-001')
        self.assertEqual(sup['fields']['disposition'], 'discard')
        self.assertTrue(sup['fields']['discard_reason'], 'a discarded ticket needs a reason')

    def test_a_relation_becomes_a_wikilink_to_the_item_it_names(self):
        self.ini('completed', 'INI-001', 'uno', 'Uno')
        self.ini('completed', 'INI-002', 'dos', 'Dos', depends='["INI-001"]',
                 plan='../../plans/INI-002-dos.md')
        self.write('plans/INI-002-dos.md', '---\ninitiative: INI-002\nwritten: 2026-09-30\n---\n\n# INI-002 — Plan\n')
        self.applied()
        dos = self.item('INI-002')
        uno = self.item('INI-001')
        self.assertEqual(dos['fields']['depends_on'], [uno['id']])
        # its `plan` names the plan item, never itself
        self.assertNotEqual(dos['fields']['plan'], dos['id'])
        self.assertTrue(dos['fields']['plan'])

    def test_the_body_keeps_its_sections_and_loses_only_its_title_line(self):
        self.ini('completed', 'INI-001', 'uno', 'Uno')
        self.applied()
        path = os.path.join(self.vault, self.item('INI-001')['path'])
        with io.open(path, encoding='utf-8') as fh:
            text = fh.read()
        self.assertIn('## Prior context', text)
        self.assertIn('lo que sea', text)
        self.assertNotIn('# INI-001 — Uno', text)

    def test_an_imported_item_does_not_land_in_the_owners_favourites(self):
        """A file with no `sidebar` key reads as a favourite (store.py:1352), and the codec writes only what it
        is given: without this, every imported initiative shows up as one."""
        self.ini('completed', 'INI-001', 'uno', 'Uno')
        self.sup('completed', 'SUP-001', 'ese', 'Ese')
        plan = self.applied()
        ini = [r for r in plan['items'] if r['type'] == 'initiative'][0]
        path = os.path.join(self.vault, 'Acme System', 'Initiatives', ini['stem'] + '.md')
        with io.open(path, encoding='utf-8') as fh:
            head = fh.read().split('---', 2)[1]
        self.assertTrue(any(l.startswith('sidebar:') for l in head.splitlines()), 'the key must be there')
        self.assertIs(self.item('INI-001')['fields']['sidebar'], False)
        # support does not declare it: the key is not invented for a type it means nothing to
        sup = [r for r in plan['items'] if r['type'] == 'support'][0]
        spath = os.path.join(self.vault, 'Acme System', 'Support', sup['stem'] + '.md')
        with io.open(spath, encoding='utf-8') as fh:
            shead = fh.read().split('---', 2)[1]
        self.assertFalse(any(l.startswith('sidebar:') for l in shead.splitlines()))

    def test_the_counter_and_the_legacy_map_are_left_right(self):
        import json
        self.ini('completed', 'INI-001', 'uno', 'Uno')
        plan = self.applied()
        with open(os.path.join(self.vault, META_DIR, 'ids.json'), encoding='utf-8') as fh:
            marks = json.load(fh)
        self.assertGreaterEqual(marks['number'], max(r['id'] for r in plan['items']))
        with open(os.path.join(self.vault, META_DIR, 'legacy-ids.json'), encoding='utf-8') as fh:
            legacy = json.load(fh)
        self.assertEqual(legacy['INI-001'], plan['items'][0]['id'])

    def test_the_scope_that_lives_only_in_the_frontmatter_reaches_the_body(self):
        """`scope` is a prose paragraph the vault has no field for and that is not part of the body: without
        this it is simply lost, which is what happened to 572 items before this test existed."""
        self.ini('completed', 'INI-001', 'uno', 'Uno')
        plan = self.applied()
        path = os.path.join(self.vault, self.item('INI-001')['path'])
        with io.open(path, encoding='utf-8') as fh:
            text = fh.read()
        self.assertIn('[!owner] Scope', text)
        self.assertIn('de punta a punta', text)    # the scope of the INI fixture
        self.assertIn('## Prior context', text)    # and the body it came with

    def test_a_scope_already_written_in_the_body_is_not_repeated(self):
        self.write('initiatives/completed/2026-09-28-dos.md',
                   INI.format(ref='INI-002', slug='dos', title='Dos', status='completed', premise='verified',
                              regime='estándar', depends='[]', plan='""', learnings='[]')
                   .replace('lo que sea', 'lo que abarca: Dos de punta a punta'))
        plan = self.applied()
        path = os.path.join(self.vault, self.item('INI-002')['path'])
        with io.open(path, encoding='utf-8') as fh:
            text = fh.read()
        self.assertNotIn('[!owner] Scope', text)

    def test_a_key_with_no_field_of_its_own_is_kept_as_undeclared_frontmatter(self):
        self.write('initiatives/completed/2026-09-28-tres.md',
                   '---\nid: INI-003\nname: tres\ndate: 2026-09-28\nstatus: completed\n'
                   'doc_impact: "docs/X.md §2"\ni18n_impact: none\nprod: true\n'
                   'block: "14"\nstep: "01"\n---\n\n# INI-003 — Tres\n\ncuerpo\n')
        self.applied()
        f = self.item('INI-003')['fields']
        self.assertEqual(f.get('doc_impact'), 'docs/X.md §2')
        self.assertEqual(f.get('i18n_impact'), 'none')
        # and the two the owner said to drop are not invented back
        self.assertIsNone(f.get('block'))
        self.assertIsNone(f.get('step'))

    def test_a_source_decides_what_its_initiatives_deliver(self):
        # `initiative_kind` viene del dialecto, no del fichero: el de este inventario de prueba no lo
        # declara, así que sale el de la plantilla. Que CADA dialecto real declare el suyo lo comprueba
        # el test del inventario, que vive con él porque es su dato.
        self.ini('completed', 'INI-004', 'cuatro', 'Cuatro')
        self.applied()
        self.assertEqual(self.item('INI-004')['fields']['initiative_kind'], 'product')
        self.assertEqual(
            [d.initiative_kind for d in self.srcs.ITEM_SOURCES['HB'] if d.kind == 'initiative'],
            ['product'], 'el dialecto de prueba no declara kind: sale el de la plantilla')

    def test_check_passes_after_the_apply_and_the_sources_are_untouched(self):
        self.ini('completed', 'INI-001', 'uno', 'Uno')
        self.sup('completed', 'SUP-001', 'ese', 'Ese')
        self.write('learnings/2026-09-29-una-leccion.md', '# 2026-09-29 — Una lección\n\ncuerpo\n')
        plan = self.applied()
        out = io.StringIO()
        self.assertTrue(mig.check_items(plan, out), out.getvalue())
        self.assertTrue(Store(self.vault, structure=REGISTRY['ticketing']).check()['ok'])

    def test_it_never_overwrites_a_file_that_is_already_there(self):
        self.ini('completed', 'INI-001', 'uno', 'Uno')
        plan = self.confirm(self.plan_())
        rel = plan['items'][0]
        folder = os.path.join(self.vault, 'Acme System', 'Initiatives')
        os.makedirs(folder, exist_ok=True)
        with io.open(os.path.join(folder, rel['stem'] + '.md'), 'w', encoding='utf-8') as fh:
            fh.write('mio\n')
        with self.assertRaises(mig.PlanError):
            mig.apply_items(plan, io.StringIO())


if __name__ == '__main__':
    unittest.main()
