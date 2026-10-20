# Install it with Claude

The quickest way to get Local Task Manager running on a Mac: open **Claude Code** (in a terminal, `claude`; or the
Claude desktop app's Code tab) in the folder where you keep your projects, and paste the prompt below. Claude checks
what your machine has, installs what is missing, sets up your first vault and opens the app. It asks before anything
that needs your password or touches files you already have.

Prefer to do it by hand? The [README](../README.md#2-setup-in-5-minutes) has the same steps.

````text
Install Local Task Manager on this Mac and open it for me. Work step by step, tell me what you are doing, and ask me
before anything that needs my password or would change a file that already exists.

1. Python: run `python3 --version`. It must be 3.9 or newer. If `python3` is missing, run `xcode-select --install`
   (it installs Apple's Command Line Tools, which include Python 3.9) and wait for me to finish the installer
   window. Do not install anything with pip: the app uses the standard library only.
2. Git: run `git --version`; the Command Line Tools above include it.
3. The code: clone https://github.com/luisdomarco/local-task-manager.git into `~/Applications/local-task-manager` (or a folder I name), unless it is already
   there; then `cd` into it. If it is already there, run `git pull` instead.
4. Check it: run `/usr/bin/python3 -m unittest discover -s tests -t .` and tell me if anything fails.
5. My first vault: ask me which structure I want — "Folder per type" (one folder per kind of item; the simplest) or
   "Ticketing" (one folder per project) — and where to keep it (default `~/Documents/Tasks`). If the folder does not
   exist, make it empty. Never write into a folder that already has files without asking me.
6. Configuration: if there is no `config.json` in the app's folder yet, write one from `config.example.json` with a
   single vault: `{"id": "main", "name": "My tasks", "path": "<the folder>", "structure": "folders" or "ticketing"}`
   and `"default_vault": "main"`. If a `config.json` exists, leave it alone and tell me to add the vault from
   Settings → Vaults instead.
7. The app: run `/usr/bin/python3 tools/install_app.py`. It copies the app to
   `~/Library/Application Support/TaskManager/app` and starts it on demand at http://localhost:3200. Then open
   http://localhost:3200 in my default browser (`open http://localhost:3200`).
8. Tell me how to put it in the Dock: in Safari, File → Add to Dock; in Chrome, ⋮ → Cast, save and share → Install
   page as app. Then point me to Settings → Documentation, which explains how to use it.
9. If my vault is new and empty, the app shows it in the Explorer and offers "Create the missing folders": tell me
   to click Project at the top of the sidebar and accept it. For a Ticketing vault, tell me to start with
   Add item → Project.

At the end, summarise what you installed, where everything is, and how to update it later
(`git pull`, then `/usr/bin/python3 tools/install_app.py --update`).
````

## What it leaves on your Mac

| What | Where |
|---|---|
| The code you cloned | `~/Applications/local-task-manager` (or the folder you chose) |
| The app it runs | `~/Library/Application Support/TaskManager/app`, started on demand by a LaunchAgent |
| Its logs | `~/Library/Logs/TaskManager/` |
| Your vault | the folder you chose: plain Markdown files, yours to keep |

To remove it: `python3 tools/install_app.py --uninstall` (your vaults and their files stay where they are).
