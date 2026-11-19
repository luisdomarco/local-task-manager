# Install it with Claude

The quickest way to get Local Task Manager running on a Mac: open **Claude Code** (in a terminal, `claude`; or the
Claude desktop app's Code tab) in any folder, and paste the prompt below. Claude checks what your machine has,
installs what is missing, gets the code, installs the app, sets up your first vault with its first project and
opens it. It asks you before anything that needs your password, and before it writes into a folder that already
has files.

You need nothing else: no account, no database, nothing to buy. The app stores everything as Markdown files in a
folder you choose. Prefer to do it by hand? The [README](../README.md#2-setup-in-5-minutes) has the same steps.

````text
Install Local Task Manager on this computer, set up my first vault and open it for me. Work one step at a time, tell
me what each step does, and stop to ask me where a step says so. Never use sudo, never pip install anything (the app
uses Python's standard library only) and never edit the app's config.json by hand: steps 6 and 8 go through the
app itself.

1. The computer: run `uname -s`.
   - `Darwin` (a Mac): go on.
   - `Linux`: go on, but skip step 5. Instead, after step 4, ask me to run `python3 server.py` in the app's folder in
     a terminal of my own and leave it running; then use http://localhost:3100 wherever these steps say
     http://localhost:3200, and skip the Dock part of step 9.
   - Anything else (Windows): stop and tell me it is not supported (the app's embedded terminal needs a Unix system).

2. Python and git: run `python3 --version` and `git --version`. Python must be 3.9 or newer. If either is missing,
   or a dialog offers to install the "command line developer tools", run `xcode-select --install` (a Mac only: it
   installs Apple's Command Line Tools, which include Python 3.9 and git), ask me to click Install in the window it
   opens and to tell you when it has finished, then check both again. On Linux, ask me to install them with my
   package manager. From here on, `python3` means the one you just checked.

3. The code: ask me where to keep it (default `~/Applications/local-task-manager`).
   - If it does not exist, run `git clone https://github.com/luisdomarco/local-task-manager.git <that folder>` and `cd` into it.
   - If `git -C <that folder> remote get-url origin` prints https://github.com/luisdomarco/local-task-manager.git, it is a clone of this app already: `cd` into
     it and run `git pull`.
   - If it exists and is something else, stop and ask me for another folder.
   Then run the tests: `python3 -m unittest discover -s tests -t .`. They take 2 to 3 minutes: give the command a
   timeout of at least 5 minutes, or run it in the background and wait for it. Judge them by the last lines only:
   `OK` passed, `FAILED (…)` did not. Warnings and messages printed above them are normal. If anything fails, show
   me the failures and ask me whether to go on.

4. My vault's folder: ask me where to keep my tasks (default `~/Documents/Tasks`). If the folder does not exist,
   make it with `mkdir -p`. If it exists and has files in it, list a few of them, tell me the app will add its own
   folders there, and ask me whether to use it or pick another one. Never use my home folder itself. Keep the
   folder's full absolute path (with `~` expanded) for the next steps.

5. The app (a Mac): check whether it is already installed with
   `test -f ~/Library/LaunchAgents/com.taskmanager.app.plist`.
   - Not installed: run `python3 tools/install_app.py`. It copies the app to
     `~/Library/Application Support/TaskManager/app` and registers it with macOS so it starts on its own whenever
     http://localhost:3200 is opened. The last line it prints names the address: if it is not port 3200, use the
     one it prints from here on.
   - Installed already: run `python3 tools/install_app.py --update` (it copies the new code over the app's and
     restarts it; my settings and vaults stay as they are).
   Then wait until the app answers:
   `for i in $(seq 30); do curl -sf -o /dev/null http://localhost:3200/api/config && break; sleep 1; done`
   and check that `curl -sf http://localhost:3200/api/config` prints JSON. If it never answers, show me the end of
   `~/Library/Logs/TaskManager/server.log` and stop.

6. Add the vault to the app. Ask me what to call it (default "My tasks"). Then send that name and the folder of
   step 4, letting Python write the JSON so that no quote in them can break it:
   `python3 -c 'import json, sys; print(json.dumps({"name": sys.argv[1], "path": sys.argv[2]}))' "<name>" "<absolute folder>" | curl -sS -X POST http://localhost:3200/api/vaults/add -H 'X-Task-Manager: 1' -H 'Content-Type: application/json' --data-binary @-`
   It answers `{"vault": {"id": …}, "added": true}`; keep the `id`. `"added": false` means that folder was already
   one of the app's vaults: that is fine, use its id. An `{"error": …}` answer explains itself (a folder that is
   another kind of vault, for one): show it to me and stop. The vault becomes the one the app opens first. On a new
   install it takes the place of the sample vault the app comes with.
   Then make the vault's folders (empty folders, plus the app's own hidden `.task-manager/` folder):
   `curl -sS -X POST http://localhost:3200/api/vault/create-folders -H 'X-Task-Manager: 1' -H 'X-TM-Vault: <id>' -H 'Content-Type: application/json' -d '{}'`
   What matters in the answer is `"ok": true`; the other fields (`"can_create_folders": false` among them) only
   say there is nothing left to create.

7. My first project: ask me for a project name (for example "Home" or the name of my product) and a key of 2 to 4
   capital letters (for example `HM`: it starts every ticket number of the project and cannot be changed later).
   Then, still in the folder of step 3:
   `python3 tools/vault.py -C "<absolute folder>" new project "<name>" --set project_key=<KEY>`
   If it refuses the key, tell me why and ask for another. Then run
   `python3 tools/vault.py -C "<absolute folder>" check`: it must say "The vault matches its structure."

8. Agents (optional): ask me whether I use AI agents (Claude Code, Codex, Cursor) and want them to be able to read and
   write my tasks. If yes, ask the app to write the guide, so that it names the app's own copy of the tools:
   `curl -sS -X POST http://localhost:3200/api/vault/agents -H 'X-Task-Manager: 1' -H 'X-TM-Vault: <id>' -H 'Content-Type: application/json' -d '{"on": true}'`
   It writes an AGENTS.md (and a one-line CLAUDE.md pointing to it) at the top of the vault, which tells an agent
   opened in that folder how to work with it, and the app keeps it up to date. If no, skip it: it can be turned on
   later in Settings → Vaults.

9. Open it: run `open http://localhost:3200` (on Linux, `xdg-open http://localhost:3100`). Then tell me:
   - The first time, the sidebar shows the vault's files (the Explorer). To see it as tasks and projects, click
     **Project**: the first of the three small icons at the foot of the sidebar, under the vault's name (its tooltip
     says Project). My project is then under Projects, and Add item, at the top of the sidebar, makes tasks, notes
     and the rest.
   - If macOS asks whether Python may access the folder of my vault (Documents, for one), I should click Allow:
     the app is a Python program reading that folder.
   - To keep it in the Dock like an app: in Safari, File → Add to Dock; in Chrome, ⋮ → Cast, save and share →
     Install page as app. It runs only while it is open, and starts again by itself the next time.
   - Settings → Documentation is the user guide, inside the app.

10. Finish with a summary: where the code is, where the app is installed, the vault's name and folder, the project and
    its key, and whether the agents' guide is on. Tell me how to update later: in the code's folder,
    `git pull && python3 tools/install_app.py --update`; and how to remove the app:
    `python3 tools/install_app.py --uninstall` (my vault and its files stay where they are). On Linux instead: to
    update, `git pull` and start `python3 server.py` again; to remove it, stop it and delete the code's folder.
````

## What it leaves on your Mac

| What | Where |
|---|---|
| The code you cloned | `~/Applications/local-task-manager` (or the folder you chose) |
| The app it runs | `~/Library/Application Support/TaskManager/app`, started on demand by a LaunchAgent (`com.taskmanager.app`) |
| The app's settings | `config.json` in the app's folder: your vaults and their folders, this Mac's only |
| Its logs | `~/Library/Logs/TaskManager/` |
| Your vault | the folder you chose: plain Markdown files, yours to keep, also readable in Obsidian or any editor |

To remove it: `python3 tools/install_app.py --uninstall` in the code's folder (your vaults and their files stay where
they are, and so does the app's `config.json`).

## If something goes wrong

- **`curl` says the connection was refused after step 5.** The app starts on the first connection; give it a few
  seconds and try again. If it still does not answer, look at `~/Library/Logs/TaskManager/`.
- **The app says the vault's folder is not found, or "Operation not permitted".** macOS asked whether Python may
  read that folder and it was not allowed. In System Settings → Privacy & Security → Files and Folders, let Python
  open it (or pick a folder outside Documents, Desktop and iCloud Drive), then open the app again.
- **Step 6 answers that the folder "holds a vault of the Initiatives (or Tasks) structure".** That folder is an older
  kind of vault. Add it as it is by sending `"structure": "folders"` (or `"tasks"`) in the same request, then see
  [moving it to Projects](migrate-structures.md).
- **Something else.** Every step can be done by hand too: [README §2](../README.md#2-setup-in-5-minutes).
