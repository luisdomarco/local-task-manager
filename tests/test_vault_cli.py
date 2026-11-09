"""tools/vault.py and what it stands on: the vault's lock across processes (tm/fsutil.vault_lock, taken by every Store
write), relations written where the panel writes them (relations.relation_writes, Store.relate), and each command of
the CLI on a temp copy of the sample vaults. Never a real vault."""
import io
import json
import os
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
from tools import vault
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
        self.assertEqual(sorted(refs), ['STY-5', 'STY-6', 'STY-8'])
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

    def test_set_changes_only_the_keys_given_and_refuses_one_the_type_lacks(self):
        path = self.store().find('STY-5')['path']
        before = self.file(path)
        self.cli('set', 'STY-5', 'priority=P1')
        changed = {a.split(':')[0] for a, b in zip(before.splitlines(), self.file(path).splitlines()) if a != b}
        self.assertLessEqual(changed, {'priority', 'updated_date'})
        self.assertIn('priority', changed)
        self.assertIn("has no field 'bogus'", self.cli('set', 'STY-5', 'bogus=1', code=1))
        self.assertIn('nothing to set', self.cli('set', 'STY-5', code=1))

    def test_set_with_a_stale_rev_is_refused(self):
        rev = self.cli_json('show', 'STY-5')['rev']
        self.cli('set', 'STY-5', 'priority=P1')
        self.assertEqual(self.cli_json('set', 'STY-5', 'priority=P3', '--rev', rev, code=1)['status'], 409)

    def test_move_goes_through_the_gates_an_agent_has(self):
        out = self.cli('move', 'STY-5', 'todo', code=1)
        self.assertIn('initiative approved', out)
        self.assertIn("no status 'Nope'", self.cli('move', 'STY-5', 'Nope', code=1))
        self.cli('move', 'STY-5', 'onhold', code=1)  # OnHold needs its reasons too: never moved without them
        self.assertEqual(self.store().read('STY-5')['fields']['status'], 'Backlog')

    def test_link_unlink_and_comment(self):
        self.cli('link', 'STY-6', 'blocked', 'STY-5')
        self.assertEqual(self.store().read('STY-6')['fields']['depends_on'], ['5'])
        self.cli('link', 'STY-5', 'precedes', 'STY-8')
        self.assertEqual(self.store().read('STY-5')['fields']['relation_kinds'], {'8': 'precedes'})
        self.cli('unlink', 'STY-5', 'STY-6')
        self.assertEqual(self.store().read('STY-6')['fields']['depends_on'], [])
        self.cli('comment', 'STY-5', 'Ask the PSP about tokens')
        self.assertEqual(self.store().read('STY-5')['fields']['comments'][-1]['text'], 'Ask the PSP about tokens')
        self.assertTrue(self.store().check()['ok'])

    def test_a_vault_that_does_not_match_its_structure_is_read_but_never_written(self):
        os.makedirs(os.path.join(self.root, 'Random'))
        with open(os.path.join(self.root, 'Random', 'x.md'), 'w') as f:
            f.write('---\nfileClass: Ticket Note\n---\n')  # a note out of any folder notes live in
        self.assertFalse(self.store().check()['ok'])
        self.assertIn('does not match', self.cli('overview'))
        self.assertIn('read-only', self.cli('new', 'note', 'Nope', code=1))


class LegacyVaultTest(SampleCopy):
    sample = LEGACY

    def test_a_legacy_vault_is_detected_and_written_by_its_own_structure(self):
        out = self.cli('overview')
        self.assertIn('Initiatives vault', out)
        data = self.cli_json('new', 'task', 'From the shell')
        self.assertEqual(data['type'], 'task')
        self.assertIn('From the shell', self.cli('show', data['ref'] or data['id'], '--no-body'))


if __name__ == '__main__':
    unittest.main()
