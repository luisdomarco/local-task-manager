"""tools/vault.py and what it stands on: the vault's lock across processes (tm/fsutil.vault_lock, taken by every Store
write), relations written where the panel writes them (relations.relation_writes, Store.relate), and each command of
the CLI on a temp copy of the sample vaults. Never a real vault."""
import contextlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import threading
import time
import unittest

from tm.fsutil import VaultBusy, vault_lock
from tm.store import META_DIR, Store, StoreError
from tm.structures import get as get_structure
from tm.structures.relations import relation_writes
from tools import audit_list_fields, vault
from tools.serve_sample import copy_sample

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLE = os.path.join(APP_DIR, 'sample-vault')
LEGACY = os.path.join(APP_DIR, 'sample-vault-legacy')


class SampleCopy(unittest.TestCase):
    sample = SAMPLE

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='tm-vault-cli-')
        self.root = copy_sample(self.sample, os.path.join(self.tmp, 'vault'))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def cli(self, *argv, code=0):
        out, err = io.StringIO(), io.StringIO()
        got = vault.main(['-C', self.root, *argv], out=out, err=err)
        self.assertEqual(got, code, f'vault.py {" ".join(argv)} → {got}\n{out.getvalue()}{err.getvalue()}')
        return out.getvalue() + err.getvalue()

    def cli_json(self, *argv, code=0):
        return json.loads(self.cli('--json', *argv, code=code))

    def file(self, rel):
        with open(os.path.join(self.root, rel), encoding='utf-8') as f:
            return f.read()

    def store(self):
        return Store(self.root, None, 'ticketing', enforce_structure=True)

    def old_plan(self):
        """A plan from before plans had ids: no `id`, named after its item. → its path, its key."""
        rel = 'Acme Web/Plans/INI-1 Plan.md'
        with open(os.path.join(self.root, rel), 'w', encoding='utf-8') as f:
            f.write('---\nfileClass: Ticket Plan\nitem: "[[INI-1 Checkout redesign]]"\nproject: "[[00 Acme Web]]"\n'
                    'creation_date: 2026-10-01\nupdated_date: 2026-10-01\n---\n\n# Plan\n')
        return rel


# ── the lock ─────────────────────────────────────────────────────────────────
CREATE_MANY = textwrap.dedent('''
    import sys
    sys.path.insert(0, sys.argv[1])
    import tm.store
    from tm.store import Store
    s = Store(sys.argv[2], None, 'ticketing', enforce_structure=True)
    for n in range(int(sys.argv[3])):
        s.create('note', f'{sys.argv[4]} {n}')
''')

CREATE_ONE = textwrap.dedent('''
    import sys
    sys.path.insert(0, sys.argv[1])
    import tm.store
    tm.store.VAULT_LOCK_TIMEOUT = float(sys.argv[3])
    from tm.store import Store, StoreError
    try:
        print(Store(sys.argv[2], None, 'ticketing', enforce_structure=True).create('note', 'Waited')['ref'])
    except StoreError as e:
        print(e.status, e)
''')


class VaultLockTest(SampleCopy):
    def run_script(self, script, *args):
        return subprocess.Popen([sys.executable, '-c', script, APP_DIR, self.root, *map(str, args)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def test_two_processes_creating_at_once_never_share_an_id(self):
        procs = [self.run_script(CREATE_MANY, 8, name) for name in ('Left', 'Right')]
        for p in procs:
            _, err = p.communicate(timeout=120)
            self.assertEqual(p.returncode, 0, err)
        notes = [it for it in self.store().items() if it['title'].startswith(('Left ', 'Right '))]
        self.assertEqual(len(notes), 16)
        self.assertEqual(len({it['id'] for it in notes}), 16, 'every note got its own number')
        self.assertTrue(self.store().check()['ok'])

    def test_a_write_waits_for_another_process_and_gives_up_after_its_wait(self):
        meta = os.path.join(self.root, META_DIR)
        with vault_lock(meta):
            busy = self.run_script(CREATE_ONE, 0.3).communicate(timeout=60)[0]
            self.assertTrue(busy.startswith('503 '), busy)
            waiting = self.run_script(CREATE_ONE, 20)
            time.sleep(0.5)
            self.assertIsNone(waiting.poll(), 'it waits while the lock is held')
        out = waiting.communicate(timeout=60)[0]
        self.assertTrue(out.startswith('NOTE-'), out)

    def test_threads_of_one_process_and_nested_writes_do_not_deadlock(self):
        s = self.store()
        errors = []

        def work(n):
            try:
                for k in range(4):
                    it = s.create('note', f'T{n}-{k}')
                    s.add_comment(it['key'], 'nested: add_comment calls update')
            except Exception as e:  # noqa: BLE001 — reported below
                errors.append(e)
        threads = [threading.Thread(target=work, args=(n,)) for n in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(60)
        self.assertFalse(any(t.is_alive() for t in threads), 'deadlocked')
        self.assertEqual(errors, [])
        ids = [it['id'] for it in s.items() if it['title'].startswith('T')]
        self.assertEqual(len(ids), len(set(ids)))

    def test_a_vault_where_no_lock_can_be_made_is_written_as_before(self):
        blocker = os.path.join(self.tmp, 'a-file')
        open(blocker, 'w').close()
        with vault_lock(os.path.join(blocker, 'meta')):  # its folder cannot be made: no lock, no error
            pass
        meta = os.path.join(self.tmp, 'm')
        with vault_lock(meta):
            with self.assertRaises(VaultBusy):
                with vault_lock(meta, timeout=0.1):  # another open of the file: it waits, even in one process
                    pass


# ── relations ────────────────────────────────────────────────────────────────
def item(id_, type_, relations=(), kinds=None, **more):
    return {'id': id_, 'key': id_, 'type': type_, 'fields': {'relations': list(relations), 'relation_kinds': dict(kinds or {}), **more}}


def summary(writes):
    return [(h['id'], v) for h, v, _ in writes]


class RelationWritesTest(unittest.TestCase):
    """The cases of tests/js/relkinds.test.mjs relationWrites, here: the CLI and the panel write a relation alike."""
    RK = get_structure('folders').public()['relation_kinds']

    def none(self, *_):
        return False

    def test_kept_by_whichever_holds_it_as_that_side_sees_it(self):
        t = item('TSK-0001', 'task', ['US-0001'], {'US-0001': 'blocks'})
        s = item('US-0001', 'story')
        [(holder, values, was)] = relation_writes(s, t, 'follows', self.RK, self.none)
        self.assertIs(holder, t)
        self.assertEqual(values, {'relation_kinds': {'US-0001': 'precedes'}})
        self.assertEqual(was, {'relation_kinds': {'US-0001': 'blocks'}})
        self.assertEqual(relation_writes(t, s, 'relates', self.RK, self.none)[0][1], {'relation_kinds': {}})

    def test_a_new_one_goes_on_the_item_it_is_added_from_and_none_takes_it_off(self):
        a = item('TSK-0001', 'task', ['TSK-0009'])
        b = item('US-0001', 'story')
        [(holder, values, _)] = relation_writes(a, b, 'blocked', self.RK, self.none)
        self.assertIs(holder, a)
        self.assertEqual(values, {'relations': ['TSK-0009', 'US-0001'], 'relation_kinds': {'US-0001': 'blocked'}})
        kept = item('US-0001', 'story', ['TSK-0001'], {'TSK-0001': 'duplicates'})
        [(holder, values, was)] = relation_writes(a, kept, None, self.RK, self.none)
        self.assertIs(holder, kept)
        self.assertEqual(values, {'relations': [], 'relation_kinds': {}})
        self.assertEqual(was, {'relations': ['TSK-0001'], 'relation_kinds': {'TSK-0001': 'duplicates'}})

    def test_a_kind_with_a_field_of_its_own_goes_there_when_the_type_has_it(self):
        pk = {**self.RK, 'fields': {'blocked': 'depends_on'}}
        has = lambda t, f, o: f == 'depends_on' and t in ('initiative', 'story') and o != 'project'  # noqa: E731
        a = item('ACME-STY-001', 'story', depends_on=[])
        b = item('ACME-STY-002', 'story', depends_on=[])
        self.assertEqual(summary(relation_writes(a, b, 'blocked', pk, has)), [('ACME-STY-001', {'depends_on': ['ACME-STY-002']})])
        self.assertEqual(summary(relation_writes(a, b, 'blocks', pk, has)), [('ACME-STY-002', {'depends_on': ['ACME-STY-001']})])
        hfx = item('ACME-HFX-001', 'hotfix')
        self.assertEqual(summary(relation_writes(hfx, b, 'blocked', pk, has)),
                         [('ACME-HFX-001', {'relations': ['ACME-STY-002'], 'relation_kinds': {'ACME-STY-002': 'blocked'}})])
        moving = item('ACME-STY-001', 'story', ['ACME-STY-002'], {'ACME-STY-002': 'precedes'}, depends_on=[])
        self.assertEqual(summary(relation_writes(moving, b, 'blocked', pk, has)),
                         [('ACME-STY-001', {'relations': [], 'relation_kinds': {}, 'depends_on': ['ACME-STY-002']})])


class RelateTest(SampleCopy):
    def test_blocked_by_lands_in_depends_on_of_the_one_that_waits_and_only_that_key_changes(self):
        s = self.store()
        path = s.find('STY-6')['path']
        before = self.file(path)
        [written] = s.relate('STY-6', 'blocked', 'STY-5')
        self.assertEqual(written['fields']['depends_on'], ['5'])
        changed = [(a, b) for a, b in zip(before.splitlines(), self.file(path).splitlines()) if a != b]
        self.assertEqual([a.split(':')[0] for a, _ in changed], ['depends_on'] + (['updated_date'] if len(changed) > 1 else []))
        self.assertIn('[[STY-5 Address, shipping and payment on one page]]', self.file(path))

    def test_a_kind_moves_between_relations_and_depends_on_and_unlinking_clears_both_sides(self):
        s = self.store()
        s.relate('STY-5', 'precedes', 'STY-6')
        self.assertEqual(s.read('STY-5')['fields']['relation_kinds'], {'6': 'precedes'})
        s.relate('STY-6', 'blocked', 'STY-5')
        self.assertEqual((s.read('STY-5')['fields']['relations'], s.read('STY-6')['fields']['depends_on']), ([], ['5']))
        s.relate('STY-5', None, 'STY-6')
        self.assertEqual((s.read('STY-5')['fields']['relations'], s.read('STY-6')['fields']['depends_on']), ([], []))
        self.assertTrue(s.check()['ok'])

    def test_refused_an_unknown_kind_itself_and_an_item_without_an_id(self):
        s = self.store()
        for args, words in ((('STY-5', 'eats', 'STY-6'), 'unknown relation kind'), (('STY-5', 'relates', 'STY-5'), 'itself')):
            with self.assertRaises(StoreError) as e:
                s.relate(*args)
            self.assertIn(words, str(e.exception))
        plan = s.read(self.old_plan())
        self.assertIsNone(plan['id'])
        with self.assertRaises(StoreError):
            s.relate(plan['key'], 'relates', 'STY-5')


# ── the CLI ──────────────────────────────────────────────────────────────────
class ReadCommandsTest(SampleCopy):
    def test_overview_names_the_projects_the_types_and_what_changed(self):
        out = self.cli('overview')
        self.assertIn('Projects vault', out)
        self.assertIn('| ACME | Acme Web |', out)
        self.assertIn('Stories (`story`)', out)
        data = self.cli_json('overview')
        self.assertTrue(data['check_ok'])
        self.assertEqual({p['key'] for p in data['projects']}, {'ACME', 'MOVE', 'OPS'})

    def test_types_lists_them_and_one_type_its_fields_and_link_fields(self):
        self.assertIn('| `story` | Story | STY |', self.cli('types'))
        out = self.cli('types', 'story')
        self.assertIn('`depends_on`', out)
        self.assertIn('Link fields (take refs):', out)
        self.assertIn("no type 'nope'", self.cli('types', 'nope', code=1))

    def test_find_by_text_type_status_project_and_inside_the_files(self):
        refs = [r['ref'] for r in self.cli_json('find', '--type', 'story')['items']]
        self.assertLessEqual({'STY-5', 'STY-6', 'STY-8'}, set(refs))
        self.assertTrue(all(r.startswith('STY-') for r in refs))
        self.assertEqual([r['ref'] for r in self.cli_json('find', 'keep the cart')['items']], ['STY-6'])
        self.assertTrue(all(r['project'] == 'OPS' for r in self.cli_json('find', '--project', 'OPS')['items']))
        self.assertEqual(self.cli_json('find', '--status', 'nope')['total'], 0)
        hits = self.cli_json('find', 'abandoned', '--text')['text']
        self.assertTrue(any(h['path'].startswith('Acme Web/Analyses/') for h in hits))
        self.assertIn('find nothing', self.cli('find', '--open', '--closed', code=1))

    def test_show_reads_every_link_from_the_item_and_names_refs_not_ids(self):
        self.store().relate('STY-6', 'blocked', 'STY-5')
        out = self.cli('show', 'STY-5', '--no-body')
        self.assertIn('# STY-5 · Address, shipping and payment on one page', out)
        self.assertIn('- related_to: INI-1', out)
        self.assertIn('- Child of INI-1 Checkout redesign (initiative)', out)
        self.assertIn('- Blocks STY-6 Keep the cart when the payment fails (story)', out)
        self.assertNotIn('## Description', out)
        self.assertIn('## Description', self.cli('show', 'STY-5'))
        data = self.cli_json('show', 'INI-1')
        self.assertIn('Parent of', {link['reading'] for link in data['links']})
        self.assertIn('item not found', self.cli('show', 'STY-999', code=1))

    def test_show_a_doc_and_an_item_without_an_id_by_their_path(self):
        doc = os.path.relpath(next(os.path.join(d, f) for d, _, fs in os.walk(os.path.join(self.root, 'Docs')) for f in fs
                                   if f.endswith('.md')), self.root)
        self.assertIn(f'# {doc}', self.cli('show', doc))
        plan = self.store().read(self.old_plan())
        self.assertIn(f"# {plan['path']} · {plan['title']}", self.cli('show', plan['path'], '--no-body'))

    def test_graph_rings_out_by_steps_and_follows_only_the_kinds_asked(self):
        one = self.cli_json('graph', 'STY-5')
        self.assertEqual({n['depth'] for n in one['nodes']}, {0, 1})
        two = self.cli_json('graph', 'STY-5', '--depth', '2')
        self.assertGreater(len(two['nodes']), len(one['nodes']))
        self.assertNotIn('ACME', {n['id'] for n in two['nodes']}, 'the project is left out unless asked')
        self.assertIn('ACME', {n['id'] for n in self.cli_json('graph', 'STY-5', '--kinds', 'project')['nodes']})
        self.assertIn('unknown kind', self.cli('graph', 'STY-5', '--kinds', 'parents', code=1))

    def test_open_counts_only_what_can_close_and_a_type_with_no_status_is_its_own_column(self):
        """SUP-5286: a plan, an analysis, a learning and a note have no status and never close. Counting them as open
        put the records of a project in its Open column (one real vault read 514 where 74 could close)."""
        data = self.cli_json('overview')
        kinds = {t['type']: t for t in data['types']}
        for name in ('plan', 'analysis', 'learning', 'note'):
            self.assertEqual((kinds[name]['open'], kinds[name]['closed']), (0, 0), f'{name} cannot close')
            self.assertGreater(kinds[name]['no_status'], 0, f'{name} is counted apart')
        self.assertGreater(kinds['story']['open'], 0, 'a type with statuses still counts as open')
        # An activity has no statuses but closes by a field (closed_when: resolved_at): it can close, so it is open.
        self.assertEqual(kinds['activity']['no_status'], 0)
        self.assertGreater(kinds['activity']['open'], 0)
        acme = next(p for p in data['projects'] if p['key'] == 'ACME')
        self.assertGreater(acme['no_status'], 0)
        # The three columns hold every item of the project, the project's own note aside (which is no part of it).
        in_acme = [r for r in self.cli_json('find', '--project', 'ACME', '--limit', '0')['items'] if r['type'] != 'project']
        self.assertEqual(acme['open'] + acme['closed'] + acme['no_status'], len(in_acme))
        self.assertIn('| Open | Closed | No status |', self.cli('overview'))
        # And `find --open` reads the same way: a record is not "open" just because it is not closed.
        self.assertEqual(self.cli_json('find', '--type', 'note', '--open')['total'], 0)
        self.assertGreater(self.cli_json('find', '--type', 'note')['total'], 0)

    def test_find_says_under_the_table_what_it_left_out_and_how_to_ask_for_it(self):
        """SUP-5287: it answers with 50 rows. A count read off the rows of a cut answer is a wrong count, and the row
        you stop at is the one you believe."""
        data = self.cli_json('find', '--limit', '3')
        self.assertEqual((len(data['items']), data['shown'], data['limit']), (3, 3, 3))
        self.assertGreater(data['total'], 3)
        out = self.cli('find', '--limit', '3')
        tail = out.rstrip().splitlines()[-1]
        self.assertIn(f"…and {data['total'] - 3} more of the {data['total']}", tail)
        self.assertIn('--limit 0', tail)
        every = self.cli_json('find', '--limit', '0')
        self.assertEqual((len(every['items']), every['limit']), (every['total'], None))
        self.assertNotIn('…and', self.cli('find', '--limit', '0'))

    def test_context_is_the_prompt_the_app_gives_claude(self):
        self.assertEqual(self.cli('context', 'STY-5').rstrip(), self.store().claude_prompt('STY-5').rstrip())

    def test_the_vault_is_found_from_a_folder_inside_it(self):
        inside = os.path.join(self.root, 'Acme Web', 'Stories')
        self.assertEqual(vault.find_vault(inside), os.path.realpath(self.root))
        lonely = os.path.join(self.tmp, 'lonely')
        os.makedirs(lonely)
        self.assertEqual(vault.find_vault(lonely), os.path.realpath(lonely))


class WriteCommandsTest(SampleCopy):
    def test_new_takes_refs_in_link_fields_and_a_body(self):
        data = self.cli_json('new', 'story', 'Pay with a saved card', '--set', 'project=ACME', '--set', 'related_to=INI-1',
                             '--set', 'depends_on=STY-5,STY-6', '--body', 'As a shopper I want my card kept.')
        self.assertEqual((data['fields']['related_to'], data['fields']['depends_on']), ('1', ['5', '6']))
        text = self.file(data['path'])
        self.assertIn('initiative: "[[INI-1 Checkout redesign]]"', text)
        self.assertIn('As a shopper I want my card kept.', text)
        self.assertTrue(self.store().check()['ok'])

    def test_a_list_field_given_loose_text_is_kept_as_one_value_not_one_per_character(self):
        """SUP-5288: `labels=agentic-system` was written `tags: ["a", "g", "e", …]`, and nothing said a word."""
        self.cli('set', 'STY-5', 'labels=agentic-system')
        self.assertEqual(self.store().read('STY-5')['fields']['labels'], ['agentic-system'])
        self.cli('set', 'STY-5', 'labels=one,two three')  # several by comma, as a link list already took them
        self.assertEqual(self.store().read('STY-5')['fields']['labels'], ['one', 'two three'])
        self.cli('set', 'STY-5', 'labels=["with, comma"]')  # JSON stays the way out for a value holding a comma
        self.assertEqual(self.store().read('STY-5')['fields']['labels'], ['with, comma'])
        self.cli('set', 'STY-5', 'labels=')
        self.assertEqual(self.store().read('STY-5')['fields']['labels'], [])
        # On creation too, where the item has no fields to read the shape from.
        made = self.cli_json('new', 'note', 'A note with a label', '--set', 'labels=one-label')
        self.assertEqual(made['fields']['labels'], ['one-label'])

    def test_a_link_field_refuses_a_ref_that_names_no_item_instead_of_writing_a_link_to_nothing(self):
        """SUP-2064: the ref went to disk as `[[NOPE-999]]`, the CLI said `Updated`, and in a list field nothing
        mentioned it again — `check` stays green because an empty field is valid."""
        for pair in ('depends_on=NOPE-999', 'origin=NOPE-999', 'related_to=NOPE-999'):
            out = self.cli('set', 'STY-5', pair, code=1)
            self.assertIn(pair, out)
            self.assertIn('item not found: NOPE-999', out)
        self.assertNotIn('NOPE-999', self.file(self.store().find('STY-5')['path']))
        self.assertIn('NOPE-999', self.cli('new', 'story', 'Of nothing', '--set', 'depends_on=NOPE-999', code=1))
        # A ref under an old id of its own (an alias) resolves in a list link field as in a single one — including
        # one prefixed by a project key the vault no longer has (`XXX/`). That prefix is the variable SUP-2064 turned
        # on: a real one named a project key the vault no longer has, surviving only inside `aliases`. Measured
        # 2026-11-25: it resolves and is written, here and on the code from before this fix.
        path = self.store().find('STY-6')['path']
        with open(os.path.join(self.root, path), encoding='utf-8') as f:
            text = f.read()
        with open(os.path.join(self.root, path), 'w', encoding='utf-8') as f:
            f.write(text.replace('---\n', '---\naliases: ["ACME/STY-900", "XXX/STY-900"]\n', 1))
        six = self.store().find('STY-6')['id']
        for alias in ('ACME/STY-900', 'XXX/STY-900'):  # a live project key, and one of no project of this vault
            self.cli('set', 'STY-5', f'depends_on={alias}')
            self.assertEqual(self.store().read('STY-5')['fields']['depends_on'], [six], alias)
            self.cli('set', 'STY-5', f'origin={alias}')
            self.assertEqual(self.store().read('STY-5')['fields']['origin'], six, alias)

    def test_set_changes_only_the_keys_given_and_refuses_one_the_type_lacks(self):
        path = self.store().find('STY-5')['path']
        before = self.file(path)
        self.cli('set', 'STY-5', 'priority=P3')  # it is P1 in the sample
        changed = {a.split(':')[0] for a, b in zip(before.splitlines(), self.file(path).splitlines()) if a != b}
        self.assertLessEqual(changed, {'priority', 'updated_date'})
        self.assertIn('priority', changed)
        self.assertIn("has no field 'bogus'", self.cli('set', 'STY-5', 'bogus=1', code=1))
        self.assertIn('nothing to set', self.cli('set', 'STY-5', code=1))

    def test_set_takes_a_place_given_as_text(self):
        # INB-030: every value comes in as text; a goal's place read as a number, the goal with it in one write
        for given, kept in (('1', 1), ('001', 1), ('+1', 1), (' 3 ', 3), ('1.0', 1), ('2.5', 2.5)):
            out = self.cli_json('set', 'STY-6', 'goal=GOL-27', f'goal_order={given}')
            self.assertEqual((out['fields']['goal'], out['fields']['goal_order']), ('27', kept), given)
        self.assertIn('goal_order: 2.5', self.file(out['path']))
        self.cli('set', 'STY-6', 'goal_order=4')
        self.assertIn('goal_order: 4\n', self.file(out['path']))  # a whole number, never 4.0
        before = self.file(out['path'])
        for bad in ('abc', 'true', 'nan', 'inf'):
            self.assertIn('goal_order must be a number', self.cli('set', 'STY-6', 'goal=', f'goal_order={bad}', code=1), bad)
        self.assertEqual(self.file(out['path']), before)  # refused whole: not even the goal is written
        self.cli('set', 'STY-6', 'goal_order=')
        self.assertIsNone(self.store().read('STY-6')['fields'].get('goal_order'))
        self.assertEqual(self.cli_json('set', 'STY-6', 'plan_order=7', 'week_order=02')['fields']['week_order'], 2)  # the other places too

    def test_set_with_a_stale_rev_is_refused(self):
        rev = self.cli_json('show', 'STY-5')['rev']
        self.cli('set', 'STY-5', 'priority=P1')
        self.assertEqual(self.cli_json('set', 'STY-5', 'priority=P3', '--rev', rev, code=1)['status'], 409)

    def test_move_goes_through_the_gates_an_agent_has(self):
        # a story of an initiative not approved yet (the sample's are all approved by now)
        ini = self.cli_json('new', 'initiative', 'Loyalty points', '--set', 'project=ACME')['ref']
        sty = self.cli_json('new', 'story', 'Earn points on every order', '--set', 'project=ACME', '--set', f'related_to={ini}')['ref']
        out = self.cli('move', sty, 'todo', code=1)
        self.assertIn('initiative approved', out)
        self.assertIn("no status 'Nope'", self.cli('move', sty, 'Nope', code=1))
        self.cli('move', sty, 'onhold', code=1)  # OnHold needs its reasons too: never moved without them
        self.assertEqual(self.store().read(sty)['fields']['status'], 'Backlog')

    def test_link_unlink_and_comment(self):
        self.cli('link', 'STY-6', 'blocked', 'STY-5')
        self.assertEqual(self.store().read('STY-6')['fields']['depends_on'], ['5'])
        self.cli('link', 'STY-5', 'precedes', 'STY-8')
        self.assertEqual(self.store().read('STY-5')['fields']['relation_kinds'], {'8': 'precedes'})
        self.cli('unlink', 'STY-5', 'STY-6')
        self.assertEqual(self.store().read('STY-6')['fields']['depends_on'], [])
        self.cli('comment', 'STY-5', 'Ask the PSP about tokens')
        said = self.store().item_comments('STY-5')['comments'][-1]  # a file of its own (tm/comments.py), by an agent
        self.assertEqual((said['text'], said['by']), ('Ask the PSP about tokens', 'agent'))
        self.assertIn('Ask the PSP about tokens', self.cli('show', 'STY-5'))
        self.assertTrue(self.store().check()['ok'])

    def test_delete_goes_to_the_trash_and_restore_brings_it_back_linked(self):
        plan = self.cli_json('new', 'plan', 'Rollout', '--set', 'related_to=STY-5')['ref']
        out = self.cli_json('delete', 'STY-5')
        self.assertTrue(out['trashed'].startswith('.task-manager/trash/'))
        self.assertIn('item not found', self.cli('show', 'STY-5', code=1))
        entry = next(e for e in self.cli_json('trash') if e['trashed'] == out['trashed'])
        # Its subject, as its file name says it (a Projects ticket keeps none in a key), never the trash's stamp.
        self.assertEqual((entry['ref'], entry['title']), ('STY-5', 'Address, shipping and payment on one page'))
        self.assertIn(f"`restore {out['trashed']}`", self.cli('trash'))
        self.cli('restore', out['trashed'])
        self.assertEqual(self.store().read(plan)['fields']['related_to'], '5')
        self.assertIn('not in the trash', self.cli('restore', out['trashed'], code=1))
        self.assertTrue(self.store().check()['ok'])

    def test_a_project_is_deleted_with_its_items_only_when_asked(self):
        self.cli('new', 'project', 'Salon', '--set', 'project_key=SAL')
        sty = self.cli_json('new', 'story', 'Bookings', '--set', 'project=SAL')
        self.assertTrue(sty['path'].startswith('Salon/'))
        self.assertIn('--with-items', self.cli('delete', 'SAL', code=1))
        self.assertEqual(self.store().read(sty['ref'])['ref'], sty['ref'])  # nothing went
        self.assertIn('With it, 1 item of its folder', self.cli('delete', 'SAL', '--with-items'))
        self.assertIn('item not found', self.cli('show', sty['ref'], code=1))
        self.assertTrue(self.store().check()['ok'])

    def test_attach_detach_and_a_new_item_with_its_files(self):
        pic = os.path.join(self.tmp, 'shot.png')
        with open(pic, 'wb') as f:
            f.write(b'\x89PNG fake')
        made = self.cli_json('new', 'inbox', 'A screenshot', '--attach', pic)
        self.assertEqual(len(made['fields']['attachments']), 1)
        with open(os.path.join(self.root, made['fields']['attachments'][0]), 'rb') as f:
            self.assertEqual(f.read(), b'\x89PNG fake')
        kept = self.cli_json('attach', 'STY-5', pic, '--name', 'checkout.png')['fields']['attachments']
        self.assertTrue(kept[-1].endswith('/checkout.png'))
        self.assertIn(kept[-1], self.cli('show', 'STY-5', '--no-body'))
        gone = self.cli_json('detach', 'STY-5', kept[-1])
        self.assertNotIn(kept[-1], gone['item']['fields'].get('attachments') or [])
        self.assertTrue(os.path.isfile(os.path.join(self.root, gone['trashed'])))
        self.assertIn('has no attachment', self.cli('detach', 'STY-5', kept[-1], code=1))
        self.assertIn('no such file', self.cli('attach', 'STY-5', os.path.join(self.tmp, 'nope.png'), code=1))
        self.assertIn('--name names one file', self.cli('attach', 'STY-5', pic, pic, '--name', 'x.png', code=1))
        self.assertTrue(self.store().check()['ok'])

    def test_a_file_too_big_is_refused_before_anything_is_written(self):
        big = os.path.join(self.tmp, 'big.bin')
        with open(big, 'wb') as f:
            f.truncate(vault.attachments.MAX_BYTES + 1)
        before = len(self.store().items())
        self.assertIn('at most 25 MB', self.cli('new', 'note', 'Too big', '--attach', big, code=1))
        self.assertEqual(len(self.store().items()), before)

    def test_a_vault_that_does_not_match_its_structure_is_read_but_never_written(self):
        os.makedirs(os.path.join(self.root, 'Random'))
        with open(os.path.join(self.root, 'Random', 'x.md'), 'w') as f:
            f.write('---\nfileClass: Ticket Note\n---\n')  # a note out of any folder notes live in
        self.assertFalse(self.store().check()['ok'])
        self.assertIn('does not match', self.cli('overview'))
        self.assertIn('read-only', self.cli('new', 'note', 'Nope', code=1))


class AuditListFieldsTest(SampleCopy):
    """tools/audit_list_fields.py: what the two defects left in a vault, read without writing anything."""

    # The chopped line a vault damaged before SUP-5291 carries, byte for byte as the old code left it: the Store was
    # handed `labels='agentic-system'` and `list(v)` wrote its fourteen characters.
    CHOPPED_TAGS = 'tags: ["a", "g", "e", "n", "t", "i", "c", "-", "s", "y", "s", "t", "e", "m"]'

    def damage(self):
        """The two shapes the CLI used to write: a list field kept one character per element, and a link field given a
        ref that names no item.

        The chopped one is written **straight to the file**, not through the Store. It used to be made through the
        Store, because the Store did it — SUP-5291 closed that (`store.as_list` + `clean_labels` at the validator,
        `codec._as_list` behind it), and a fixture that asks the code under test to produce the damage would now
        quietly test nothing. This is what the audit is for in the first place: damage already on disk, left by a
        version of the app that is gone."""
        s = self.store()
        rel = s.find('STY-5')['path']
        path = os.path.join(self.root, rel)
        with open(path, encoding='utf-8') as f:
            text = f.read()
        swapped = re.sub(r'(?m)^tags:.*$', self.CHOPPED_TAGS, text, count=1)
        self.assertNotEqual(swapped, text, 'STY-5 carries a tags line to damage')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(swapped)
        s.update(s.find('STY-6')['key'], {'origin': 'NOPE-999', 'depends_on': ['NOPE-998']})
        self.assertEqual(self.store().read('STY-5')['fields']['labels'][:3], ['a', 'g', 'e'], 'the file is damaged')

    CLI = os.path.join(APP_DIR, 'tools', 'vault.py')

    def test_it_finds_a_chopped_list_and_a_link_to_nothing_and_writes_nothing(self):
        before = {rel: os.stat(os.path.join(self.root, rel)).st_mtime_ns
                  for rel in (it['path'] for it in self.store().items())}
        items, chopped, missing, elsewhere = audit_list_fields.audit(self.CLI, self.root)
        self.assertEqual((chopped, missing, elsewhere), ([], [], []), 'the sample vault is clean')
        self.assertEqual(len(items), len(before))
        self.damage()
        _, chopped, missing, elsewhere = audit_list_fields.audit(self.CLI, self.root)
        self.assertEqual([(k, text) for _, k, text in chopped], [('labels', 'agentic-system')])
        self.assertEqual(sorted((k, name) for _, k, name in missing),
                         [('depends_on', 'NOPE-998'), ('origin', 'NOPE-999')])
        self.assertEqual(elsewhere, [], 'a prefix that is no type of the vault names nothing, here or anywhere')
        # It reads: every file it did not need to change is untouched (the two the damage wrote aside).
        after = {rel: os.stat(os.path.join(self.root, rel)).st_mtime_ns for rel in before}
        self.assertEqual({rel for rel in before if before[rel] != after[rel]},
                         {self.store().find(ref)['path'] for ref in ('STY-5', 'STY-6')})

    # The line a real Projects vault carries, read off the owner's: a link field holds a wikilink, and the stem is
    # the note's file name — the ref AND its title. A fixture written through the Store instead (`{'goal': 'GOL-331'}`
    # → `[[GOL-331]]`, the form the Store writes when it cannot resolve it) is a ref with no title, which is exactly
    # why the first version of this test passed while the real vault came back wrong.
    GOAL_LINE = 'goal: "[[GOL-900 Grow the team]]"'

    def names_a_goal_of_the_other_vault(self, ref='STY-5'):
        """`ref` naming a goal that lives in the other vault, written into its frontmatter as the vault has it."""
        rel = self.store().find(ref)['path']
        with open(os.path.join(self.root, rel), encoding='utf-8') as f:
            text = f.read()
        # Its own goal line if it has one (the sample's STY-5 names a goal of the vault), else a new one.
        swapped = re.sub(r'(?m)^goal:.*$', self.GOAL_LINE, text, count=1)
        with open(os.path.join(self.root, rel), 'w', encoding='utf-8') as f:
            f.write(swapped if swapped != text else text.replace('---\n', f'---\n{self.GOAL_LINE}\n', 1))
        self.assertIn('GOL-900 Grow the team', str(self.store().read(ref)['fields'].get('goal')))

    def test_a_link_to_a_type_the_vault_holds_none_of_is_the_other_vault_s_not_damage(self):
        """A vault that keeps all of its goals in another one names them all that way, and no goal of it will ever
        answer. Telling the owner to put those back would break the rule that keeps them: the link is right, and
        making a local goal to silence it is the defect."""
        self.names_a_goal_of_the_other_vault()
        # While this vault keeps goals of its own, a goal it has not got is one that is missing.
        _, _, missing, elsewhere = audit_list_fields.audit(self.CLI, self.root)
        self.assertEqual([(k, name) for _, k, name in missing], [('goal', 'GOL-900 Grow the team')])
        self.assertEqual(elsewhere, [])
        for goal in [it for it in self.store().items() if it['type'] == 'goal']:
            self.store().delete(goal['key'])
        # With none of its own, the prefix cannot name an item of this vault: it is the other vault's.
        _, _, missing, elsewhere = audit_list_fields.audit(self.CLI, self.root)
        self.assertEqual((missing, [(k, name) for _, k, name in elsewhere]),
                         ([], [('goal', 'GOL-900 Grow the team')]))
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            self.assertEqual(audit_list_fields.main([self.CLI, self.root]), 0)
        said = printed.getvalue()
        self.assertIn('nothing to put back: 1', said)
        self.assertIn('Nothing was written. Nothing to put back.', said)
        # And where both are true of one field, --outside says so for it.
        self.store().create('goal', 'A goal of its own')
        _, _, missing, elsewhere = audit_list_fields.audit(self.CLI, self.root, outside=['goal'])
        self.assertEqual((missing, [(k, name) for _, k, name in elsewhere]),
                         ([], [('goal', 'GOL-900 Grow the team')]))

    def test_every_form_a_ref_is_written_in_gives_up_its_type_prefix(self):
        """The prefix is read from the first word, never anchored at the end of the value: anchoring it is what made
        5b07721 read nine correct links as damage, since every one carried its goal's title."""
        self.assertEqual([audit_list_fields.prefix_of(n) for n in
                          ('GOL-900 Grow the team', 'GOL-331', 'XXX/INI-428', 'XXX/INI-428 Algo',
                           'ACME-STY-001', 'NOPE-999', 'Not a ref', '')],
                         ['GOL', 'GOL', 'INI', 'INI', 'STY', 'NOPE', '', ''])


class EveryTypeTest(SampleCopy):
    """Each type of the vault can be made from the shell with what `types` says it needs, and nothing else: a type
    added to a structure that needs more than the CLI can say fails here."""

    def make_every_type(self):
        s = vault.open_store(self.root)[0]  # as the CLI opens it: the structure it detects
        rows = self.cli_json('types')
        self.assertEqual({r['type'] for r in rows}, set(s.structure.types))
        made = {}
        for r in rows:
            sets = []
            for need in r['needs']:
                key = need.split('=')[0]
                if key == 'project_key':
                    sets.append('project_key=ZZ')
                elif key in ('related_to', 'project'):
                    parents = s.structure.types[r['type']].parents
                    parent = next(it for it in s.items() if it['type'] in parents and it.get('ref'))
                    sets.append(f"related_to={parent['ref']}")
            argv = ['new', r['type'], f"Made from the shell {r['type']}"] + [a for kv in sets for a in ('--set', kv)]
            made[r['type']] = self.cli_json(*argv)
            self.assertEqual(made[r['type']]['type'], r['type'])
            # what `types TYPE` prints is the line that worked
            self.assertIn(f"`new {r['type']} \"<title>\"`", self.cli('types', r['type']))
        self.assertTrue(vault.open_store(self.root)[0].check()['ok'])
        return made

    def test_every_type_of_a_projects_vault(self):
        self.make_every_type()
        self.assertIn('project_key', self.cli('new', 'project', 'No key', code=1).split('here:')[1])
        self.assertIn('`--set related_to=', self.cli('new', 'plan', 'Orphan', code=1))
        self.assertIn('set by `new` only', self.cli('types', 'project'))


class LegacyVaultTest(SampleCopy):
    sample = LEGACY

    def test_a_legacy_vault_is_detected_and_written_by_its_own_structure(self):
        out = self.cli('overview')
        self.assertIn('Initiatives vault', out)
        data = self.cli_json('new', 'task', 'From the shell')
        self.assertEqual(data['type'], 'task')
        self.assertIn('From the shell', self.cli('show', data['ref'] or data['id'], '--no-body'))

    def test_every_type_of_a_legacy_vault(self):
        EveryTypeTest.make_every_type(self)


if __name__ == '__main__':
    unittest.main()
