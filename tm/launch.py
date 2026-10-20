"""The script Terminal runs to start Claude on an item. Pure text in, text out, so it can be tested without a terminal."""
import glob
import json
import os
import re
import shlex
from datetime import datetime
from urllib.parse import quote, urlencode

# What the dialog may ask for. Closed lists: the browser never sends a free-form argument to the command line.
CLAUDE_MODELS = ("fable", "opus", "sonnet", "haiku")
CLAUDE_EFFORTS = ("low", "medium", "high", "xhigh", "max")
# A Claude Code session id (what `--session-id` sets and `--resume` takes back): a lowercase UUID v4.
SESSION_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
SESSION_NAME_MAX = 60  # `--name`: what `claude --resume` lists; kept short so the picker stays readable


def claude_theme(home=None):
    """'light' or 'dark': the theme Claude Code draws its screen with (the one picked when it was installed,
    changed with /theme), from its settings.json, else ~/.claude.json. Claude's default is dark. Only read."""
    home = home or os.path.expanduser("~")
    config_dir = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(home, ".claude")
    for path in (os.path.join(config_dir, "settings.json"), os.path.join(home, ".claude.json")):
        try:
            with open(path, encoding="utf-8") as f:
                theme = json.load(f).get("theme")
        except (OSError, ValueError, AttributeError):
            continue
        if isinstance(theme, str) and theme:
            return "light" if theme.startswith("light") else "dark"  # light-daltonized, light-ansi… are light too
    return "dark"


def session_updated(session_id, cwd, home=None):
    """When a Claude Code conversation was last written: the time of its transcript,
    <config>/projects/<cwd with every non-alphanumeric as ->/<session id>.jsonl (else that id in any project).
    None when there is none: Claude never saved it (it ended before a message), so it cannot be resumed."""
    if not SESSION_RE.match(str(session_id or "")):
        return None
    home = home or os.path.expanduser("~")
    projects = os.path.join(os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(home, ".claude"), "projects")
    path = os.path.join(projects, re.sub(r"[^A-Za-z0-9]", "-", str(cwd or "")), f"{session_id}.jsonl")
    if not os.path.isfile(path):
        found = glob.glob(os.path.join(glob.escape(projects), "*", f"{session_id}.jsonl"))
        if not found:
            return None
        path = found[0]
    return datetime.fromtimestamp(os.path.getmtime(path)).strftime("%Y-%m-%dT%H:%M")


def claude_flags(model="", effort=""):
    """`--model` / `--effort` for claude, from the dialog's choices (empty = leave it to Claude's own default)."""
    model, effort = (model or "").strip(), (effort or "").strip()
    if model and model not in CLAUDE_MODELS:
        raise ValueError(f"model must be one of {', '.join(CLAUDE_MODELS)}")
    if effort and effort not in CLAUDE_EFFORTS:
        raise ValueError(f"effort must be one of {', '.join(CLAUDE_EFFORTS)}")
    return (["--model", model] if model else []) + (["--effort", effort] if effort else [])


def session_flags(session_id, name=""):
    """`--session-id` (so the session can be resumed later) and `--name` (so it is recognisable in `claude --resume`)."""
    if not SESSION_RE.match(session_id or ""):
        raise ValueError("not a session id")
    name = " ".join(str(name or "").split())[:SESSION_NAME_MAX].strip()
    return ["--session-id", session_id] + (["--name", name] if name else [])


def resume_flags(session_id):
    """`--resume <id>`: reopen a recorded session. Nothing else: the session already has its model and effort."""
    if not SESSION_RE.match(session_id or ""):
        raise ValueError("not a session id")
    return ["--resume", session_id]


# Where else a session can open (Open in ▾, TSK-038). The IDEs run Claude Code's own extension, whose URI handler
# `/open` takes `session` (resume it) or `prompt` (a new one, the prompt written, not sent): their URL schemes.
IDE_SCHEMES = {"cursor": "cursor", "antigravity": "antigravity"}


def desktop_resume_flags(session_id):
    """`--desktop --resume <id>`: the CLI hands a recorded session to the Claude Desktop app (in its sidebar)."""
    return ["--desktop", *resume_flags(session_id)]


def desktop_new_url(cwd, prompt):
    """A new Claude Code session in Claude Desktop, in `cwd`, with `prompt` written in its box (not sent)."""
    return "claude://code/new?" + urlencode({"folder": cwd, "q": prompt or ""}, quote_via=quote)


def ide_open_url(ide, session=None, prompt=None):
    """The Claude Code extension of an IDE (Cursor, Antigravity): resume `session`, or open a new one with `prompt`
    written (not sent). Every value URL-encoded: a prompt full of `&`, `#`, quotes or new lines stays one value."""
    if ide not in IDE_SCHEMES:
        raise ValueError(f"ide must be one of {', '.join(IDE_SCHEMES)}")
    if session is not None and not SESSION_RE.match(session):
        raise ValueError("not a session id")
    params = {k: v for k, v in (("session", session), ("prompt", prompt)) if v}
    return f"{IDE_SCHEMES[ide]}://anthropic.claude-code/open" + (f"?{urlencode(params, quote_via=quote)}" if params else "")


def claude_script(cwd, prompt_file, tmpdir, command, flags=()):
    """The .command file's content. Nothing from the item is written into it: the prompt is read from a file,
    so a description full of quotes, `$(…)` or backticks is just text. Every path and every word of the
    command (and its flags) is quoted. The temp folder removes itself as soon as the prompt has been read.
    `prompt_file=None` (a resume) starts claude with the flags alone."""
    run = " ".join(shlex.quote(w) for w in [*shlex.split(command), *flags])
    return '\n'.join([
        '#!/bin/zsh',
        f'cd {shlex.quote(cwd)} || exit 1',
        *([f'prompt=$(cat {shlex.quote(prompt_file)})'] if prompt_file else []),
        f'rm -rf {shlex.quote(tmpdir)}',
        'clear',
        f'{run} "$prompt"' if prompt_file else run,
        '',
    ])
