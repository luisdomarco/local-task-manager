# Local Task Manager — user guide

Your tasks, projects, notes and meetings as **plain Markdown files** in folders you choose. No account, no database, nothing sent anywhere: the app runs on your computer and reads and writes those files. Open the same files in Obsidian, any editor or Claude Code at the same time; the app picks up their changes.

## What it gives you

- **One place for the work and its context.** Initiatives, stories, tasks, notes, meetings and their transcripts, incoming messages, prompts and AI agents — each one a Markdown file with its properties on top.
- **Planning by day and by week.** Today is a board of columns of your own; Tomorrow and Week show what is planned; anything left from a past day is carried over, marked in red.
- **Pages for the big items.** An initiative (or a Ticketing project) has its own page: progress, properties, the description, its files, and a tab for each kind of thing that hangs from it, each with its count.
- **Favourites.** Star an initiative on its page and it stays in the sidebar, right under *Add item*.
- **Search everything.** ⌘K finds items, views and files and runs commands.
- **Time per item.** Log work on any item; the Work log shows the days and suggests what you forgot.
- **Claude Code built in.** Start a Claude session on any item from its card: it gets the item as its prompt, in the item's folder, and the session is remembered so you can resume it.
- **Safe with your files.** Writes are atomic, deletes go to a Trash you can restore from, and an outside edit is never silently overwritten.

## Vaults and their structures

A **vault** is a folder of Markdown files. Each vault has a **structure** that says what its folders are and which files are items:

- **Folder per type** — one folder per kind of item (`tasks/`, `notes/`, `initiatives/`…), ids like `TSK-0001`. The simplest way to start.
- **Ticketing** — one folder per project, with its initiatives, support tickets, hotfixes, PRDs, plans and records inside, and ids like `ACME-INI-001`. For work organised by project.

Add as many vaults as you like in **Settings → Vaults** and switch between them with the selector at the foot of the sidebar. The app comes with a sample of each structure (`sample-vault/` and `sample-vault-ticketing/`): the quickest way to see every screen with something in it.

A new vault opens in the **Explorer** (its files). Click **Project**, the first button at the top of the sidebar, to see it as items. If folders the structure needs are missing, the page offers to create them.

## A day with it

1. **Capture.** Press `q` (or *Add item → Capture to Inbox*) and type one line. Tokens fill in the rest: `Call the bank @tomorrow !high +admin` plans it for tomorrow, high priority, label *admin*. Inbox items are converted into a task, a note… when you have a minute.
2. **Plan.** Drag items into **Today**, or plan them for a day or a week from their card. Today's columns are yours: *Morning*, *Waiting*, whatever helps.
3. **Work.** Open a card: change its status and priority, write the description (Markdown, with a live preview and a dictation mic), attach files, link it to other items, comment on it, log time.
4. **Review.** **Week** shows the week by day. **Board** shows tasks by list. **All items** lists everything, with its filters.

## Items and their cards

Every item opens as a card over the list it came from (or as a page, for initiatives and projects):

- **Properties** — status, priority, plan, due date, labels, and the type's own fields.
- **Description** — Markdown. *Edit* opens the editor; *Both* shows the preview beside it.
- **What hangs from it** — tabs under the description, one per kind (Tasks, Notes, Meetings…), each with its count, a one-line *Add* field and Open / Closed / All.
- **Side panel** — **Details** (outside ticket, local folder, session, links, work log), **Relations** (parent, children, related items), **Activity** (comments; `@` mentions a person) and **AI** (its Claude sessions).

Labels and people fields keep to one line: what does not fit waits behind **+N**; click it to see and edit them all.

## Finding your way

| Keys | Does |
|---|---|
| `⌘K` | Search items, views and files; run a command |
| `q` | Capture to the Inbox |
| `g` then a letter | Go to a view (`g t` Today, `g w` Week, `g b` Board…) |
| `/` | Focus the list's filter |
| `Esc` | Close the top layer |
| `⌘\` | Hide or show the sidebar |
| `⌘⇧E` | Switch the sidebar between Project and Explorer |
| `⌘⇧D` | Open Docs |

**Settings → Keyboard** lists them all.

## Docs and files

- **Docs** (⌘⇧D) are the vault's documents that are not items: specs, guides, decisions. They live in the vault's `docs/` (or a project's `Docs/`) and show as trees, with the document on the right.
- The **Explorer** shows the vault as files: preview, edit, rename, move, search inside files, drop files in from Finder. CSV files open as tables.

## Working with Claude

The terminal button on a card starts **Claude Code** on that item: it shows you the folder it will start in and the exact prompt first. It runs in the terminal dock at the bottom of the app, or in Terminal, Claude Desktop, Cursor or Antigravity. Every session is recorded on the item; *Resume* continues it where it was. Set the default folder, model and effort in **Settings → Claude**.

## Keeping your data safe

- Everything is plain Markdown in your folders: back them up, sync them, put them in git as you like.
- **Trash** keeps what you delete until you empty it; *Restore* puts it back where it was.
- **Settings → Export** makes zips of the app, of its Claude commands, or of a vault, to carry to another machine.
- The app only listens on your own computer (`127.0.0.1`).

## More

`README.md`, in the app's folder, is the full reference: setup, the Mac app mode, every screen in detail, the file formats and how to develop the app.
