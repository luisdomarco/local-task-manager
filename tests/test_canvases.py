"""Canvases: a page's whiteboards (Goals' first) are Obsidian Excalidraw files in <Docs>/Canvases/<host>. The store
lists them with the rev a save goes against; they are made, saved, renamed and deleted as any vault file, never taken
for items, and a vault holding them still matches its structure."""

import os
import tempfile
import unittest

from tm.store import Store, StoreError

CANVAS = '''---
excalidraw-plugin: parsed
task-manager-canvas: Goals
---

# Excalidraw Data

## Text Elements
%%
## Drawing
```json
{"type": "excalidraw", "version": 2, "source": "task-manager", "elements": [], "appState": {}, "files": {}}
```
%%
'''


class CanvasesTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.realpath(tmp.name)
        for d in ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log'):
            os.makedirs(os.path.join(self.root, d))
        self.s = Store(self.root, structure='ticketing', enforce_structure=True)
        self.s.create('project', 'Internal Tools', {'project_key': 'HB', 'project_kind': 'system'})

    def test_none_until_the_first_is_made(self):
        self.assertEqual(self.s.canvases('Goals'), {'folder': 'Docs/Canvases/Goals', 'canvases': []})

    def test_made_listed_saved_and_never_an_item(self):
        before = sorted(i['key'] for i in self.s.items())
        made = self.s.create_file('Docs/Canvases/Goals/Roadmap.excalidraw.md', CANVAS, parents=True)
        self.s.create_file('Docs/Canvases/Goals/Q1 risks.excalidraw.md', CANVAS, parents=True)
        self.s.create_file('Docs/Canvases/Goals/notes.md', '# not a canvas', parents=True)
        self.s.create_file('Docs/Canvases/Agents/Flows.excalidraw.md', CANVAS, parents=True)
        listed = self.s.canvases('Goals')
        self.assertEqual([c['name'] for c in listed['canvases']], ['Q1 risks', 'Roadmap'])
        roadmap = listed['canvases'][1]
        self.assertEqual(roadmap['path'], made['path'])
        # Saved against the rev it was listed with; a second save on that old rev is a conflict.
        saved = self.s.save_file(roadmap['path'], CANVAS.replace('"elements": []', '"elements": [{"id": "a"}]'), roadmap['rev'])
        self.assertNotEqual(saved['rev'], roadmap['rev'])
        with self.assertRaises(StoreError) as e:
            self.s.save_file(roadmap['path'], CANVAS, roadmap['rev'])
        self.assertEqual(e.exception.status, 409)
        # Documents, never items; the vault still matches its structure.
        again = Store(self.root, structure='ticketing', enforce_structure=True)  # a fresh scan: it still matches
        self.assertEqual(sorted(i['key'] for i in again.items()), before)
        self.assertEqual(self.s.canvases('Agents')['canvases'][0]['name'], 'Flows')

    def test_a_host_is_a_plain_name(self):
        for bad in ('', '../Tasks', 'Goals/x', '.hidden', 'x' * 60):
            with self.assertRaises(StoreError, msg=bad):
                self.s.canvases(bad)


if __name__ == '__main__':
    unittest.main()
