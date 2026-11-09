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
# …or a version pinned by its id, as claude lists the older ones ("claude-opus-4-8", "claude-haiku-4-5-20251001"): a
# shape, not a list, since claude names them; it never holds anything a shell would read.
MODEL_ID_RE = re.compile(r"claude-[a-z]+(?:-\d{1,2}){1,2}(?:-\d{8})?")
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


def transcript_path(session_id, cwd, home=None):
    """A Claude Code conversation's transcript: <config>/projects/<cwd with every non-alphanumeric as ->/<id>.jsonl
    (else that id in any project). None when there is none: Claude never saved it (it ended before a message)."""
    if not SESSION_RE.match(str(session_id or "")):
        return None
    projects = _projects_dir(home)
    path = os.path.join(projects, _slug(cwd), f"{session_id}.jsonl")
    if os.path.isfile(path):
        return path
    found = glob.glob(os.path.join(glob.escape(projects), "*", f"{session_id}.jsonl"))
    return found[0] if found else None


def session_updated(session_id, cwd, home=None):
    """When a Claude Code conversation was last written: the time of its transcript. None when there is none, so it
    cannot be resumed."""
    path = transcript_path(session_id, cwd, home)
    return datetime.fromtimestamp(os.path.getmtime(path)).strftime("%Y-%m-%dT%H:%M") if path else None


# Where a session on disk was started, from its transcript's `entrypoint` (what the AI tab's Add a session shows).
SESSION_SOURCES = {"cli": "Terminal", "claude-desktop": "Claude Desktop", "claude-vscode": "VS Code / Cursor",
                   "sdk-cli": "SDK", "sdk-py": "SDK", "sdk-ts": "SDK"}
_HEAD = _TAIL = 64 * 1024  # what is read of a transcript: its start says where it ran, its end its latest title


def _projects_dir(home=None):
    home = home or os.path.expanduser("~")
    return os.path.join(os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(home, ".claude"), "projects")


def _first_prompt(message):
    """The text of a user message, skipping what Claude Code itself puts there (<command-…>, <system-reminder>…)."""
    content = (message or {}).get("content")
    texts = [content] if isinstance(content, str) else [b.get("text") for b in content or [] if isinstance(b, dict) and b.get("type") == "text"]
    for t in texts:
        t = " ".join(str(t or "").split())
        if t and not t.startswith("<"):
            return t
    return ""


def session_facts(path):
    """What a transcript says about its conversation: {id, cwd, started, updated, title, source}, or None when it
    holds no message of the user (nothing to resume). Reads its first and last 64 KB only: transcripts grow to MBs.
    The title is the last one given (/rename, else Claude's own), else the first thing asked."""
    sid = os.path.basename(path)[:-len(".jsonl")]
    if not SESSION_RE.match(sid):
        return None
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            head = f.read(_HEAD)
            if size > _HEAD:
                f.seek(max(_HEAD, size - _TAIL))
            tail = f.read(_TAIL) if size > _HEAD else b""
        updated = datetime.fromtimestamp(os.path.getmtime(path)).strftime("%Y-%m-%dT%H:%M")
    except OSError:
        return None
    facts = {"id": sid, "cwd": "", "started": "", "updated": updated, "title": "", "source": ""}
    prompt, titles = "", {}
    for chunk, whole in ((head, size <= _HEAD), (tail, True)):
        lines = chunk.decode("utf-8", "replace").split("\n")
        for line in lines if whole else lines[:-1]:  # the head's last line may be cut
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if not isinstance(d, dict):
                continue
            if d.get("type") in ("custom-title", "ai-title"):
                titles[d["type"]] = d.get("customTitle") or d.get("aiTitle") or titles.get(d["type"], "")
            elif d.get("type") == "user" and not d.get("isSidechain") and not d.get("isMeta"):
                facts["cwd"] = facts["cwd"] or str(d.get("cwd") or "")
                facts["source"] = facts["source"] or str(d.get("entrypoint") or "")
                if not facts["started"] and d.get("timestamp"):
                    try:
                        at = datetime.fromisoformat(str(d["timestamp"]).replace("Z", "+00:00"))
                        facts["started"] = at.astimezone().strftime("%Y-%m-%dT%H:%M")
                    except ValueError:
                        pass
                prompt = prompt or _first_prompt(d.get("message"))
    if not facts["cwd"]:
        return None
    facts["title"] = " ".join(str(titles.get("custom-title") or titles.get("ai-title") or prompt).split())[:120]
    return facts


def _mtime(path):
    try:
        return os.path.getmtime(path)
    except OSError:
        return 0


def _slug(cwd):
    """The name Claude Code gives a folder's transcripts' folder: every non-alphanumeric as -."""
    return re.sub(r"[^A-Za-z0-9]", "-", str(cwd or ""))


def recent_sessions(limit=60, home=None, cwd=None):
    """The newest Claude Code conversations on this computer, whatever started them (Terminal, Claude Desktop, the
    VS Code / Cursor extension, this app): newest first, the ones with nothing said left out. `cwd`: only the ones
    that ran in that folder, however old."""
    pattern = os.path.join(glob.escape(_projects_dir(home)), glob.escape(_slug(cwd)) if cwd else "*", "*.jsonl")
    out = []
    for path in sorted(glob.glob(pattern), key=_mtime, reverse=True)[:limit * 2]:
        facts = session_facts(path)
        if facts and (not cwd or facts["cwd"] == cwd):  # two folders can share a slug: the transcript says which
            out.append(facts)
        if len(out) >= limit:
            break
    return out


def session_folders(home=None):
    """Every folder Claude Code has run a conversation in on this computer: [{cwd, count, updated}], the last written
    first. The folder is read from the newest transcript of each (its name on disk loses the / and the .)."""
    out = {}
    for d in glob.glob(os.path.join(glob.escape(_projects_dir(home)), "*", "")):
        files = sorted(glob.glob(os.path.join(glob.escape(d), "*.jsonl")), key=_mtime, reverse=True)
        for path in files[:5]:  # the newest may hold nothing yet
            facts = session_facts(path)
            if facts:
                f = out.setdefault(facts["cwd"], {"cwd": facts["cwd"], "count": 0, "at": 0})
                f["count"] += len(files)
                f["at"] = max(f["at"], _mtime(files[0]))
                break
    return [{"cwd": f["cwd"], "count": f["count"], "updated": datetime.fromtimestamp(f["at"]).strftime("%Y-%m-%dT%H:%M")}
            for f in sorted(out.values(), key=lambda f: f["at"], reverse=True)]


def claude_flags(model="", effort=""):
    """`--model` / `--effort` for claude, from the dialog's choices (empty = leave it to Claude's own default)."""
    model, effort = (model or "").strip(), (effort or "").strip()
    if model and model not in CLAUDE_MODELS and not MODEL_ID_RE.fullmatch(model):
        raise ValueError(f"model must be one of {', '.join(CLAUDE_MODELS)}, or a model's id")
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
