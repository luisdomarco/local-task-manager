# Design guide — how the app looks, and how to keep it that way

The rules every screen follows. Read this before changing anything a user sees; reuse what is named here before
writing a new class or helper. The tokens (colours, sizes, radii) live at the top of `static/css/app.css`, in light and
dark; this file is the decisions on top of them.

The idea in one line: **a page to read, not a form to fill in.** Few frames, colour only where it means something, the
same pattern for the same thing everywhere.

## 1. Principles

1. **Monochrome first.** Zinc greys (shadcn/ui). Colour is for meaning only: a status's dot, an item type's icon, a
   label's tint, overdue/late (`--destructive`). Never colour a whole row, header or column for decoration.
2. **No frame until it is needed.** Values on a card or a page are text; their control shows its border on hover or
   focus (`.quiet`). The create form is a card half filled in: the same quiet rows. The app's Settings, a form you go
   to in order to fill it in, keeps its fields in a soft grey frame (`--border`). Only the title and the description,
   where you write, keep theirs everywhere.
3. **Rows, not boxes.** Lists of things, tables too, are rows between thin lines; a box around each one is only for
   things you drag (board cards).
4. **Say what is empty, in one quiet word.** An empty property reads *Empty* (`quietBlanks`); an empty kind of child waits
   on one **+ Add …** line (`shownKinds`), not as a wall of blank headers.
5. **One pattern per thing.** A status always looks the same (dot + words); a property always sits in a row with its
   name on the left; an empty place always says so in one line.
6. **No dashboards inside items.** No progress bars or score cards on initiative pages; a sentence says how things go
   (Today's day line, `dayline.js`).
7. **Every width, both themes.** 375 / 820 / 1000 / 1303 px, light and dark, no horizontal scroll of the page.

## 2. Tokens (`app.css` `:root`, redefined for dark)

| What | Tokens | Rule |
|---|---|---|
| Surfaces | `--background`, `--card`, `--popover`, `--well`, `--muted`, `--accent` (hover), `--sidebar` | `--muted` mixed to ~45–70 % for soft tints (hovered row, empty state). |
| Text | `--foreground`, `--muted-foreground` | Secondary text, labels, metadata: `--muted-foreground`. Never lighter. |
| Lines | `--border` (dividers, boxes), `--input` (field outlines, ≥ 3:1) | A divider between rows: `1px solid var(--border)`. |
| Focus | `--focus` (2px ring on buttons/links), `--field-ring` + `--field-halo` (fields) | Never remove a focus style without replacing it. |
| Meaning | `--destructive`; `--st-*-bg/-fg` and `--st-dot` per status; `--pr-icon-1/2/3`, `--pr-1-bg`; `--t-<type>` | Status/priority colours come from `statusCss()` / `.s-*` / `.pr-*` classes, never hard-coded. |
| Type | `--fs-base` 13.5 · `--fs-sm` 13 · `--fs-xs` 12.5 · `--fs-2xs` 12 · `--fs-h4` 14 · `--fs-title` 22 | No other font sizes. Weights: 400, 500 (labels), 600–650 (headings). |
| Size | `--control-h` 32 · `--control-h-sm` 28 · `--row-h` 48 · `--radius` 8 · `--radius-sm` 6 | Controls ≥ 32px (28 for `.small` in dense rows); 38px for form fields. |

Contrast floor: text ≥ 4.5:1, control borders and focus ≥ 3:1. A new colour goes in `:root` **and** both dark blocks
(`@media (prefers-color-scheme: dark)` and `[data-theme="dark"]`).

## 3. Components and patterns

### Status, priority, type

- **Status** = a coloured dot + its name in words, no frame: `statusChip(status)` for display, `statusSelect(b)` beside a
  title, `select()` with class `status-select` in tables. Names are read with `statusLabel()` (`InProgress` →
  *In progress*, `QA` stays); the files keep their own spelling. Types without a status (note, meeting, activity) show
  none — guard with `hasField(type, 'status')`.
- **Priority** = its icon and its name, both in its colour (`.pr-*` sets `--pr-ink` and `--pr-mask`); every level
  alike, no fill and no frame, Urgent / P0 too.
- **Kind of work** = its swatch (`--k-*`) + its name, no frame (`chip kind k-<kind>`); the name of a Work log group by
  kind.
- **Item type** = its icon in `--t-<type>`; the type chip only in a card's head and crumbs.
- **Item id** = `refOf(item)` (`shownid.js`) wherever an id is shown: the server's `ref`, a short id with its type's
  prefix (`STY-482`), else the id. A table's id column uses `shownId(item)` (the same, but a long Projects id drops its
  project's key, `ACME-INI-001` → `INI-001`, the whole id in its tooltip); a search over ids, `idMatches(item, q)`
  (ref, id and old ids). `item.id` stays the key for links, pins and sorting, never what is drawn.
- **Late / carried over**: `lateBy()` text (*Yesterday*, *18 d late*) in `--destructive`, plus one arrow that plans it
  for now: `carriedAction()`.

### Properties (cards, pages, create form, Settings)

- One per row, name on the left: container `fields prop-rows`, each `.field` = `<span>name</span>` + control
  (112px label column; 84px on a phone; 180px in Settings).
- On a card, a page and the create form add `.quiet`: controls frameless until hovered or focused, everywhere (an
  item's tabs too: §Tabs); an empty one says what goes in it, its helper text (the field's `placeholder` in
  `tm/structures`: *feat/<topic>*, *Why it was dropped*), or *Empty* when it has none (`quietBlanks()`, which fills an
  empty `placeholder` too, and the `.select-label:empty::before` rule). A field is never left blank. Blocks of rows split by a line:
  `blocksOf` + `breakBlocks` (`PROP_BLOCKS`: priority · dates · labels; the outside ticket last).
- Section heading over them: small caps grey (*PROPERTIES*), not a bold title.

### Title

The subject is the page's `h1`/title (`textarea.title-input`, wraps, Enter ends it) with the **status pill beside it**
(`.title-status`), its middle level with the middle of the title's first line. A light frame on hover only; while it
is being written, no frame and no ring, just the caret. Crumbs/type chip and id above, small and grey.

### Lists

- **Tables** (`dataTable`, `.grid` in `.table-wrap`): no box, rows between lines on the page's background (`--table-bg`;
  a table inside a card or the side panel takes the card's). What does not fit scrolls sideways with a soft shadow on
  the side there is more. A header's text sits over its column's (`th` pads as a cell; its `.th-btn` reaches 6px out
  for the hover). Header row of `.th-btn`s; status, priority
  and plan cells are `select.small`, frameless until the row is hovered. An unset value is a blank cell (`.blank`) or a
  muted *—*, never *null* or *undefined*.
- **Rows of cards** (Inbox): `h('div', { class: 'cards rows' }, …itemCard())` under a Planning section head
  (*Captured 1*, `planSection`) — no box, a line between, pickers quiet until hover (always framed on touch screens).
- **A page's head and bar** (Labels, Contacts, Trash, Settings): the head a list's, `pageHead({ title,
  count, action })` (ui.js): the title, its grey count on the baseline (`pageCount()`: *3 labels*, *1 item*, *Empty*;
  none where tabs under the title carry the counts, as Contacts' People · Groups), the primary *Add …* at the right.
  Then the view bar's line without its menus — `div.view-bar` with the page's search in `searchBox(input)` (ui.js: the
  260px `--muted` box with a magnifier, the one the view bar draws), then what the page has (Trash's *Empty trash* as a
  red ghost button), never in the head: on a phone the head goes to the top bar and the bar
  slides. Its rows are a list's: `table.grid.fixed` at `fixedColumns` widths, the row's ✎ × as `rowAction`s on hover
  (`tr.hover-host`), its main action (Restore, Confirm, Add) a small ghost button always shown; nothing to show is
  `pageEmpty(text)`, a quiet grey line, no box. Contacts' People · Groups are a section's tab links (`.section-tabs`).
  The Explorer's and Docs' tree filters are the same search box.
- **Work log** is a list over log rows, not items: the whole `viewBar` (Filter, Group, Display) with its own fields,
  groups and columns (`worklogview.js`: `logFields`, `LOG_GROUPS`, `LOG_PROPS`), its date range a button right after
  Filter (`lead`) that opens a popover of presets and two days (`popover`, exported by viewbar.js). Its groups are a
  list's grey band (`tr.group-head` › `.group-line` › `.group-toggle`), the group's entries and time at its right
  (`.wl-group-total`). A column the group already says (Date by day, Kind by kind) is not drawn.
- **Overview's work and records** (Tasks, Notes, Meetings: `workGroups`): the Panel kit's groups and rows, never a second tab bar — a folding name with its count (open ones only, for a kind that closes), *+ Add…* as `aside`, rows with the id muted and, at the right, a task's status and priority as two fixed-width columns without a table, the priority at the right edge (`.work-meta`; on a phone the priority keeps only its bars) or a record's date, the tables' pager (`paged`) in the group's foot. The whole line up to *+ Add* folds it. **Issues** uses the same groups (`workGroups(…, { table: true })`), each unfolding into its kind's `dataTable` with the columns of its list but `ISSUE_LEFT_OUT` (ticket id, progress): id and subject at fixed widths (`ISSUE_TABLE`) so every kind's table lines up with the others, an empty last column (`FILL_COLUMN`) taking what is left, sideways scroll without a bar; quiet (small grey heads, no bold subject), *Show N closed* on its pager's line (`.issue-body`). The quick add (+ Add) shuts on Esc, *Close*, or a click elsewhere while empty.
- **Relations / Docs**: built of the Panel kit (below): `stackGroup`s of `rowList`s, quiet pickers, a secondary button
  to add one more. **Parent** opens Relations: one group for where the item lives (`project` and `related_to` in the
  file), the chain as rows — its parent and on up, closed by its project (`in`) — the first with ✎ (`itemPicker` over
  `parentChoices`) and its ×. Where its project can change (rules.js `projectFree`: a task, a note…, and a ticket of
  `leaves_project` — initiative, story, spec, support, hotfix, PRD — with a short id) the project row's ✎ is that same
  picker and its × takes it out of every project; a sub-document hanging from no item has ✎ *Move to another project*.
  **Both are always there**: one that cannot act — the × of what must hang from an item (`needs_parent`: a plan), the ✎
  and × of a ticket's project with a long id, the × of a sub-document's project, a ✎ with nothing else to pick — is
  drawn faint (`.row-action.is-off`, panel.js `off`) and a click says why in the toast (*Its id (ACME-INI-001) carries
  its project: it moves once its vault has short ids…*); while it hangs from no item, a picker offering only what may be
  its parent (rules.js `parentChoices`: projects for a type whose project can change, never for a `needs_parent` one). **A link is shown once**: set, it is a row — its name opens it, ✎ and
  × on hover —, never a filled picker beside its row; an empty picker names what it picks in grey (*Pick a parent…*); the row
  that adds a relation has a
  primary *Add*, faded until an item is picked (`btn small primary`).
- **Activity / AI Agents**: lists without frames but for what someone wrote or started. Activity under the name of each
  day (`.activity-day`), a comment a `surface-card` (`.activity-card`), an event a grey line with a dot; a session a
  `surface-card` too (`.cs-item`, title over a short meta with `agoLabel`, its ↗ ⋯ over its corner, `hover-reveal`).
- **The view bar** (`viewbar.js` on `viewmodel.js`, the same on every list, board and section tab): `[Search] [Filter]
  … [Order: X ▾] [Group: X ▾] [Display] [List | Board]`. Search is a 260px `--muted` box with no border. **Filter** is a
  two-level popover — the fields the structure gives the page (`filterFields`), then the values, each with a 14px box,
  its status dot, its name and its count (`valueCounts`, grey at 0), and *is / is not*. What is applied shows as chips
  under the bar — 26px pills with a hairline border on the page's background, "Project is" grey and the values
  dark ("Project is **Acme Web** ×" … *Clear* · *Save as view*) — which take no room when there are none. **Group** offers the
  type's `group_by` plus Label (an item sits in each of its labels' groups), *Order in groups* and *Show empty groups*.
  **Display**: Show closed (None / Last week / All), the columns to show (on a board, **Show on cards**: priority, ID,
  planned, due, labels, parent, project, ticket — `cardProps` / `cardShows`), on a board *Empty columns* (Show / Fold
  / Hide), and a foot with *Reset to default* left and **Save as view** right. Pills that turn a thing on or off
  (`.vb-pill`) are dark while on (`--foreground`), outlined while off. **Save as view** asks a name and keeps the
  page's view, its order and (on the Board) its type under it (`savedviews.js`); the views are listed in the sidebar's
  **Views**, under Favourites, lit while the page still shows them, each with a × (Undo) on hover. Everything is saved per list and vault (`list.<type>`, v2; `migrateView` reads a view
  saved before). Narrow bars drop words before they overflow (container queries on `.view-bar`).
- **Rows** (`.list-main`): 40px, a line between, `--muted` on hover; the id mono and grey, the subject takes the rest
  and is cut with "…", status a dot + name, initiative / project as grey text with the type's icon, Planned in red when
  late. Status, Priority and Planned are edited in place (selects framed only on hover, capped at their cell: a longer
  label is cut with "…", never over the next column); on a phone Planned reads as text. The columns shared by every list keep one width and one order (`LIST_WIDTHS`, `COLUMN_RANK`); what does not
  fit gives way, Due first and Type last (`hiddenColumns`) — the page never scrolls sideways. A group's head is a 34px
  `--well` row: fold arrow, dot or icon, name, count and a "+" on hover that adds an item with that value.
- **Selection**: a row's 14px box shows on hover (always on a touch screen); once one is ticked, every row shows it and
  the header gets *select all*. The `.bulk-bar` floats dark at the bottom centre: *N selected* · Status · Priority · Plan
  · Labels · Project (only where every ticked type can change it: `movesProject`) · trash · ×.
- **Board** (`boardview.js`; any list with a Group): columns of `--muted`, radius 10, as wide as `--board-col-w` (272px;
  every board's column, Planning's too: change it there and only there), the head's dot, name and the count right by
  it, then (at the right) the fold button on hover and the ⋯; the window's height with each column scrolling on its own and the sideways scroll at the bottom. A closed or
  empty column folds into a 40px strip read top to bottom; a click unfolds it. "+ Add a card" shows on hover. A card
  (`itemCard(…, { variant: 'board' })`): its 14px done box, a title of 2 lines at most, a grey line with where it
  belongs, then priority (its bars and its name, `priorityChip`) · planned (what Display → Show on cards leaves on: ID and labels start off, `CARD_OFF`), no
  framed chips. Dropping a card sets the field the board groups by
  (Planned and Label have none); its place in the column is kept with **Order → Manual**, the default (`order`, every
  type has it). Grouped by status, a task's board keeps board.md's lists (name, WIP, ⋯). **Columns move** on every list's
  board: a column's head (and a folded one's strip) drags it (`kanban.js` `dragsList` + `listDropZone`: the list MIME
  type, so a card's drag and a column's never mix; the 4px `.list-marker` shows where it lands) and Shift+←/→ on the
  focused head moves it one place, as a pinned chip does. The order is the view's, per grouping (`view.colOrder`,
  `colorder.js`), never Order's; Group says *Drag a column by its header to move it*, and once one moved, offers
  *Reset column order*. A board of columns that move is `boardOf({ onReorder })` with `movable` columns.
- **On a phone (≤ 640px)**: a row is two lines — dot, subject and when (Planned, else Due, else Date) on the first, the
  id · initiative or project in grey on the second; the top bar takes the list's title and its Add as "+", the pins
  giving way; the view bar and the applied filters slide sideways as 40px chips; the top bar's buttons are 44px.
- **Bulk**: a pick column + `.bulk-bar` with one Undo (`bulk.js`); never confirm dialogs for reversible changes —
  toast with **Undo** (`toast(msg, false, { label: 'Undo', run })`).

### Tabs

`tabPanels(tabs, active, onChange)`: underline style, a `count` badge when the tab holds things (0 included). Each
panel carries `data-tab="<key>"` for styling (a `count` is a string: `String(n)`, or a 0 hides the badge). **An item's
tabs are not remembered**: a card or a page always opens on its first main tab (Overview) and its first side tab
(Properties; Activity on a narrow screen, where Properties sits under the title); the one picked holds while it stays
open, through every save (panel.js `mainTab`/`sideTab`, `pageMainTab`/`pageTab`, reset in `show()` and
`createPageEditor`). A minimized card or Back brings back the tabs it had. Settings remembers its tab. Keyboard focus on a tab is a soft fill (`--accent`, as a menu item's), never the
outside ring: a bar scrolls sideways, so a ring around a tab is cut to two bars.

**A sidebar section's tabs** (`sectionHead(route, title)` in `sections.js`, `.section-tabs`): views that share one
sidebar link — Projects' Meetings · Brief · Issues · Records, a
tab per type. They are **links**, not `tabPanels`: each tab is its view at its own address (`#/week`, `#/prds`), so the
page title is the section's name, the bar sits right under the header (above the toolbar), and the header's *Add*
is the tab's. A tab is icon (14) · name · open count (a 0 shows none; the tab itself is always there: `data-tab-count`, filled by
`setTabCounts` from the sidebar's counts); the current one has `aria-current="page"`. The section's link goes to the
tab last opened (`pref('section.<key>')`). A view in one calls `sectionHead` and puts `head.title` in its `h1` and
`head.tabs` after its header; outside a section (or with one tab left) it returns its own title and no bar.

An item's own tabs (`itemTabs`, card and page alike): **Overview** (its description, its ⧉ ⤢ over the box's top-right
corner, `.body-wrap.in-tab`; then its work and records — Tasks, Notes, Meetings — stacked, `workGroups`) · Settings
(Area and objective first, its fields with no title, then a project's own groups, then a ticket's Delivery groups —
Readiness, Execution… Paused or discarded —: no tab of their own) · Files (attachments) · Links · Docs
(`docsTab`) · **Issues** (every other kind that hangs from it, stacked as Overview's, each its table: `groupTabs`), last, set apart by
a short line (`.tab-btn.apart`, the tab's `apart: true`). A structure with `child_groups` (Projects) gets one such tab per
group instead (Initiatives · Issues · Briefs · Records), the line before the first. One line under the bar, none over it; a tab's count is a number, so a 0 shows no badge (as the side panel's). Settings
follows the side panel's line, one field per row, its name on the left (a map with `key_labels`, On hold, a row per
key: On hold by · Why on hold · Resume when; never keys titled over boxes): a group's name a small grey uppercase title with no icon, as the create form's
sections (*SPEC AND RELEASE*, as *SETTINGS*), a thin line between groups, each field quiet as in Properties — no frame
until hovered or edited, an empty one saying what goes in it — and a text or a long text the row's width, a choice, a
date or a number only what it needs (280px; a number 120px, a due day 96px), a read-only
one plain (`.item-tabs .prop-readonly`), never a filled box. Which kinds
stay in Overview: `WORK_KINDS` in `panel.js`. The side panel keeps what is about the item, not its content:
Properties · Activity · AI Agents · Relations · Time, last.

### Planning (Today, Week, Month; `planrows.js`, `calendar.js`)

- **Head** (`periodHead`): *Planning* · `[Day | Week | Month]` (links: `#/today`, `#/week`, `#/month`; a `.seg`) ·
  `‹ This week ›` · the range in grey (*W46 · Nov 9 – Nov 15*); no Add (the Board page, Today and Planning add from
  their columns and quick adds). It replaces section tabs: Next week is `›`
  (`#/nextweek` still opens it), and the sidebar's Planning link goes to the last of Week or Month. Today's head is its
  title with the day line (date · done of planned · logged · next meeting). On a phone the title goes to the top
  bar and the switch, the nav and the day line stay.
- **The view bar** on every Planning page: no search on Today; *Show closed* is None / All; the layout switch is the
  page's own (`layout.options`): Today List | Board, Week List | Board | Free board, Month Calendar | Board. A note on
  the bar says how the period goes (*3 of 7 done*, `note`); the Week board adds *Days* to Display (`displayRows`).
- **Agenda** (Today's list, Week's list): sections, not boxes. A section head (`planSection`) is 36px — dot, name,
  count, a tag (*Today*), its action at the right (*Move all to this week*, a "+" on hover that opens the quick add) — a
  line under it, black for today; a past day grey. A row (`planRow`) is 42px on a grid: 14px box · subject (a
  meeting's time first) · where it belongs (grey, the type's icon; gone under 760px of list, a container query) · three
  columns of one width on every row, so they line up down the list (`rowMeta`, `.plan-meta.cols`: 96px status · 56px
  priority, its bars and name · 84px date, *1 wk late* in red, *Due today*, *Done Wed 4*; a phone drops the status and
  keeps the bars); a meeting's row keeps its own line; a
  `planCard` shows the status left of the priority too · the move of a carried-over one (→). Consecutive empty days
  are one line (`emptySlot`: *Tue 10 · Wed 11 … Nothing planned*), each day a drop target and a click to open it.
  Closed ones wait behind *N done today · Show*. Week ends with *Next week W47 · 0 planned, 7 days free ›*.
- **Boards** are the lists' (`boardOf`) with `planCard` cards (the board card without its id): Week's days (past and
  empty ones folded into strips, today's column wider and scrolled to), Month's horizons, Today's own columns with a
  Meetings column first (folded last on a day with none). A column takes a `lead` (meetings above the cards, not
  dropped on), an `aside` (*Move all*) and an `empty` line.
- **Calendar** (Month, `monthCalendar`): a week column and seven days, six rows; a day's number in a 24px circle
  (black today), outside days grey, past days a faint tint. A cell shows three pills at most — a meeting (its colour), a
  planned item, a due one — then *+N more*; on a phone the pills are dots. A late line (*Carried over 3 · …  Move all
  to today*) and *Anytime this month* sit above it. Pills drag between days and weeks.

### Goals (`views/goals.js`, `goals.js`)

- **Head**: *Goals* · *2 open · 1 closed* in grey · **Add goal** (primary). The view bar: **Filter** over the items
  (not the goals), **Display** (Show closed items; *Closed goals* Hide / Show, a `displayRows` row) and **List |
  Board | Canvas**, kept per vault in this browser (`planViewOf('goals')`). Canvas: see *Canvases*.
- **Board**: a column per goal (`boardOf`, `--board-col-w`), its head a `listHeader` — the goal's status dot, its name
  as a link that opens it, the count (its tooltip: *2 of 5 closed*) and ⋯ (Open, Rename, Move earlier / later, Mark
  done / Reopen). Its cards are the board's own. The last column is **Add a goal** (`addListColumn`: a name, Enter).
- **List**: Planning's agenda (`planSection` + `planRow`): a section per goal — the goal icon and its name, the count,
  *2 of 5 closed* as the tag, then its priority chip, "+" and ⋯ —.
- **Order**: goals by priority, then their own `order`, then title (`byGoalRank`); a goal dragged among goals of
  another priority takes theirs. Items by `goal_order` (`byGoalOrder`): a drop writes the goal and its place, and only
  the neighbours that must move (`dropInGoal`, `rules.placement`).
- **A goal's page**: Overview shows its Description (a plain textarea, not the body editor), a progress bar with *N of
  M closed* and **+ Add items** (an `itemPicker` of open projects, initiatives, stories and tasks in no goal); then a
  group per kind it can hold, in the order of the hierarchy — Projects, Initiatives, Stories, Tasks, Notes —, shown even
  when empty. Projects, initiatives and stories are born in their project, so their **+ Add** is an `itemPicker` of that
  type's open items in no goal; Tasks and Notes keep their quick add.

### Canvases (`canvas/`: Goals' Canvas, any page's)

- **What a page hands in** is a provider; the canvas knows no page:
  `{ kind, label, items() (the side list), all() (Map id → item: every one a card may show), card(item), line(item), open(item) }`.
  `card(item)` → `{ title, kicker?, status?: { label, key }, priority?, note?, progress?: { done, total }, link? }`.
  `mountCanvasView(el, { host, provider })` draws the rest: the canvas picker, the side list, the whiteboard. `host` names
  its folder, `<Docs>/Canvases/<host>`.
- **The layout**: as a board, it takes the height left (`.canvas-view`, `board-layout` on `#view`). The items sit in a
  220 px column, the picker (`select`) and ⋯ on top, and a ⟨sidebar⟩ button folds it to a 32 px rail
  (`canvas.<host>.folded`). The whiteboard sits in a soft frame (`--border`, `--radius`). Filter, Display and the chips
  step aside (`#view.canvas-layout`). A narrow window stacks the column above the canvas. Excalidraw's own UI goes
  mobile under 730 px of canvas, so the column stays narrow.
- **A card is a board's card**, drawn in Excalidraw's primitives and grouped:
  - a white frame, 280 wide, `--border` grey, round. It is the card: `customData.tmItem`, its `[[link]]`, what arrows
    bind to. Its height is `cardHeight`: one even rhythm (`LEAD`: title lines 20, ID 15, the status row 17, 10 between
    blocks, 12 above and below), so a one-line and a two-line title read alike;
  - then its parts (`tmPart`): the title (16 px), the ID in grey (12 px), the status as the app draws it (a dot of
    `--st-dot`, its name), the priority (its bars and name in `--pr-ink`), the note on the right and a progress bar.

  Colours are the light theme's; Excalidraw darkens the whole scene in dark mode. `customData.tmSig` says what the card
  shows. A changed item redraws only the parts, so the frame keeps your colour, place and arrows. `CARD_LAYOUT` is
  bumped when the parts move.
- **Excalidraw's own chrome** (toolbar, properties, Library, menus) wears the app's colours: its violet palette is
  variables on `.excalidraw`, set from the app's tokens (`--primary`, `--accent`, `--popover`, the radii) under
  `.canvas-stage`, so they follow the theme. The Library's headings are section labels (`--muted-foreground`, 12.5 px,
  600), and its *Browse libraries* link out is hidden.
- **Shapes** live in `library.js`, as data: Excalidraw skeletons, roughness 0, ink `#343a40` on white, Nunito. A figure
  of several shapes is one group. The canvas defaults to clean lines, Nunito 16, round corners and shapes filled white (Excalidraw takes hold of a shape with no fill only by its outline, so a filled one drags from its middle, as in Miro); each element can
  still change.
- **Arrows meet a shape at the middle of a side**, as draw.io's and Miro's connectors, never anywhere along it:
  - `anchorlayer.js` draws the dots over Excalidraw (it has none): hover a shape, or select it, and its four dots show,
    blue (`.wb-anchor`); drag from one and a dashed line follows to the dot of the shape under the pointer, lit green;
    let go and the arrow is made, bound at both ends, in the arrow style chosen (elbow by default). With Excalidraw's
    own arrow tool the shape under the pointer shows its dots too, the one it will meet green. An arrow selected keeps
    Excalidraw's handles: the dots only say where its end may go (they let the pointer through). A click on a dot an
    arrow already meets selects that arrow, by giving Excalidraw's canvas a click on it: its handles (its linear
    editor) come only from a pointer selection, with the up a moment after the down.
  - `anchors.js` (pure) says which shape is under a point (`targetAt`: a shape, a free text or a card's frame, never a
    card's parts) and where its dots are; `snapArrows` puts an end drawn elsewhere on the nearest side's middle when
    the pointer is up, and routes again an elbow that comes into its side the wrong way (an end moved to another side
    keeps the segments you dragged). An elbow keeps the side as its `fixedPoint`, and Excalidraw's own router
    (`mutateElement` with new binding objects, on an elbow in the scene) draws its path around the shapes. A rotated shape is left as Excalidraw binds it.
- **Opening an item** from a canvas is `openItemCard`: a modal even for a type with a page, so closing it leaves you on
  the canvas.
- **Saving**: debounced 800 ms, only when the drawing changes (`getSceneVersion`), against the file's rev. A 409 reads
  the file again, and the toast offers *Keep mine*. Fonts measure late (Excalidraw registers them as the scene needs
  them), so text is measured again on `document.fonts` `loadingdone`.

### Forms (create, Settings)

- The create form is the card's rows (`propList`, `titleStatus`, `.quiet`, `prop-rows`), every property in view, its
  link fields as the card's Relations (`stackGroup` + `picks-quiet`). Its head is **New** and the type it creates, a
  `select()` (create.js `typePick`): the one it was opened for (the list's, or the one picked in *Add item*), any other
  one a pick away. Its main column is sections one under another, each under a small grey uppercase title as
  *PROPERTIES* (`.create-section`), never folding: Area and objective first, a project's Settings (the grey-titled
  groups of the page's tab), then the description, the page's own block (`mdBlock`, `mdblock.js`: a box that opens the
  editor on a click). No Links: they are added on the card. It asks only what is known when the item is opened: a
  field a later step writes (`later` in `tm/structures`: execution, release, triage, a pause, the outcome) is left out
  (rules.js `askedOnCreate`), and the new file takes its template's value. An optional select (create.js `OPTIONAL`)
  starts on none, so nothing is written until it is picked.
- Its right column asks where the item goes in one **Parent** field (itemform.js `parentControl`, as Relations: a
  project or an item, writing `project` and `related_to`; an item brings its project).
- A create the server would refuse is not sent (rules.js `missingOnCreate`): each field it needs and lacks (the
  subject, a project's key, a ticket's Parent when it brings no project, the Parent of a story, PRD, plan or hotfix) is marked in `--destructive` (its name, and its
  box, framed even in quiet rows: `.is-invalid`, `aria-invalid`), the first one focused, no toast and no message. Only
  a value given but wrong (a key that is not 2–4 capitals, or taken) says why under it (`.field-error`). A mark goes
  as soon as the field is filled in; nothing is marked before a create is tried.
- Settings (the app's) is rows as Properties, but its fields keep a soft grey frame (`--border`, a shade darker on
  hover, the halo in use), Statuses' too; its text is the lists' size: names and values 13px (`--fs-sm`), the notes
  under a section or a field 12.5px (`--fs-xs`). Each section's name is a small grey uppercase title (*VAULTS*), as
  the item page's groups; a vault's, a saved folder's and an export's
  row actions (×, download, Show in Finder) show on hover (`.row-action`). Its head is `pageHead`; a tab's name fits
  whole (*Statuses*).
- A folder field (a vault's folder, Settings' *Add a folder* rows, the Agents' *Add folder*) gets **Choose…** beside it
  (`folderButton(input, {prompt, onPick})`, `folderpick.js`): macOS's folder dialog, opened by the server, writes the
  path into the field as if typed. Not on a Mac, it is not there and the field is typed as before.
- Settings: form tabs at `max-width: 860px`, sections one under another divided by a line, each setting a row
  (`setRow(label, control, help)` in `views/settings.js`), the save bar sticky at the foot (`.settings-save`).

### Empty, loading, errors

- An empty place says so in one line of `muted small` text (`child-empty`), or `emptyState(text)` on a whole page:
  soft tint, no dashed border.
- Errors: `toast(message, true)`; inline warnings `small warn`.
- A notice that something keeps working but should change (a vault of a legacy structure): the On hold tint
  (`--st-onhold-bg`, its icon in `--st-onhold-fg`), as `vault-legacy` in Settings and the quiet `vault-legacy-hint`
  link under the vault selector. The destructive tint (`vault-match`) is only for what is blocked.
- Hidden files in a tree (Show hidden files, the eye by the filter: `.btn.icon.toggle.on` while on): their rows dimmed
  (`.tree-row.is-hidden`); a sealed folder (.git, .task-manager) has a `lock` icon, no chevron, a menu of Show in Finder
  and Copy path only, and in a folder's table reads *Protected*.
- A file the page cannot show: `externalView` (views/files.js) — its icon, one line saying so, and the one action that
  helps (*Open in <App>*, named once the server has looked the app up), or why not in `muted small`. Never a dead end
  with only Download.
- Dates for reading: `shortDate` (*Oct 20*), `longDate` (*Oct 20, 2026*), `stampLabel` (*Oct 20, 09:54*); the raw
  value goes in `title`.

### Panel kit (the side panel's patterns, as components)

The side panel (Properties · Activity · AI Agents · Relations · Time), Docs and Links are built of these; reach for them
anywhere before a new style. JS in `ui.js`, CSS in `app.css` under *Panel kit*. They take the size of where they sit:
the side panel sets 12px for all it holds (`--fs-side` on `.im-side.tabbed`, and `.menu-side` for what opens from it).

| Pattern | Use | Looks |
|---|---|---|
| Primary button | `btn primary` | Filled: the one action that does the job (*Work on it with Claude*, a relation's *Add*). One per place. |
| Secondary button | `secondaryButton(label, { ico, …attrs })` → `btn secondary`; a `select()` as one: `class: 'secondary'` + `face: ['plus', label]` | A border, no fill, the accent on hover; at the left edge, as wide as its text. Opens or adds (*+ Add relation*, *Add existing session*). |
| Tab's add button | `stackGroup(label, rows, { aside })` with a `btn small ghost tab-add` (a `select()`: `class: 'ghost tab-add'` + `face`) | In an item's tab (Links, Docs, Files), *+ Add…* on the first group's line at the right: grey, no frame, the accent on hover. The form it opens keeps its fields framed. |
| Add line of empty kinds | `workGroups(…, { table: true })` with `shownKinds` (`kindgroups.js`) → `.add-kinds` of `secondaryButton(name, { ico: 'plus', class: 'small' })` | In a tab of folding groups (Initiatives · Issues · Briefs · Records), a kind that holds nothing has no group: its type's name waits on one line at the tab's foot, and a click opens its quick add in its own group. Overview's work keeps its empty groups. |
| Quiet pickers | a `.picks-quiet` around any `select()` (or a `propField`) | Frameless until hovered: then a border and its chevron, never a fill; the focus ring while open. An empty one reads its placeholder in grey. |
| Group | `stackGroup(label, content, { title, aside })` → `.stack-group` / `.stack-label` (`.stack-head` with an `aside`) | Its name above what it holds (grey, `--fs-sm`), a line between one group and the next; no name, only the line. `aside` goes on the name's line at the right. |
| Rows | `rowList(rows, { ordered })` of `rowItem({ text, href, ico, meta, mono, lead, depth, actions, linkAttrs, tip })` | Plain rows: no box, no line, the accent on hover; icon + title, a muted meta at the right (an id, a folder, a link's label), text level with the group's name; `depth` steps a chain in. With `onClick` instead of `href`, a button (a file opened in a dialog); with neither, a muted line. In an item's tabs, the title in plain weight. |
| Row action | `rowAction(ico, label, (e, btn) => …)` | A 24px icon button (× to unlink, ☆ to make it the main, ⋯ for more), shown on the row's hover. A row that opens to edit (a link's *Edit*) is a `.row-edit` li holding the same row the add button opens. |
| Shown on hover | `.hover-reveal` inside a `.hover-host` | Hidden until the host is hovered or it has focus; always shown on a touch screen. |
| White card | `.surface-card` | On the panel's grey: what someone wrote or started (a comment, a session); its own padding and layout on top. |
| Chips by name | `labelChip`, `personChip` | One hue per name (`labelHue`), the same everywhere. |

### Graph

The Graph view is `graphCanvas()` (`graphcanvas.js`); an item's card or page draws no graph of its own;
reuse it for any other picture of links. It draws with a **look** (`graphstyle.js` `LOOK_DEFAULTS`): the Graph view's is
Obsidian's — grey nodes (`--graph-node`), faint grey lines (`--graph-line`, `--graph-line-faint`), no arrows, names
(`--graph-label`) that come in as you zoom (`labelAlpha`, Display → *Text fade threshold*) — while `PANEL_LOOK` keeps
the type colours (`--t-<type>`, docs `--t-doc`), arrows and every name. A node is bigger the more it is
tied to and faded when closed; its name under it, on a halo of the background, drawn only where it covers no other name
(`unclutter`: a cluster shows its hubs, a hover the rest). An edge takes a **tone** of the theme, never a colour of its
own — `strong` `--foreground`, `soft` `--graph-line`, `faint` `--graph-line-faint`, `alert` `--destructive` — with a
width and a dash per kind. **Hover** lights the node and its edges in `--graph-accent` (violet, the graph's one colour)
and dims the rest to near nothing; its tooltip (`.graph-tip`, the popover's surface) reads each tie from it. The canvas
reads its colours on every draw: a theme switch redraws it.

The **Graph page** is a list's head (`view-head`: the title and its count on one line) over a canvas from edge to edge
down to the window's foot (`.graph-stage`, a hairline above it, the page's own background: no tinted box), the zoom
buttons at its bottom right. Its settings are **a floating panel** at the top right (`.graph-panel`, the popover's
surface, `--shadow-lg`), shut to a sliders button (`.graph-panel-open`) and always shut on a phone, where it takes the
stage's width. Inside, folding sections (`.gp-section`, a chevron and a bold name; Filters holds ↺ reset and ×): rows
of a name and the list's switch (`.gp-switch` + `.vb-switch`, the whole row flips it), the types as toggling pills
(`.gp-chip`: a dot, the name, the count; struck through while hidden), a search with its clear button (`.gp-search`),
groups as a colour swatch that cycles `GROUP_COLORS` and a search box (`.gp-group`), and sliders (`.gp-range`: a thin
track filled with the accent up to the thumb, its value at its left). Everything in it is kept per vault (`graph.view`).

### Agents (`agentspane.js`, `views/runs.js`, `views/agentshome.js`)

**A list that is not the vault's files reuses the Explorer's tree read-only**: `treePane({ readonly: true, … })` keeps
the filter, folding, keyboard and lit row, and drops dragging, renaming, deleting, *Search in files* and the eye; its
rows take `nameOf`, `iconOf`, `tipOf`, `decorate` and a `menu(node)` of their own. A section per folder is drawn as
Docs' heads (`.docs-head`, the title folds it) with its count at the right (`.agents-count`). An agent's name is
monospace (it is what you type), with the `slash` icon; a namespace is a plain folder row.

**`#/runs` is the Home** (`.agents-home`): the week's line on top, then a grid of two columns
(`.agents-home-grid`, one at 900px and below) of sections titled as the Inbox's groups (`.agents-section-title`, no
line under them; a quiet *… →* link at their right, `.agents-home-more`), each a list of `.cs-item` cards: a dot or an
icon, the title in monospace, one muted meta line with the status word first, and at most one quiet icon button at
the right (Stop, Run now, ▷ Run — which opens it in the dock, as on its page). **What needs you is the one box with a tint**
(`.agents-home-alert`, the warning tone), and only while there is something in it — an empty Home is calm. The week is
a muted line, not a row of figures. In the sidebar, Home and Inbox are two rows on top
(`.agents-nav`), lit as the Explorer's views are.

In the middle, **`#/runs/inbox` is the Inbox** (`.section-tabs` Home · Inbox · All agents, a `view-bar` of search and selects,
then groups — Needs you · Running · Unread · Earlier — of `.cs-item` cards, `.agents-inbox-row`): a status dot
(`.td-dot.tone-*`, the tones of `runmodel.js RUN_STATUSES`), what it sent in monospace, and one muted meta line with the
status word first. **The status is a dot and a word, never a filled chip**: amber needs you, blue works, green done, red
failed, grey stopped; the same dot marks an agent's row in the sidebar and the Inbox row's count turns amber while one
needs you. *All agents* is rows, not cards (`.agents-row`: icon · name in monospace · description, muted · argument
hint, monospace and muted), a thin line under each folder's head.

**An agent's page** is a head, a row of figures and tabs. **The head** (`.agents-head-page`): crumbs (`.agents-crumbs`:
folder icon, the folder as a link to *All agents*, its namespace after a `/`, muted and small), then a row of the name
(the `h1`, in monospace) with the description under it as muted text (`.agents-title-col`), and at its right the
actions (`.agents-actions`, 32px high, wrapping under the name when short of room): *Where* as a small `select`,
**Run** primary, **Schedule…** secondary, **Open in ▾** ghost and ⋯. **There is no composer on the page**: Run opens
the dock's chat with the command written, and that composer is the only one. **The figures** (`.agents-stats`): one
bordered card of five cells in a row that wraps (`flex: 1 1 100px`), a line between cells drawn by each cell's own left
and top shadow and clipped at the card's edge; each cell an uppercase muted label, a figure (1.05rem, 650) and a muted
line under it. **The tabs** (`tabPanels`, `.agents-tabs`, as wide as their names and scrolling sideways, never cut):
*Instructions* is the prompt as a document (`.agents-doc`: a bordered card, a muted head with the file in monospace and
*Open in …* at its right, the Markdown under it with its headings brought down to h4 size); *Skills*, *Subagents*,
*Commands* and *Files* only when there is something in them, each a bordered list (`.agents-rel-list`) of rows that
unfold — icon, name in monospace with a *via …* chip when it came through another, its description clamped to two
lines, a chevron that turns —; *Details* the property rows. It is laid out as an item's page is (`.page.two-panel` >
`.page-body` with `.page-main` and a `.page-side.im-side.tabbed` that `sideFold` folds; 360px wide here,
`.agents-body`): the side panel's tabs are **Runs** and **Schedules**, drawn as an item's AI tab draws its
conversations (`.cs-list` of `.cs-item` cards, the arrow and ⋯ on hover).

**A run's detail replaces the list in the panel** (no new page, no modal): *‹ Runs*, then the status dot and word over
what it sent, a row of actions (the primary one first, ⋯ last at the right, `.agents-run-actions`), its facts as
`prop-rows quiet`, then **Changes** — `.agents-change` rows of path, `+n −n` in the diff colours and a toggle that
unfolds the file's diff, drawn by `diffview.js diffBlock` as the dock's chat draws an edit (hunks as a muted line). A
list that polls redraws only when what it shows changed, so a hovered row or an open menu stays put.

**A schedule is a `.cs-item` too**: its rule in words as the title (`tm/schedules.py label`, never worked out in the
page), *Next tomorrow 9:00 (in 19 h) · last ran today 14:27* as the meta, a green / grey / red dot for on / paused /
could not start, ▷ Run now and ⋯ on hover. **The Schedule dialog** is the Add-folder dialog's frame (`.agents-modal`):
property rows whose pickers keep their own width side by side (`.agents-sched-inline`), the days as toggle pills
(`.agents-sched-day`), and a muted warning with the `alert` icon when nobody would be there to answer a permission.

### Resizing a panel

A panel whose width (or the dock's height) the user picks gets a grip wired by `wireResizer` (`resizer.js`): drag, ←/→
(↑/↓) while focused, double-click to reset, a `*-resizing` class on `<html>` while dragging. `cssWidth` keeps a width
in a CSS variable and a pref. The grip is 7px wide, transparent, and draws a `--focus` line on hover, focus and drag
(`#side-resizer`, `.docs-resizer`, `.td-grip`); it is a `role="separator"` with a label, and it hides where the panel
stacks (≤760px). Never another hand-written copy.

### Menus and pickers

Use `select()` (button + searchable menu, `search: true` for long lists), `selectButton()` + `dropdown()` for action
menus, and the app's own date picker (`dateInput()`, `pickDate()` in `datepicker.js`), never the browser's
`<input type=date>`.

## 4. Do / don't

| Do | Don't |
|---|---|
| Reuse `prop-rows`, `quiet`, `cards rows`, `statusChip`, `select`, `quietBlanks`, `emptyState`, `mdBlock`, and the Panel kit. | Write a new chip, pill, button or row style for one screen. |
| Show a value as text; frame it on hover. | Leave bordered inputs on a card, a page or the create form. |
| Ask on creation only what is known then. | Offer on the create form a field a later step writes (branch, disposition…). |
| A dot + words for status. | Fill a status or a whole column with colour. |
| A line between rows. | A box around each row of a list. |
| An empty property reads *Empty* in grey; an empty kind of child waits on *+ Add …*. | A wall of framed empty fields or empty headers. |
| A sentence for "how it goes". | Progress bars, score cards, KPI tiles inside items. |
| Undo in a toast. | `confirm()` for something reversible. |
| Tokens and `--fs-*` sizes. | Hex colours or pixel font sizes in a rule. |
| `cssKey()`/`statusCss()` for a status's classes. | Hard-coded status or type names (they are structure data, `tm/structures/`). |
| `refOf(item)` for an id on screen. | `item.id` in a label: in a vault on short ids it is a bare number (`482`). |
| One view bar on every list, board and section tab (`viewBar`). | A filter drawer, a scope segment or a select of a page's own. |
| Let a narrow page drop columns and words (`hiddenColumns`, container queries). | Make the page scroll sideways. |

## 5. Checking a UI change

1. Both suites green (CLAUDE.md *Done means*).
2. On a sample server (`python3 tools/serve_sample.py`, `--legacy` to also see an Initiatives vault): the changed screens at **375, 820, 1000, 1303 px**,
   light **and** dark, no horizontal scroll, no console errors (README §6 *Checking a layout change*).
3. Hover and touch: whatever is quiet until hover must be visible on a phone (`@media (hover: none)`).
4. Open a few selects on the changed screens: they must open (a name clash once broke every menu).
5. README §7 says what a user now sees; CHANGELOG under *Unreleased*.

## 6. Where things are

| Thing | File |
|---|---|
| Tokens, every style | `static/css/app.css` (sections marked `/* ── … ── */`) |
| `h`, `icon`, `select`, `dropdown`, `tabPanels`, `itemCard`, `statusChip`, `statusLabel`, `emptyState`, `carriedAction`; the Panel kit (`secondaryButton`, `stackGroup`, `rowList`, `rowItem`, `rowAction`) | `static/js/ui.js` |
| Property fields, `statusSelect`, `quietBlanks`, `planControl` | `static/js/itemform.js` |
| The description block (`mdBlock`: rendered box, editor on a click, full screen) | `static/js/mdblock.js` |
| Card and page layout, Properties, Relations, tabs of children | `static/js/panel.js` |
| Tables | `static/js/datatable.js` |
| The graph: canvas, layout and filters, edge styles | `static/js/graphcanvas.js`, `graphlayout.js`, `graphmodel.js`, `graphstyle.js` |
| Dates for reading | `static/js/dates.js` |
| The redesign's mock-ups (card A, header B, initiative C, phone D) | the owner's design canvas: https://claude.ai/artifact/KjaKJv2B5fgcuN8EheQP7p (private; option A is the one built) |
