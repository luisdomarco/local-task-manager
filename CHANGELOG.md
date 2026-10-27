# Changelog

All notable changes to this project are written down here. Versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

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
