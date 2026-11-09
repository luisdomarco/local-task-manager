"""One kind of item looks the same in every vault (tm/structures/traits.py): the same app fields, plannable or not by
the same rule, its parent titled by the same rule. Checked on every structure the server offers."""
import io
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'tools'))
import field_matrix  # noqa: E402
from tm.structures import REGISTRY, get  # noqa: E402
from tm.structures import traits  # noqa: E402
from tm.structures.ticketing.definition import INSTEAD  # noqa: E402

STRUCTURES = {sid: get(sid) for sid in REGISTRY}
# The app's fields a type carries in a way of its own in one structure (a Projects support ticket's level stands in
# priority's slot): the only differences allowed between structures.
SAME_EVERYWHERE = set(traits.TRAITS['work']) | {'labels', 'url', 'url_label', 'links', 'archived', 'comments', 'claude_sessions'}


def each_type():
    for sid, s in STRUCTURES.items():
        for name, t in s.types.items():
            yield sid, s, name, t


class TraitsTest(unittest.TestCase):
    def test_every_type_of_every_structure_is_a_known_kind(self):
        for sid, _, name, _ in each_type():
            self.assertIn(name, traits.KINDS, f'{sid}: {name} has no traits')

    def test_a_kind_carries_the_same_app_fields_in_every_structure(self):
        seen = {}
        for sid, s, name, t in each_type():
            mine = (set(t.fields) & SAME_EVERYWHERE) | set(INSTEAD.get(name, ()) if sid == 'ticketing' else ())
            seen.setdefault(name, []).append((sid, mine))
        for name, rows in seen.items():
            first_sid, first = rows[0]
            for sid, mine in rows[1:]:
                self.assertEqual(mine, first, f'{name}: {sid} and {first_sid} differ')

    def test_plannable_is_having_the_work_trait(self):
        for sid, _, name, t in each_type():
            self.assertEqual(t.plannable, traits.plannable(name), f'{sid}: {name}')
            if t.plannable:
                planning = {'due', 'plan_week', 'plan_day', 'plan_month', 'today_list', 'watchers', 'docs'}
                self.assertLessEqual(planning, set(t.fields), f'{sid}: {name}')
            else:
                self.assertFalse({'plan_week', 'plan_day', 'today_list'} & set(t.fields), f'{sid}: {name} is not plannable')

    def test_in_a_structure_with_projects_every_child_lives_in_one(self):
        for sid, s, name, t in each_type():
            if 'project' in s.types and 'child' in traits.traits_of(name):
                self.assertIn('project', t.fields, f'{sid}: {name}')
            if 'project' not in s.types:
                self.assertNotIn('project', t.fields, f'{sid}: {name}')

    def test_a_type_without_an_id_is_never_related(self):
        for sid, _, name, t in each_type():
            if not t.has_id and name != 'project':
                self.assertNotIn('relations', t.fields, f'{sid}: {name}')

    def test_tracked_types_point_at_a_ticket_under_the_structure_keys(self):
        for sid, s, name, t in each_type():
            ref = s.external_ref or {}
            if 'tracked' in traits.traits_of(name) and ref.get('id_key'):
                self.assertIn(ref['id_key'], t.fields, f'{sid}: {name}')
                self.assertIn('local_path', t.fields, f'{sid}: {name}')
            elif 'tracked' not in traits.traits_of(name):
                self.assertNotIn('local_path', t.fields, f'{sid}: {name}')

    def test_the_parent_is_titled_by_one_rule(self):
        for sid, s, name, t in each_type():
            labels = {n: d.label for n, d in s.types.items()}
            self.assertEqual(t.parent_label, traits.parent_label(t.parents, labels), f'{sid}: {name}')

    def test_projects_and_initiatives_have_an_area_and_an_objective_of_the_app(self):
        for sid, s, name, t in each_type():
            aimed = name in ('project', 'initiative')
            self.assertEqual({'area', 'objective'} <= set(t.fields), aimed, f'{sid}: {name}')
            if aimed:  # drawn by the app in their own section, never again among the type's own props
                self.assertFalse({p['key'] for p in t.props} & {'area', 'objective'}, f'{sid}: {name}')

    def test_projects_initiatives_and_goals_have_a_start_date(self):
        for sid, s, name, t in each_type():
            self.assertEqual('start' in t.fields, name in ('project', 'initiative', 'goal'), f'{sid}: {name}')

    def test_no_folder_per_type_file_keeps_a_first_name(self):
        for sid, s, name, t in each_type():
            self.assertFalse(set(traits.RENAMED_KEYS) & set(t.fields), f'{sid}: {name}')


class HelpersTest(unittest.TestCase):
    def test_parent_label(self):
        labels = {'meeting': 'Meeting', 'task': 'Task'}
        self.assertEqual(traits.parent_label((), labels), '')
        self.assertEqual(traits.parent_label(('meeting',), labels), 'Meeting')
        self.assertEqual(traits.parent_label(('meeting', 'task'), labels), 'Parent')

    def test_with_parent_heading(self):
        cols = ['id', 'parent:Item', 'status']
        self.assertEqual(traits.with_parent_heading(cols, 'Meeting'), ['id', 'parent:Meeting', 'status'])
        self.assertEqual(traits.with_parent_heading(cols, ''), cols)

    def test_own_props_sit_before_the_hierarchy(self):
        fields = traits.fields_for('task', ('effort',))
        self.assertLess(fields.index('priority_reason'), fields.index('effort'))
        self.assertLess(fields.index('effort'), fields.index('related_to'))

    def test_drop_and_external_keys(self):
        ext = {'id_key': 'bug_id', 'url_key': 'bug_url', 'tracker_key': None}
        fields = traits.fields_for('support', ext=ext, drop=('priority', 'priority_reason'))
        self.assertIn('bug_id', fields)
        self.assertNotIn('ticket_id', fields)
        self.assertNotIn('tracker', fields)
        self.assertNotIn('priority', fields)


class FieldMatrixTest(unittest.TestCase):
    def test_every_row_sits_in_a_known_section(self):
        out = io.StringIO()
        self.assertEqual(field_matrix.main([], out=out), 0)
        data = json.loads(out.getvalue())
        self.assertEqual(set(data), {'Initiatives', 'Tasks', 'Projects'})
        for vault, v in data.items():
            for row in v['rows']:
                self.assertIn(row[0], traits.SECTIONS, f'{vault}: {row[1]}')
                self.assertEqual(len(row), 4 + len(v['types']))


if __name__ == '__main__':
    unittest.main()
