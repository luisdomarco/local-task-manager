# Changelog

All notable changes to this project are written down here. Versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

- **Settings → Themes.** Pick how the app looks in this browser: **Classic** (as it always was) or **Modern** (larger
  text and controls, Radix colours, a look of your own), Light, Dark or System, and for Modern a density
  (Comfortable, Compact) and a **look**: a preset (Modern, Ink, Paper, Ocean, Grape, Forest, Terminal) or each option
  on its own — base colour, accent (18 colours or Mono), the sidebar's background, the canvas (plain, tinted,
  gradient), corners, the text's and the headings' font, translucent menus, the icons' weight — with Shuffle, Reset
  and a preview that changes as you choose. In Modern the primary buttons and what is on or checked take the accent.
  It applies at once, is kept in the browser, and every open tab follows it. Modern is built on
  [Basecoat](https://basecoatui.com) (shadcn's look, in plain CSS) and Radix colours, every pair checked for contrast:
  its buttons, chips, selects, menus, tabs, dialogs, notices, checkboxes, switches and empty states are Basecoat's, its
  date picker shadcn's calendar, its tooltips drawn by the app (never cut by a panel); and every screen takes its look
  — the sidebar marks the page you are on in the accent, tables have 40px rows (32 compact), board cards, Agents' runs,
  the graph's settings, the Canvas and a chat's message box are rounded cards with a soft shadow, an item's status is a
  badge in its colour, today is in the accent in Today and Planning, Settings' on/off choices are switches and Markdown
  reads with lighter headings. Classic looks as it always did.

## [1.4.0] — 2026-11-09

**Highlights.** **Agents**: your Claude Code commands become agents you run, watch and schedule — a home, an Inbox of
every run, a page per agent with its figures, runs in a worktree, schedules that wake the app. **Projects** is the
structure a new vault gets, with short ids and **Goals** (a list, a board and a canvas). Every list has the same view
bar — filters, order, groups, columns, boards and saved views — and the vault has an Obsidian-like **Graph** and
**Docs**. A sample vault that looks like a team's week, and a README that shows it all.

- **A README that shows the app.** New screenshots of every main screen, in light: the agents (from a task, any
  prompt, an item's sessions, the Inbox, an agent's page, the home), boards, lists, planning, goals and their canvas,
  the graph, docs and search.
- **A sample vault that looks like a real week.** `tools/seed_sample_vault.py` now adds goals, a team of six, work in
  every status, priority and size, today's and this week's plan, meetings, richer docs, agents and prompts and a week
  of logged time — every status reached through the same rules a person's moves go through. The first items keep
  their ids (STY-5, INI-1…).
- **The Inbox is a table.** As a type's list: search, **Filter** (status, folder, agent, where it was started, seen,
  worktree), **Order** (or a column's head), **Group** (what it asks of you, status, folder, agent, day, where it was
  started; each group folds), **Display** (hide columns) and pages of 20; the board keeps a column per status, an
  empty one folded, and its columns move (drag a head, or Shift+←/→). The view is kept by this browser, the old status, folder and source filters included.
- **An agent's figures in its side panel.** Its last run, runs, success, usual time and cost — and now its **cost per
  run** — are the right panel's first tab, **Overview**, one per row as an item's properties; the page under its head is
  its tabs alone, their content level with the title. *Where* is as tall as Run, and an empty **Favourites** is not
  shown in the sidebar.
- **The Inbox as a board.** *List · Board* in the Inbox's bar: the board has a column per status — Needs you,
  Working, Done, Failed, Stopped — each with its runs as cards. The Inbox and the Agents Home take the whole width.
- **An agent's page, tidier.** Its figures are one slim row and stay in sight however long its instructions are (they
  could vanish); the description has as much room above as below; the actions read ☆ · Run · folder · Schedule… ·
  Open in. An unfolded skill or subagent shows its name, then its path with Preview · Source · Edit, then what it is
  for, then the file. The Schedule dialog's rows sit in from their titles, with a line only between *When* and *Run*,
  and every field ends on the same edge.
- **One width for every right panel.** An item's card, an initiative's, project's or PRD's page and an agent's page
  show their right panel at the same width: 500px on a wide screen, narrowing alike on a smaller one (it was 500, 420
  and 360).
- **An agent's files read and edit as the Explorer's.** On an agent's page, its Instructions and every skill,
  subagent and file it works with (unfold its row) show with **Preview · Source · Edit**: Edit saves as you type, and a
  file changed on disk meanwhile is never written over — it asks. The page takes the whole width; the title looks as
  an item's does, the description sits under the buttons at full width, and *Open in Cursor* is gone from it.
- **Favourites in the Agents mode.** Star an agent (☆ on its page, or *Add to Favourites* in its ⋯) and it is listed
  under **Favourites**, on top of the sidebar's folders, as initiatives are in the Projects mode. What was pinned is
  there already. The *All agents* tab and the Home's *All agents →* are gone: the sidebar lists them.
- **A tidier Schedule dialog.** Its fields are two groups, *When* and *Run*, one choice a row, as Settings lays them
  out; the notes about permissions and a sleeping Mac are gone from it.
- **A vault gone no longer blocks Settings.** A vault whose folder was moved or deleted outside the app made every save
  of Settings fail with *not a directory* — even adding an agent folder. It now stays in Settings → Vaults with *Folder
  not found* (give its new place, or remove it) and the rest saves; a new vault, a new folder or the default vault
  must still exist.
- **A calmer sidebar and cursor.** The Agents mode always shows Home and Inbox, also before any folder is added (no
  text and no button any more: **+** in its bar adds one), and has no *Add item*, which makes vault items. The cursor
  is the arrow over labels and headings, the I-beam only where you type: it no longer flickers as the mouse crosses
  the words. With no folder yet, the Agents page says what it is for in one line, beside *Add folder*.
- **Choose a folder instead of typing it.** On a Mac, every field that asks for a folder — a vault's in Settings →
  Vaults, *Add a folder* in Settings → Claude and Settings → Agents, and the Agents mode's *Add folder* — has
  **Choose…** beside it: a Finder dialog opens at the folder the field names (or your home folder) and the one you pick
  goes into the field. Typing the path still works.
- **A board's columns move.** On any list shown as a board (Projects, Initiatives, Stories, Tasks…, and the Board
  page), drag a column by its header — or a folded one by its strip — to put it elsewhere, or focus its header and
  press Shift+←/→. The order is kept with the board's view and for each grouping on its own (Status, Priority,
  Project…); **Order** only sorts the cards inside each column, never the columns. New columns come after the ones you
  placed; *Group → Reset column order* goes back to the usual order. Dragging cards works as before.
- **A ticket may be in no project, and change or drop its parent.** An initiative, a story, a spec, a support ticket,
  a hotfix or a PRD can be created with no project and no parent, and, with short ids, its Parent (Relations) changes
  either: ✎ offers the projects and what it may hang from in any project or none (picking an item brings that item's
  project along), × on its item lets go of it and keeps its project, × on its project takes it out of every project —
  each with Undo. A ticket in no project lives in its type's folder at the top of the vault (`Initiatives/`,
  `Stories/`, `Records/Errors/`…, made with the first), with what hangs from it moved along; its id has no project key
  (`INI-001` in a vault with long ids). A plan still always hangs from an item, and a plan, analysis, error or learning
  follows its item's project. Long ids still cannot move (docs/migrate-short-ids.md). No project can be named after
  one of these folders.
- **A run's ending reads truer.** A run whose turn finished is *Done* even if its process then ends with an error code
  (closing it in the dock may end it with one), and a run that never finished a turn is no longer *Done*: *Failed* if
  its process crashed, *Stopped* otherwise (it ended cleanly, or the app lost sight of it). Stop is still *Stopped*.
- **An agent's page, rebuilt, and one place to run it.** Run now opens the agent in the dock with `/<name> ` written
  and nothing sent: you type its arguments, pick the mode and model there and send — the page has no composer of its
  own any more, so a run no longer shows two. It starts with what the agent last ran with; the run is listed when its
  first message goes, and closed unsent it leaves nothing (nor its worktree). The page is a head (where it lives, its
  name and description, Run · Schedule… · Open in ▾ · ⋯), a row of figures for the last 30 days (last run, runs,
  success, usual time, cost) and tabs: **Instructions**, then **Skills**, **Subagents**, **Commands** and **Files** —
  what its prompt names in its folder, and what those name in turn, each tab only when it has some, each row unfolding
  into the file — and **Details**. The Home has no launcher any more: an agent starts from its page, or from ▷ in *Your agents*. Also: an `argument-hint` written
  `[topic]` shows as written, not as `['topic']`.
- **Agents has a Home.** `#/runs` opens on one screen of what needs you and what happened: the runs that need you while
  there are any, what runs now (with Stop), the schedules that fire next (with Run now), your agents — the pinned ones,
  then the most run lately — and the latest results, with the last 7 days in one line. The Inbox moves to
  `#/runs/inbox`; the tabs are Home · Inbox · All agents, and the sidebar has a Home row above the Inbox.
- **Agents, made for watching many at once.** `#/runs` is now an **Inbox**: every run of every agent grouped by what
  it asks of you — Needs you, Running, Unread, Earlier — with a search, filters and *Mark all read*. The sidebar's
  Inbox row, the agents' rows and the Agents mode's button show what needs you, and a run that waits for you or ends
  is told (a toast, or a system notification when the tab is behind). An agent's page has a **composer** like a
  chat's: the command and its arguments in one box, Mode · Model · Effort · Where as pickers, then Schedule…, Open in
  ▾ and Run. A run opens **its detail** in the side panel — status, cost, turns, where it ran, Stop, Open in dock — with
  its **Changes**: the files its folder changed since it started, each with its diff. **New worktree** runs an agent
  in a git worktree of its own, on a new branch, so your folder stays as it is (*Remove worktree* keeps the branch).
  And agents can be **scheduled**: every day, every weekday, on some days or every few hours, run by the app whether
  it is open or not (the installed app is woken for them), each run unread in the Inbox when it ends.
- **Agents: run your Claude Code commands from the app.** A third sidebar mode (⌘⇧E goes round Project, Explorer and
  Agents) lists the commands in the `.claude/commands` of any folder you add — a repository, a system, outside every
  vault — by folder and namespace, with a filter, pinned agents on top and hidden ones out of the way. Each agent has a
  page: what it does and the arguments it expects, the mode, model and effort it starts with, the exact message it
  sends, and its definition (its fields, allowed tools and prompt). **Run** starts it as a chat in the dock, in its own
  folder, where its questions and permissions are answered with a click; **Open in ▾** starts it in Terminal, Claude
  Desktop, Cursor or Antigravity instead. On the right, its **Runs**: every run of it on this computer, live ones with
  a dot, each opened again in the dock or elsewhere from its row. Folders are added from the sidebar or in
  Settings → Agents.

- **The README shows the app as it is now**: new screenshots, light only, all on the Projects sample vault — an
  initiative's page, Planning, a story's card, ⌘K, Goals, every item in one list and Docs. The dark variants are gone.
- **Goals has a Canvas**: a whiteboard (Excalidraw) beside List and Board, with the open goals in a column that folds.
  Drag goals in (or click one); each is a card like a board's — title, ID, status, priority, progress — that keeps up
  with its goal and opens it as a card over the canvas. Around them: shapes with text, arrows that stay bound to what
  they join (elbow by default, straight or curved) and leave or meet a shape only at the middle of a side — its four
  dots show on hover, drag from one to draw an arrow, click an arrow and drag an end to point it elsewhere —, sticky notes, colours, frames, and a Library of flow figures (gateways, events,
  task, decision, lane). Several canvases per page, each a `Docs/Canvases/Goals/<Name>.excalidraw.md` file that
  Obsidian's Excalidraw plugin opens too; saved as you draw, safe against edits made elsewhere. Built to go on other
  pages next (a provider: `docs/design.md` → Canvases). New shapes are filled white, so they drag from anywhere
  inside them, not only by their outline.
- **Board cards show their status** (its dot and name) before the priority, as the lists do; *Display → Show on
  cards → Status* turns it off. A board grouped by status leaves it out (its columns say it).

- **Work log is a list**: the bar of every list — search, **Filter** (Kind, Entry, Item type), the date range as a
  button, **Group** (Day, Week, Item, Kind or None) and **Display** (Suggestions, the columns) — and its groups as a
  list's, each with its entries and time. The kind totals and the summary line under the bar are gone: Group by Kind
  gives the totals. Filter, Group and Display are remembered per vault.
- **Contacts has no count beside its title**: People and Groups carry theirs in their tabs.

- **Fields keep the text's size in a narrow window**: the 16px fields (so iOS does not zoom in) are for phones only; a
  desktop window under 760px wide no longer blows up every input, select and Settings with them.

- **A detail always opens on its first tabs**: Overview and Properties (Activity on a narrow screen, where it used to
  open on Time), whatever was open last time; the tab you pick holds while the card or page stays open. A minimized
  card and Back still come back as they were.
- **Work log, Labels, Contacts and Trash look like the lists**: the title with a grey count beside it and the primary
  button at the right, the same search box, rows with ✎ and × on hover, an empty page a quiet grey line instead of a
  box. Contacts' People · Groups are tab links with their icons; Trash's *Empty trash* is a red ghost button; Work log's
  *Suggestions* is Hide · Show.
- **Settings in rows, its fields in a soft grey frame**: always on (a shade darker on hover), Statuses' too, and its
  text at the lists' size, the notes under a section or a field a little smaller; a row's ×,
  an export's download and Show in Finder show on hover; *Item type status* is **Statuses**, whole in its tab; App's
  server facts are property rows. Export works as before.
- **Show hidden files**: the eye by the Explorer's and Docs' filter lists dotfiles too (`.obsidian/`, `.gitignore`,
  `.DS_Store`), dimmed, and they are edited, renamed, moved and deleted like any file; one switch for both, per vault.
  `.git` and `.task-manager` stay sealed (a lock: never opened or changed), and an item is never moved or renamed under a
  hidden name.
- **Docs, as a place of your own**: **+** on a section offers **New doc** or **New folder**, so a doc can start at the
  top of a project's Docs or of *No project* (docs of no project), the Docs folder made with it when it is missing.
- **Docs' panel resizes** as the sidebar does (drag its right edge, ←/→, double-click resets), up to half the window.
  The sidebar, Docs and the terminal dock now share one grip (`resizer.js`).
- **Open in <App>**: a file the page cannot show (`.xlsx`, `.docx`, `.key`, `.zip`…) offers to open it in the app this
  Mac opens it with, named on the button; also *Open in its app* in the tree's menu. What could run (an executable, a
  file Terminal or Script Editor would open, a `.webloc`/`.fileloc` shortcut) is never handed over, and says why.
- A file created in the Explorer or Docs no longer opens as *not in the vault* when the list was already loading.
- **Goals** (a Projects vault): what to put first, across projects. A goal (`Goals/GOL-15 <Title>.md`) has a
  description, labels, start, due, planned, priority and its reason, the basic statuses (closed by hand), Activity, AI
  Agents and Docs, and notes under it. Projects, initiatives, stories and tasks join one goal at most (`goal:`, their
  place in `goal_order`). The **Goals** view, under Planning, shows each goal as a column (Board) or a section (List)
  with its items in order: drag an item into a goal; drag a goal to move it, taking the priority
  of those it lands among. A goal's page shows its progress and **+ Add items**. Lists of tasks, stories, initiatives
  and projects group and filter by Goal and have a Goal column (off by default); goals are planned like any item.
- The item picker (*+ Add items*, *Related to…*) shows each item's short id (`STY-482`).
- **Priority by name**: every card on every board and every row of Today and Planning shows its priority's bars and
  its name (*P2*), not the bars alone; on a phone a row keeps the bars.
- **Status on Today and Planning**: their rows and cards show the status, left of the priority.
- **Rows in columns**: on Today, Planning and Goals a row's status, priority and date sit in columns of one width,
  so they line up down the list, in that order.
- **A goal's page lists every kind it can hold**: Projects, Initiatives, Stories, Tasks and Notes, in that order, even
  when empty; *+ Add project / initiative / story* picks an open one that is in no goal.
- **Goals board**: *No goal* is gone (from the board and the list); **Add a goal** is the board's last column, as
  *Add another list* on other boards.
- **Relations, each link once**: Parent, Goal and every link field show what they name as one row — its name opens it,
  ✎ picks another, × clears it —, no longer a filled picker over the same item. Both are always there: where one
  cannot act (an initiative is always in a project, a story always hangs from one), it is faint and a click says why. An item's card and page no longer draw
  its graph (the Graph view does).
- **A ticket moves to another project** (a vault with short ids): its Parent's ✎ *Move to another project* moves its
  file to that project's folder, with what hangs from it there (an initiative's stories, plans and analyses).
- **Planning's rows on a narrow page**: where a row belongs and its dates give way before its subject does.
- **Planned is edited in place** on every list, as Status and Priority are (red when late, "Not planned" grey); on a
  phone it still reads as text. The selects of a row stay inside their column: Status no longer covers Priority.
- **A status pill lines up**: its dot, its name and its chevron sit on the same pixel row (by an item's title too).
- **Boards, one column width**: every board's columns (the Board page, a list as a board, Today's, Week's and Month's)
  are as wide as `--board-col-w` (272px), set in one place in app.css; a column's count sits right by its name.
- **Cards without ID and labels**: a board's card shows priority, planned and where it hangs; ID, labels and the rest
  come back with *Display → Show on cards*.
- **No Add task on Board, Today and Planning**: they add from their columns and quick adds.
- An inbox item's **Convert to** and an activity's **Mark resolved** move to the left of the Claude button.
- **Projects' list**: the key as the ID column, first, then Status and Priority (editable), Planned, Start, Due, Labels,
  Kind, Execution and Updated; closed projects hide as on other lists; group by status, priority or planned.
- **The Graph, as Obsidian's** (design.md §3 Graph): grey nodes, faint lines and names that come in as you zoom; a hover
  lights a node and its links in violet and dims the rest. The canvas fills the page under its title, and its settings
  float over the top right in four folding sections: **Filters** (a search with `type:`, `status:`, `path:`, `project:`
  and `-not`; Closed, Orphans, a project, the types as pills, the kinds of link), **Groups** (colour by type, or your own
  searches with a colour each), **Display** (arrows, text fade threshold, node size, link thickness, Animate) and
  **Forces** (center, repel, link, distance). All of it is kept per vault; an item's own small graph keeps its colours.
- **Save as view**: by the filter chips and at the foot of Display, a list's or a board's filters, grouping, order and
  display are kept under a name and listed in the sidebar's **Views** (under Favourites); opening one draws its page as
  it was saved, it is lit while the page still shows it, and × removes it with Undo. Per vault, in this browser.
- **Display → Show on cards** on a board: Priority, ID, Planned, Due, Labels, the parent, Project and the outside
  ticket, each on or off (Due, Project and the ticket start off).
- **Project in the bulk bar**, where every ticked item can change it (not a ticket): one Undo, and what an item hangs
  from is let go when it lives in another project.
- **Filter chips** as the mockup draws them: an outlined pill, "Project is" grey and the values dark; Display's pills
  are dark while on.
- **Planning on the lists' line**: one head for Week, Next week and Month — *Planning*, **Day | Week | Month**,
  `‹ This week ›` and the range — in place of the section tabs, and the view bar on Today, Week and Month (no search on
  Today; Show closed None / All; each page's own layouts). Sections and quiet rows instead of boxes:
  - **Today**: Schedule (the day's meetings), Carried over (*Move all to today*), Today with a quick add, and *2 done
    today · Show*; its board of your own columns takes the lists' board look, with Meetings first.
  - **Week**: an agenda — empty days in a row share one line, today underlined, meetings on their day, *Next week*
    at the foot; the Board folds past and empty days into strips and opens on today; the Free board stays.
  - **Month**: a new **Calendar** (the default) — six weeks of days with their meetings, plans and due items, *+N
    more*, drag to plan — beside the horizon Board.
- **Inbox** names its rows *Captured N* as a Planning section. **Work log, Labels, Contacts and Trash** put their search
  in the view bar's muted box, in a bar under the title (Work log's range and Suggestions, Trash's Empty trash there
  too); the Explorer's and Docs' filters are the same box. **Settings** names its sections in small grey capitals.
- Planning, Inbox and the More pages on a phone: the title and Add in the top bar, the bar sliding sideways, Month's
  calendar as dots.

- **One view bar on every list and board** (design.md §3 Lists): search, **Filter** (a field, then its values with
  their counts, *is* or *is not*; what is applied shows as chips under the bar), **Order**, **Group** (also by Label,
  with Order in groups and Show empty groups) and **Display** (show closed, columns, reset), and **List | Board**. It
  replaces the filter drawer, the Open / Closed / All segments and the Board and List's own filter bar
  (`filterbar.js` is gone); a view saved before opens with the same filters.
- **Quiet rows**: 40px, a line between, the id grey and mono, status a dot and its name, where an item belongs as grey
  text; shared columns keep one width and order in every list, and a narrow window drops columns instead of scrolling.
  A row's box shows on hover; the bulk bar floats at the bottom: Status · Priority · Plan · Labels · trash.
- **Any list is a board** (List | Board), and the Board page shows one type at a time. Dragging a card sets what the
  board groups by; closed or empty columns fold into a strip; **Order → Manual** (the default) keeps a card where you
  drop it. Every type now carries `order` (traits.py `base`), not only a task.
- **Sections** (Brief, Meetings, Issues, Records) show their tabs under the section's title, each tab with the same bar.
- **Tomorrow is gone**: Planning has Week · Next week · Month, and planning offers Today, This week, Next week and This
  month; a meeting's Date filter the same. An old `#/tomorrow` link opens Week; `@tomorrow` no longer plans.
- **Lists on a phone**: two-line rows, the list's title and **+** in the top bar, the view bar as sliding chips.
- **The sidebar**: even gaps between its blocks, the Explorer / Project switch at its foot beside the theme switch; a
  list's and a board card's boxes are 14px, as the Filter menu's.
- **Plans and analyses have ids**, as every other type of a Projects vault: `PLN-482`, `ANL-483`, from the vault's one
  counter, the file named by it (`PLN-482 <Title>.md`) and their lists starting with an ID column. A plan is named by its
  own title now, not after its item, and both can relate to other items. One from before keeps its name and works as
  it did, without an id; `tools/migrate_short_ids.py` numbers them with the rest when it moves a vault to short ids.

- **A guide for agents in the vault**: Settings → Vaults → *Guide for agents* (or `tools/vault.py agents --on`) keeps an
  `AGENTS.md` at the vault's top, written from its types and projects, that tells Claude Code, Codex or Cursor opened in
  the folder how to read and write it with `tools/vault.py`; a `CLAUDE.md` points to it when the vault has none. Written
  again when what it says changes; your own text around it is kept. `AGENTS.md` and `CLAUDE.md` at a vault's top are no
  longer warned about.

- **The vault from the shell**: `tools/vault.py` reads and writes a vault with the app closed — `overview`, `find`,
  `show` (every link read from the item), `graph`, `context`, `types`, `check`; `new`, `set`, `move`, `link`, `unlink`,
  `comment` — through the app's own Store, so agents (Claude Code in a vault's folder, scripts) follow the same rules and
  gates as the app. Markdown out, `--json` for scripts; refs in, ids on disk.
- **One writer at a time, across programs**: every write takes the vault's lock (`.task-manager/.lock`) besides the
  app's own, so the app, `tools/vault.py` and a sync writing at once never hand out the same id.

- **Graph**: a view (`#/graph`) of the whole vault as Obsidian draws it — every item and doc a node, every link an edge:
  parent, project, link fields, relations (Blocked by, Precedes…) and the [[links]] in the text. The legend filters
  by type; the toolbar by project, kind of link, closed items and orphans; hover lights up what a node is tied to,
  click opens it, double-click centres the graph on it (`#/graph/STY-482`). Each item's Relations ends with its own
  small graph. `GET /api/graph` answers the vault's graph (tm/graph.py), for the page and for tools.

- **docs/design.md**: the app's design guide — principles, tokens, the patterns and the helpers that draw them, do and
  don't, and how to check a UI change. CLAUDE.md points every UI change to it.
- **The rest of the app in the new style.** **Settings** keeps a reading width, one section under another, each
  setting a row (its name on the left, its control and what it does on the right), with *Save* always in view; in
  Item type status a colour is a dot and a status's name and group show their frame on hover; Vaults are rows, not
  boxes. **Relations** reads like Properties: each group a row with its name on the left, related items as plain rows,
  and *+ Add relation* last. **Inbox** items are rows whose *Related to…* and *Convert to* show their frame on hover.
  The Time tab's records lose their box, an empty tab of children is one line, and an empty page says so on a soft
  tint instead of a dashed box. A card's foot reads *Created Oct 20, 09:54* instead of the raw timestamp.
- Fixed: the Explorer's rows had a broken line under the name column; a stray speck by the select-all box and the
  Planned cells of a list is gone.

- **The create form looks like the card it makes**: the status beside the subject and the properties one per row in the
  side column, the optional ones (priority reason, the ticket, local path…) folded into *+ Add property*. A ticket's
  Delivery, a project's Settings and Area and objective read as rows too, quiet on a card (an empty field says
  *Empty*). The Labels page no longer shows a stray "null".
- **Bulk actions on a type's list**: tick rows (or all), then set their status, priority or plan, or archive them, with
  one Undo.
- **One key on an item**: `x` close or reopen, `t` today, `w` this week, `s` status, `p` priority — on the open card,
  or the card or row focused or under the pointer.
- **Today says how the day goes** under its date: done of planned, time logged, the next meeting.

- **A card and a page read like a page, not a form.** The status is a pill beside the title; the properties — priority,
  planned, due, labels, the type's own fields, the ticket, the local path and the watchers — sit at the top of the side
  column, one per row and without frames until you hover or edit them. The empty ones fold into **+ Add property**.
  The side tabs are **Time** (log work), Activity, AI, Relations and Docs. On an initiative's page its tasks come up
  right under the description. On a narrow screen the properties come right under the title.

- **Quieter colour.** A status is a dot of its colour and its name, which now reads as words (*In progress*, *To do*,
  *On hold*; the files keep `InProgress`…); a priority is signal bars, with only Urgent (P0) still filled red. Board
  lists keep the dot and drop the coloured header; in tables, status, priority and plan show their frame on hover.
- **Carried over reads the same everywhere**: Today, Week and Month show how late a card is (*Yesterday*, *18 d late*,
  *2 wk late*) and one arrow that plans it for now.
- **Week** folds an empty day to one line with its quick add. **Month** fits its six columns in a desktop window.
  **Today** adds from each column on the board (the line on top is List's), puts an empty Meetings column last, and
  opens in List on a phone.
- **Log work** has **+15m · +30m · +1h · +2h**, which log at once; typing a time of nothing is refused there. The
  sample vaults' work logs have real times.
- **Board and All items** filter like the lists: type and search on show, the rest behind the filter button with a
  badge.
- **The sidebar** folds into Plan, Items and More (More folded at first), counts only what is there (Today keeps its
  0), and fits *Task Manager* on one line. *Drop a card here to pin it* shows only while dragging a card.
- **On a phone** the card's head is one row (Pin and Minimize in ⋯), a long subject wraps on every card and page, and
  a type's list shows each row as a small card.

- **Tasks vaults have projects**, a simple version of a Projects vault's: `PRJ-0001` in `projects/` (an optional
  folder), with a key of 2–4 capitals fixed once made, Planned → Active → OnHold → Done, a priority, a due date and the
  folder Claude starts in. Initiatives, tasks, notes, meetings, agents and activities are in one by its key, next to
  their parent: a task can be in a project without an initiative and change project freely. A project has its own page
  with its initiatives, tasks, notes and meetings, and the lists get a Project column and *Group by project*.
- **Three vault structures, with plainer names.** *Folder per type* is now **Initiatives** and *Ticketing* is now
  **Projects** (`config.json` keeps their ids, `folders` and `ticketing`, so nothing to change). New: **Tasks** (`tasks`),
  Initiatives without user stories — a task hangs straight from an initiative — with the same files, ids and folders
  less `stories/`.
- **Projects vaults have Prompts and Transcriptions**, at the top of the vault like the agents (`PRM-001` in `Prompts/`,
  `TRN-001` in `Transcriptions/`, a transcription hanging from its meeting). Both folders are optional: a vault from
  before still matches, and each folder is made with its first item.
- **The dock is a chat.** A Claude session in the dock opens as a conversation: Claude's text as Markdown, each tool
  call on one line that opens to its command, output or diff, and **permission requests as cards** (Allow, Allow for
  this session, Deny) instead of typing in a terminal. The composer carries the permission mode, the model, the plan's
  progress, the context and cost, and Stop. **Chat | Terminal** shows the same session either way, handing it over;
  a resumed chat starts with what was said before.
- The chat's composer is one box that grows up to a third of the dock. **`/`** offers the session's commands and
  **`@`** the files of its folder (not people, as elsewhere), picked with the arrows and Enter; mode and model are
  the app's own menus.
- The chat's model menu names each model with its version (*Opus 5.5*, *Sonnet 5.5*, *Haiku 4.5*…), from the list
  Claude itself gives; an **effort** menu sits next to it. **`#`** or the paperclip **attaches vault items** to a
  message: Claude gets each one's facts and description, and the message shows them as chips.
- The dock lists its sessions down its left side, each with a dot for what it is doing (needs you, working, your
  turn, ended, ended with an error).
- In the chat, **Claude's questions** show their options to click (or your own answer), and **its plan** shows as a
  document to approve — accepting edits or not — or to send back with what to change. A **subagent** stays folded
  under its call instead of filling the thread.
- The chat takes **images**: paste them, drop them on the box or use its image button. Replies and messages have a
  **copy** button, **↑** brings back your last message, thinking is folded, a compaction is noted, and the context shows
  as a **percentage** of the model's window.
- A chat that **needs you or finishes** while you look elsewhere says so: a toast, the tab's title and, from another
  browser tab, a notification.
- An item's card can be **expanded** to the whole content area, beside the sidebar and under the top bar, and back;
  the next card opens as the last one was left.
- The dock is **one layer for every session**, wherever it was opened, above the pages and above an open card, which
  makes room for it.
- A session is **about an item or none**, and the chip in the dock's head changes which (or **→** in a history): its
  record moves to that item's AI tab or to the general History, and the session takes the item's name.

- **Next week** and **Month** join the sidebar after Week. Next week is the Week view fixed on next week. Month is a
  board of this month by horizon: Today · Tomorrow · This week · Next week · Later this month, and what was carried
  over; drag a card onto a column to plan it there.
- **This month** in *Planned*, in the lists' plan filter and as `@month` in quick add: for what has no week yet
  (`plan_month`).
- Week and Next week have a third layout, **Free board**: the week's cards on columns of your own, like Today's, one
  set shared by both views so a card keeps its column from one week to the next.
- **Prioritization is gone**: Month and the Free board take its place. Its columns (`prioritization.md`) and the
  `prio_list` / `prio_order` keys it left in files are no longer read.
- An empty column on Today, Week or Month has room to drop a card on.
- **Fix:** in the chat, **the effort no longer changes on its own with the model** (Claude gives each model its own
  default: the session's goes on, or the nearest below when the model lacks it), and a change of model or effort is
  **kept on the session's record**, so its history shows what it runs. A line in the thread says each change once
  Claude has taken it, one Claude refuses is undone with the reason, and each answer says which model gave it.
  Tables in a reply keep ids whole and scroll on their own.
- The dock and its chat are **light or dark as the app is**; only a session shown as a terminal keeps Claude Code's
  theme. Its head shows the **item as its title** (a chip that reads as a button, which changes it), the session's
  name only when it is about no item, and the folder in the tooltip. Scrolled up in a chat, **New messages ↓** takes
  you down to what came in, and says **Claude needs you** when it is waiting for an answer.
- The dock's **+ starts a session at once**: empty, in the view last picked, about the item open in the card (which
  goes along as a chip with the first message) and with Settings' model and effort. The first message names it in
  its history. The full dialog (a folder, a saved prompt, Terminal.app, an editor) stays on the top bar and the card.
- **One model list** everywhere — the chat, the dialog, Settings' default: Claude's own, the current models first and
  the **older versions** it still offers under their own heading.
- On a phone (or any narrow dock) the sessions are a **menu in the head**, with a dot that turns amber when one needs
  you, and the chat's model and effort read in a few letters (*S 5.5 · Low*).
- **Comments can be edited**: ✎ on a comment opens it in place (Enter or Save, Esc or Cancel), and an edited one says
  so beside its time. **Fix:** a comment being written no longer vanishes when the card refreshes — after a click
  elsewhere saves a field, say — or closes; it stays until you add it.
- The description editor has **text colour** and **highlight**, each with a palette and the system's colour picker
  (written as inline HTML that Obsidian also shows). A click on the description opens the editor **on the word you
  clicked**, instead of at the top.

## [1.3.0] — 2026-10-21

- **The side panel folds from inside it.** Its button sits at the right end of its tabs, and a folded panel is a
  narrow strip with that button to open it again — on a card, in the create form and on a page. Tabs that do not fit
  scroll sideways instead of being cut off.
- **Attachments**: the drop zone comes first, then the title with its count, which folds the list of files
  (*No attachments yet* when there are none). Folded or not is remembered.
- **Ticketing: you move a status anywhere in the app.** The allowed moves and their gates bind a script or an agent,
  which says so when it writes (`"by": "agent"`); the status log records who made each change.
- The description no longer jumps when it saves while you type: the line you are on stays where it is, in full
  screen too.

## [1.2.0] — 2026-10-20

- **Contacts** replaces People: a **People** tab and a **Groups** tab (an email list, a Slack channel or another
  channel, with its address and members). People and groups have notes and *When to use*, which Claude reads when a
  prompt mentions them; a group can be @mentioned like a person.
- **Watchers** on initiatives, stories and tasks: the people and groups to tell when the item's status changes. A
  prompt for Claude lists them with how to reach each one.
- Lists, the Board and All items filter by **several labels**: any of them (OR) or all of them (AND).
- On **Today** and the **Week** a card stays where you drop it. Today and that day of the Week share the order; the
  Board keeps its own.
- The **browser tab** names the screen you are on, or the item open on it.
- **Ticketing — stories.** An initiative is the objective, and its **stories** deliver it (`KEY-STY-NNN`, one branch
  and one pull request each). The initiative goes In progress with its first story and Done with the last; a story
  is ready with its initiative approved, a written acceptance scenario and its spec impact. Stories replace the
  initiative's `kind: umbrella / slice`. A PRD names its initiative in `initiative:` (an older `umbrella:` is still
  read).
- **Ticketing — specs.** A **spec** says what one part of the system does today (`KEY-SPEC-NNN`, with its own section
  in the sidebar): requirements with scenarios, draft · active · retired, active only when its text is valid.
- The **Delivery** tab shows its fields in titled groups, one per row, and a card's type chip shows the type's name.

## [1.1.0] — 2026-10-20

- The description editor and the create form colour Markdown as you type, as Docs already did: headings, bold and
  italic, links, quotes and `code`. The marks stay visible; **View** shows it rendered.
- A fenced block that names its language (```` ```python ````, ```` ```js ````, ```` ```sh ````…) is coloured in that
  language, in the editor and in Docs.
- Full screen scrolls the coloured editor as a whole, the colours following below the fold.

## [1.0.0] — 2026-10-20

The first public release.

- Markdown vaults in two structures: **folder per type** and **Ticketing** (projects as folders), with a sample of each.
- Inbox capture with tokens, Today / Tomorrow / Week planning, a Board, lists per type and pages for initiatives and
  projects, with what hangs from them in tabs.
- Favourites in the sidebar, labels and people, comments with mentions, relations, pins and minimized cards.
- Work log per item and per day; Docs and an Explorer over the vault's files; ⌘K search.
- Claude Code on any item, in the embedded terminal or in Terminal, Claude Desktop, Cursor or Antigravity.
- A Mac app mode (`tools/install_app.py`), exports of the system and of a vault, a trash and atomic writes.
- Settings → Documentation, and a prompt that has Claude Code install the app.
