# Moving a vault to the Projects structure

This guide is for Claude, working with the owner of the vaults. It moves an **Initiatives** (`folders`) or **Tasks**
(`tasks`) vault to **Projects** (`ticketing`): one vault where each initiative has a kind (product, agentic system or
simple, README §5). The tool is `tools/migrate_structures.py`. Its tests (`tests/test_migrate_structures.py`) run it on
copies of `sample-vault-legacy/` (Initiatives) and of a Tasks vault they build.

**Two rules hold at every step:**

- **The source folder is never written.** The tool writes a **new** folder, and the old one stays as it was until
  the owner decides otherwise.
- **The owner answers every question.** Ask about each proposed project and each open question before `--apply`.
  The tool refuses a plan with an unconfirmed project or an unanswered question.

## 1. When it applies

Read `config.json` (only read it, never edit it by hand) and list each vault with its `structure`:

- **`ticketing`**: nothing to migrate. An initiative without `initiative_kind` reads as its project's `project_kind`,
  and one whose project says none either as `product`. The owner widens a simple one from its page when it needs
  stories.
- **`folders` or `tasks`**: this guide applies, one vault at a time. Note the vault's `path` and, if it has them, its
  own `folders` (`{"task": "work/tasks"}`). The tool needs both.

## 2. Before anything

1. **Close the app**, or at least stop editing that vault. The plan records a hash of the whole source folder, and
   `--apply` refuses if anything changed after the plan.
2. **Take a backup** of the source folder: Settings → Export → the vault's zip, or a plain copy
   (`cp -R "<vault>" "<vault>.bak-<date>"`).
3. **Download every file.** In iCloud, a file not downloaded yet is a `.icloud` placeholder. Open the folder in
   Finder until there are none (right-click → *Download Now*). `--plan` refuses while there is one anywhere in the
   folder, `.task-manager/`, `Attachments/` and `docs/` included.
4. **Every item has an id.** A hand-written file without one makes `--plan` refuse: Settings → Maintenance → *assign
   ids* in the app first.

## 3. Plan

```bash
python3 tools/migrate_structures.py --plan "<vault>" --structure folders            # or: --structure tasks
python3 tools/migrate_structures.py --plan "<vault>" --structure tasks --folders '{"task": "todo"}' --out "<new folder>"
```

The new vault defaults to `<vault>-projects`, next to the source. The plan is written as JSON next to it
(`<new>.migration-plan.json`; `--plan-file` puts it elsewhere). The tool prints a summary; the JSON has the details:

| Key | What it is | Who edits it |
|---|---|---|
| `projects` | Each project to make: `key` (2–4 capital letters), `name` (its folder), `kind` (`product` · `system` · `simple`), `from` (the item it comes from), `why`, `confirmed` | You, with the owner's answers |
| `assign` | Each initiative and story → the key of its project | You, if the owner moves one |
| `questions` | What only the owner can say, each with `answered` | You set `answered: true` |
| `id_map` | Old id → new id (for information; `--apply` works it out again from `projects` and `assign`) | Nobody |
| `mentions` | Item texts that name an old id that changes | Nobody: see `--rewrite-bodies` |
| `status_map` | Each status the source uses that Projects does not have (one the vault added: *Waiting*…) → the Projects status it becomes, `null` until the owner says (each has a question) | You, with the owner's answers |
| `retitled` | Titles a file name cannot hold (`: / ? # [ ] \| ^ " < > *`, or past 120 characters): each with the title it becomes; the old one is kept in its `aliases` | Nobody: tell the owner |
| `linked` | How many item texts have wikilinks to items; `--apply` rewrites every one to the item's new file name | Nobody |
| `not_migrated` | Files that are neither an item, a work-log day, a doc nor an attachment (and hidden folders such as `.obsidian/`) | Nobody: tell the owner |
| `counts`, `high_water`, `source_digest` | What `--check` compares against | Nobody |

**What the tool proposes:**

- **A Tasks vault.** Each of its projects becomes a project with the same key, of kind `simple`, because a Tasks vault
  has no stories. An initiative goes to the project its `project:` names, or to the project of the initiative it hangs
  from.
- **An Initiatives vault.** An initiative with sub-initiatives (its epics) becomes a project named after it. Its kind is
  `product` if its tree has stories, else `simple`. The initiative itself and all its sub-initiatives become
  initiatives of that project.
- **Everything else** goes to a project called **General** (`GEN`). This covers initiatives nothing placed and stories
  with no initiative. Each of them gets a question.

**Ask the owner, one project at a time:** its name, its key and its kind: the kind every initiative moved into it gets
(`initiative_kind`; README §5: a product or an agentic system initiative has stories, a PRD and readiness, and gives
its project support tickets and hotfixes; a simple one has only tasks, notes and meetings). The owner widens any of
them later from its page; it is also written as the project's `project_kind`, which an initiative made there without a
kind of its own reads. Then ask each question. Write the
answers into the plan:

- Set `confirmed: true` on each project.
- To move an item, change its project in `assign`. A story must go to the same project as its initiative, and to a
  project whose kind has stories.
- For each status in `status_map`, write the Projects status it becomes (one its types have: `Backlog`, `ToDo`,
  `OnHold`, `InProgress`, `Review`, `Done`, `Discarded` for a task).
- A project's name is its folder: not one of the vault's own (Tasks, Notes, Meetings, Inbox, Activities, Agents,
  Prompts, Transcriptions, Docs, Work log, Attachments), and not two that differ only in capitals.
- If a key changes, change it in `projects` and in every `assign` entry that names it.
- To add a project the owner wants, add it to `projects` with `"from": null`, and assign items to it.
- Set `answered: true` on each question.

## 4. How things map

| Initiatives / Tasks | Projects |
|---|---|
| `initiatives/INI-0001-….md` | `<Project>/Initiatives/KEY-INI-0001 <Title>.md` (the number is kept, the key put in front) |
| `stories/US-0001-….md` | `<Project>/Stories/KEY-STY-0001 <Title>.md` |
| `tasks/` `notes/` `meetings/` `inbox/` `activities/` | `Tasks/` `Notes/` `Meetings/` `Inbox/` `Activities/`, same ids (`TSK-0001`) |
| `agents/` `prompts/` `transcriptions/` | `Agents/` `Prompts/` `Transcriptions/`, same ids |
| `projects/PRJ-0001-….md` (Tasks) | `<Project>/00 <Project>.md`; the project is known by its key, so `PRJ-0001` becomes `KEY` everywhere |
| `worklog/<year>/<date>.md` | `Work log/<year>/<date>.md`, its ids renamed |
| `docs/` | `Docs/`, as it is but for its wikilinks to items, which follow their new file names |
| `Attachments/` | `Attachments/`, as it is (each item's `attachments` paths still point there) |
| `type: initiative` | `fileClass: Ticket Initiative` (each type its own) |
| `subject` | the file name and title |
| `status: InProgress` | `status_ticket: "4. InProgress"` |
| `status: Blocked` | `status_ticket: "3. OnHold"` with `on_hold: {by: owner, why: "Blocked (migrated)"}` (Projects has no Blocked) |
| a status Projects has not (`Waiting`) | the one `status_map` says |
| `[[TSK-0001-benchmark-pricing]]` in a text or a doc | `[[TSK-0001 Benchmark pricing]]`: every wikilink to an item follows its new file name |
| `priority: Urgent · High · Normal · Low` | `priority: P0 · P1 · P2 · P3` |
| `labels` | `tags` |
| `created_at` / `updated_at` | `creation_date` / `updated_date` (the day) |
| `completed_at` of a closed item | a `status_log` entry on that day, `by: migration` |
| `related_to: INI-0001` | `initiative: "[[KEY-INI-0001 Title]]"` (a story), `related_to: "[[…]]"` (a task, a note…) |
| `relations`, `relation_kinds` | the same, as wikilinks; *Blocked by* towards a type its `depends_on` takes goes there |
| `project: OPS` (Tasks) | `project: "[[00 Operations]]"`; a task, note or meeting with none takes the project of what it hangs from |
| an epic (`related_to` another initiative) | an initiative of the same project, with a `relates` relation to the one it hung from (Projects has no sub-initiatives) |
| a key the format does not know (`tracker`, `user_stories`…) | kept as it is |
| an item whose id changes | its old id in `aliases: [INI-0001]`, the key the Projects templates keep it in (Obsidian searches it) |
| a title a file name cannot hold (`Re: pricing`) | the title without those characters (`Re pricing`), the old one in `aliases` |

New files come from the Projects templates, so they carry the template's own defaults too: an initiative gets
`size: M`, `regime: standard` and `premise: unverified`, the same as one made in the app. Each item's text (its body)
is carried over byte for byte.

**`.task-manager/`:**

| File | What happens |
|---|---|
| `ids.json` | Rebuilt from the highest number each prefix ever used: live items, the trash, the work log, converted inbox items and the old `ids.json`. A root prefix keeps its mark (`TSK`). Each project's `KEY-INI` and `KEY-STY` start at the old `INI` and `US` marks, so no number is ever handed out twice. |
| `legacy-ids.json` | New: the id map (old → new), for scripts and for looking up an old id. |
| `pins.md`, `sidebar.md` | Their ids go through the id map. |
| `board.md` | Its Blocked list is dropped (its cards are On hold now), or becomes On hold when there is no such list. |
| `statuses.json` | Only its colours are kept, for the statuses Projects has (Projects fixes their names and order). |
| `history/<id>.md` | Renamed to the new id. |
| `trash/`, `backup/` | Not carried over (old-format files). Their ids still count in `ids.json`. |
| anything else (`labels.md`, `people.md`, `groups.md`, `today.md`, `week.md`…) | Copied as it is. |

## 5. Apply

```bash
python3 tools/migrate_structures.py --apply "<new>.migration-plan.json"
python3 tools/migrate_structures.py --apply "<new>.migration-plan.json" --rewrite-bodies   # only if the owner says so
```

`--apply` refuses, and writes nothing, when:

- a project is unconfirmed or a question unanswered;
- a key or a kind is not valid, two projects share a key or a name (capitals do not count), or a project is named as
  one of the vault's folders;
- an initiative or a story has no project in `assign`, or a story is in another project than its initiative or in one
  whose kind has no stories;
- a status in `status_map` has nowhere to go, or goes to one its type does not have;
- the source changed since the plan;
- the new folder exists and is not empty, or `<new>.partial` is there (left by a run that was stopped: delete it).

It writes the new vault in `<new>.partial`, next to it, and moves it into place only once whole: an error halfway
leaves nothing behind, and the next `--apply` starts afresh.

**Item texts that name an old id** (`mentions` in the plan) are left as written unless `--rewrite-bodies`. Show the
owner the list and ask. Rewriting replaces each old id, as a whole word, with its new one (never inside a wikilink:
those are rewritten anyway, by file name).

## 6. Check

```bash
python3 tools/migrate_structures.py --check "<new>.migration-plan.json"
```

It prints ✓ and exits 0 when all of the following hold:

- the new vault matches the Projects structure (the same check the app runs);
- it has as many items of each type as the source, plus one project note per project;
- everything an item hangs from and every relation is in the vault;
- every ticket is in a project;
- no wikilink in the new vault still names a file of the source by its old name;
- no id is above its prefix's mark in `ids.json`;
- the source is unchanged since the plan.

Otherwise it prints each problem with ✗ and exits 1. Do not go on until it passes.

## 7. Switch

1. In the app: Settings → Vaults → add the new folder with the structure **Projects**, and open it.
2. Spot-check it with the owner:
   - a project page (its Initiatives, Issues, Briefs and Records);
   - an initiative with its stories and tasks;
   - Today and Week (what was planned is still planned);
   - the work log of a recent day.
3. **Only after the owner's OK:** make the new vault the default and remove the old vault's entry. The old folder is
   kept; deleting it is the owner's call, later.

## 8. Troubleshooting

| What you see | What to do |
|---|---|
| `does not match the folders structure` on `--plan` | The vault has a problem the app would show too. Open it in the app and fix what its notice says, then plan again. |
| `does not match …` naming an iCloud placeholder (`.Name.md.icloud`) | Download the folder in Finder (§2), then plan again. |
| `two items would be written to …` | Two items have the same id and title. Rename one in the source (in the app), then plan again. |
| `changed since the plan` | Something wrote to the source (the app, a sync, Obsidian). Plan again. |
| `two projects share a key` / `a project key is 2 to 4 capital letters` | Fix the key in `projects` and in `assign`. |
| `X goes to K, which is not one of the projects` | An `assign` entry names a key you changed. |
| `--check`: `hangs from …, which is not in the new vault` | The parent was not an item in the source either (a broken link there). Tell the owner; fix it in the new vault in the app. |
| `--check`: a count differs | A file in the source could not be read as an item. Look at `not_migrated` and at the source in the app. |
