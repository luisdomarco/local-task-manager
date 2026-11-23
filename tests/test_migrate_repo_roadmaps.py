"""migrate_repo_roadmaps: the projects phase and the ficha bridge, on throwaway vaults.

Each test builds a tiny Projects vault with its own `Docs/Sistemas/` fichas and points the tool's PROJECTS table
at temporary folders, so nothing here reads or writes a real vault or a real repo.
"""
import io
import json
import os
import shutil
import tempfile
import types
import unittest

from tm.fsutil import vault_lock
from tm.store import META_DIR, Store
from tm.structures import REGISTRY
from tm.structures.ticketing.definition import ROOT_FOLDERS, WORKLOG_FOLDER
from tools import migrate_repo_roadmaps as mig

# Where this test's vault keeps its system fichas. The real path is in the inventory `--sources` loads,
# not in this repo, so a test cannot borrow it.
FICHAS = os.path.join('Docs', 'Fichas')  # bajo `Docs/`, que es una carpeta raíz que el check acepta

FICHA = """---
type: "sistema"
nombre: "{nombre}"
bucket: "{bucket}"
ruta: ""
remote: ""
confidencialidad: "github-privado"
estado: "por revisar"
proyecto: {proyecto}
tags: ["sistema"]
---

# {nombre}
"""


class ProjectsPhaseTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.vault = os.path.join(self.tmp, 'vault')
        self.github = os.path.join(self.tmp, 'github')
        for f in (*ROOT_FOLDERS.values(), WORKLOG_FOLDER):
            os.makedirs(os.path.join(self.vault, f), exist_ok=True)
        os.makedirs(os.path.join(self.vault, META_DIR), exist_ok=True)
        for b in ('apps', 'systems', 'meta', 'sin-repo'):
            os.makedirs(os.path.join(self.vault, FICHAS, b))
        os.makedirs(os.path.join(self.github, 'src', 'roadmap'))
        # Two projects: one that exists in the vault and one the tool must create. The inventory is a
        # FIXTURE, not the owner's: the tool reads whatever `--sources` loaded, so a test installs its own
        # instead of mutating a module global it does not own.
        self.srcs = types.SimpleNamespace(
            FICHAS=FICHAS,
            PROJECTS={
                'OLD': {'name': 'Old Thing', 'kind': 'product', 'repo': '~/x/old',
                        'managed_by': '~/x/old/.claude', 'sources': ['src/roadmap']},
                'NEW': {'name': 'New Thing', 'kind': 'system', 'repo': '~/x/new',
                        'managed_by': '~/x/new/.claude', 'sources': ['src/roadmap']},
            },
            POOL_OF_FICHA={'old-thing': 'OLD', 'new-thing': 'NEW'},
            ITEM_SOURCES={},
            LEFT_IN_REPO=[],
        )
        self._saved, mig.SOURCES = mig.SOURCES, self.srcs

    def tearDown(self):
        mig.SOURCES = self._saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def ficha(self, bucket, nombre, proyecto='""'):
        path = os.path.join(self.vault, FICHAS, bucket, nombre + '.md')
        with io.open(path, 'w', encoding='utf-8') as fh:
            fh.write(FICHA.format(nombre=nombre, bucket=bucket, proyecto=proyecto))

    def project(self, name, key, **vals):
        store = Store(self.vault, structure=REGISTRY['ticketing'])
        return store.create('project', name, {'project_key': key, **vals}, 'x')

    def plan(self):
        return mig.make_plan(self.vault, self.github, 'projects')

    def confirm(self, plan):
        for p in plan['projects']:
            p['confirmed'] = True
        for q in plan['questions']:
            q['answered'] = True
        return plan

    def row(self, plan, nombre):
        return next(r for r in plan['fichas'] if r['nombre'] == nombre)

    # ── what it proposes ────────────────────────────────────────────────
    def test_an_existing_project_is_reconciled_and_a_missing_one_is_new(self):
        self.project('Old Thing', 'OLD', repo='~/x/old', managed_by='~/wrong/.claude')
        self.ficha('apps', 'old-thing')
        self.ficha('meta', 'new-thing')
        by = {p['key']: p for p in self.plan()['projects']}
        self.assertTrue(by['OLD']['exists'])
        self.assertEqual(by['OLD']['changes'], {'managed_by': {'from': '~/wrong/.claude', 'to': '~/x/old/.claude'}})
        self.assertFalse(by['NEW']['exists'])
        self.assertIn('key-NEW', [q['id'] for q in self.plan()['questions']])

    def test_a_project_whose_fields_are_already_right_has_nothing_to_change(self):
        self.project('Old Thing', 'OLD', repo='~/x/old', managed_by='~/x/old/.claude')
        self.ficha('apps', 'old-thing')
        self.assertEqual({p['key']: p['changes'] for p in self.plan()['projects']}['OLD'], {})

    def test_the_key_of_an_existing_project_must_name_the_same_project(self):
        self.project('Something Else', 'OLD')
        self.ficha('apps', 'old-thing')
        with self.assertRaises(mig.PlanError):
            self.plan()

    def test_a_source_that_is_not_on_disk_stops_the_plan(self):
        self.srcs.PROJECTS['NEW']['sources'] = ['src/gone']
        self.ficha('meta', 'new-thing')
        with self.assertRaises(mig.PlanError):
            self.plan()

    # ── the ficha bridge ────────────────────────────────────────────────
    def test_a_ficha_with_a_pool_gets_its_wikilink_and_one_without_says_sin_pool(self):
        self.ficha('apps', 'old-thing')
        self.ficha('systems', 'a-library')
        plan = self.plan()
        self.assertEqual(self.row(plan, 'old-thing')['to'], '[[00 Old Thing]]')
        self.assertEqual(self.row(plan, 'a-library')['to'], mig.NO_POOL)

    def test_a_ficha_that_already_points_at_a_project_of_the_vault_is_left_alone(self):
        self.project('Google Ads AI Agents', 'GADS')
        self.ficha('systems', 'ads-agent', proyecto='"[[00 Google Ads AI Agents]]"')
        r = self.row(self.plan(), 'ads-agent')
        self.assertFalse(r['change'])
        self.assertEqual(r['to'], '[[00 Google Ads AI Agents]]')

    def test_a_bare_project_key_is_normalised_to_the_wikilink_obsidian_resolves(self):
        self.project('My Plan', 'PLAN')
        self.ficha('sin-repo', 'an-idea', proyecto='PLAN')
        r = self.row(self.plan(), 'an-idea')
        self.assertEqual(r['to'], '[[00 My Plan]]')
        self.assertTrue(r['change'])
        self.assertEqual([], [q for q in self.plan()['questions'] if q['id'] == 'ficha-an-idea'])

    def test_a_value_that_names_no_project_of_the_vault_is_asked_about_and_kept(self):
        self.ficha('sin-repo', 'an-idea', proyecto='NOPE')
        plan = self.plan()
        self.assertIn('ficha-an-idea', [q['id'] for q in plan['questions']])
        self.assertFalse(self.row(plan, 'an-idea')['change'])

    def test_only_sistema_fichas_are_read(self):
        with io.open(os.path.join(self.vault, FICHAS, 'apps', 'notes.md'), 'w', encoding='utf-8') as fh:
            fh.write('---\ntype: "mapa"\n---\n')
        self.ficha('apps', 'old-thing')
        self.assertEqual([r['nombre'] for r in self.plan()['fichas']], ['old-thing'])

    # ── what it refuses ─────────────────────────────────────────────────
    def test_it_refuses_a_vault_that_does_not_match_its_structure(self):
        shutil.rmtree(os.path.join(self.vault, WORKLOG_FOLDER))
        self.ficha('apps', 'old-thing')
        with self.assertRaises(mig.PlanError):
            self.plan()

    def test_apply_refuses_an_unconfirmed_project_an_open_question_or_a_moved_vault(self):
        self.project('Old Thing', 'OLD', repo='~/x/old', managed_by='~/x/old/.claude')
        self.ficha('apps', 'old-thing')
        self.ficha('meta', 'new-thing')
        plan = self.plan()
        with self.assertRaises(mig.PlanError):
            mig.apply_plan(plan, io.StringIO())          # not confirmed
        for p in plan['projects']:
            p['confirmed'] = True
        with self.assertRaises(mig.PlanError):
            mig.apply_plan(plan, io.StringIO())          # key-NEW unanswered
        self.confirm(plan)
        with io.open(os.path.join(self.vault, 'Notes', 'x.md'), 'w', encoding='utf-8') as fh:
            fh.write('hello')
        with self.assertRaises(mig.PlanError):
            mig.apply_plan(plan, io.StringIO())          # the vault moved

    def test_the_cli_refuses_an_apply_without_a_backup(self):
        self.ficha('apps', 'old-thing')
        p = os.path.join(self.tmp, 'p.json')
        mig.main(['--plan', self.vault, '--github', self.github, '--plan-file', p], io.StringIO())
        self.assertEqual(mig.main(['--apply', p], io.StringIO()), 2)

    def test_apply_refuses_while_another_process_holds_the_vault_lock(self):
        """The app at :3200 takes the same flock per write: a ficha half written while it indexes is the bug."""
        self.ficha('apps', 'old-thing')
        plan = self.confirm(self.plan())
        with vault_lock(os.path.join(self.vault, META_DIR), timeout=1):
            with self.assertRaises(mig.PlanError) as e:
                mig.apply_plan(plan, io.StringIO())
        self.assertIn(':3200', str(e.exception))
        # nothing was written, so the ficha is as it was
        self.assertEqual({f['nombre']: f['proyecto'] for f in mig.read_fichas(self.vault)}['old-thing'], '')

    # ── what it writes ──────────────────────────────────────────────────
    def test_apply_creates_reconciles_and_wires_and_check_agrees(self):
        self.project('Old Thing', 'OLD', repo='~/x/old', managed_by='~/wrong/.claude')
        self.ficha('apps', 'old-thing')
        self.ficha('meta', 'new-thing')
        self.ficha('systems', 'a-library')
        plan = self.confirm(self.plan())
        mig.apply_plan(plan, io.StringIO())
        # the new project, with its key, its repo and the door to its ficha
        note = os.path.join(self.vault, 'New Thing', '00 New Thing.md')
        with io.open(note, encoding='utf-8') as fh:
            text = fh.read()
        self.assertIn('project_key: NEW', text)
        self.assertIn('~/x/new', text)
        self.assertIn('[[new-thing]]', text)
        # the existing one, reconciled, and nothing else about it touched
        self.assertEqual(mig.projects_in(self.vault)['OLD']['managed_by'], '~/x/old/.claude')
        # the fichas
        fichas = {f['nombre']: f['proyecto'] for f in mig.read_fichas(self.vault)}
        self.assertEqual(fichas['old-thing'], '[[00 Old Thing]]')
        self.assertEqual(fichas['new-thing'], '[[00 New Thing]]')
        self.assertEqual(fichas['a-library'], mig.NO_POOL)
        self.assertTrue(Store(self.vault, structure=REGISTRY['ticketing']).check()['ok'])
        out = io.StringIO()
        self.assertTrue(mig.check(plan, out))
        self.assertIn('2 projects', out.getvalue())

    def test_a_patched_ficha_keeps_every_other_byte(self):
        self.ficha('apps', 'old-thing')
        rel = os.path.join(FICHAS, 'apps', 'old-thing.md')
        with io.open(os.path.join(self.vault, rel), encoding='utf-8') as fh:
            before = fh.read()
        mig.apply_plan(self.confirm(self.plan()), io.StringIO())
        with io.open(os.path.join(self.vault, rel), encoding='utf-8') as fh:
            after = fh.read()
        self.assertEqual(before.replace('proyecto: ""', 'proyecto: "[[00 Old Thing]]"'), after)

    def test_rollback_puts_back_the_fichas_and_removes_what_it_created(self):
        self.project('Old Thing', 'OLD', repo='~/x/old', managed_by='~/wrong/.claude')
        self.ficha('apps', 'old-thing')
        self.ficha('meta', 'new-thing')
        plan = self.confirm(self.plan())
        mig.apply_plan(plan, io.StringIO())
        mig.rollback(plan, io.StringIO())
        self.assertFalse(os.path.exists(os.path.join(self.vault, 'New Thing')))
        self.assertEqual(mig.projects_in(self.vault)['OLD']['managed_by'], '~/wrong/.claude')
        self.assertEqual({f['nombre']: f['proyecto'] for f in mig.read_fichas(self.vault)}['old-thing'], '')
        self.assertTrue(Store(self.vault, structure=REGISTRY['ticketing']).check()['ok'])

    def test_rollback_leaves_alone_a_file_someone_changed_after_the_apply(self):
        self.ficha('apps', 'old-thing')
        plan = self.confirm(self.plan())
        mig.apply_plan(plan, io.StringIO())
        rel = os.path.join(FICHAS, 'apps', 'old-thing.md')
        with io.open(os.path.join(self.vault, rel), encoding='utf-8') as fh:
            text = fh.read()
        from tm import frontmatter as fm
        with io.open(os.path.join(self.vault, rel), 'w', encoding='utf-8') as fh:
            fh.write(fm.patch(text, {'proyecto': 'MINE'}))
        mig.rollback(plan, io.StringIO())
        self.assertEqual({f['nombre']: f['proyecto'] for f in mig.read_fichas(self.vault)}['old-thing'], 'MINE')

    def test_the_items_phase_says_it_is_not_there_yet(self):
        self.ficha('apps', 'old-thing')
        with self.assertRaises(mig.PlanError):
            mig.make_plan(self.vault, self.github, 'items')

    def test_the_cli_writes_a_plan_and_check_fails_before_the_apply(self):
        self.ficha('meta', 'new-thing')
        p = os.path.join(self.tmp, 'p.json')
        out = io.StringIO()
        self.assertEqual(mig.main(['--plan', self.vault, '--github', self.github, '--plan-file', p], out), 0)
        with open(p, encoding='utf-8') as fh:
            plan = json.load(fh)
        self.assertEqual(plan['counts']['new'], 2)
        self.assertFalse(mig.check(plan, io.StringIO()))


if __name__ == '__main__':
    unittest.main()
