"""What an agent run changed in its folder, for its detail's Changes (server.py agent_run_changes / agent_run_diff).

When a run starts in a git work tree, `snapshot` notes where the folder stood: `base`, a commit of its tracked files as
they were (`git stash create`, which writes one loose object and touches neither the files, the index nor
refs/stash; HEAD when nothing was changed), and `untracked`, the files git did not track then. Later, `changes` lists
what differs from that: the tracked files changed since (`git diff <base>`) and the files new since (untracked now and
not then). It is the folder's difference, not the run's alone: what you or another program changed in the folder
meanwhile shows too, and a file untracked at the start and changed since does not. Outside a git work tree there is
nothing to compare with: no snapshot, no Changes.

git runs with an argument list (never a shell), in the run's folder, with core.fsmonitor off (a repository's own
config could name a program for git to run while it looks). Stdlib only."""
import os
import stat
import subprocess

GIT = ('git', '-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false')
TIMEOUT = 15
UNTRACKED_MAX = 2000      # as tm/agentruns.py keeps them
FILES_MAX = 500           # files listed in a run's Changes
DIFF_MAX = 400_000        # characters of one file's diff
NEW_FILE_MAX = 2_000_000  # bytes of a new file whose lines are counted


def _git(cwd, *args, ok=(0,)):
    """git's output, or None when it failed or could not run."""
    try:
        out = subprocess.run([*GIT, *args], cwd=cwd, capture_output=True, timeout=TIMEOUT)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.decode('utf-8', 'replace') if out.returncode in ok else None


WORKTREES = '.claude/worktrees/'  # where Claude Code and this app (tm/runworktree.py) put worktrees: never a run's work


def _untracked(cwd):
    out = _git(cwd, 'ls-files', '--others', '--exclude-standard', '-z')
    return [f for f in (out or '').split('\0') if f and not f.startswith(WORKTREES)]


def snapshot(cwd):
    """Where a folder stands as a run starts: {'base', 'untracked'}, or {} outside a git work tree (or one with no
    commit yet: nothing to diff against)."""
    if not cwd or (_git(cwd, 'rev-parse', '--is-inside-work-tree') or '').strip() != 'true':
        return {}
    base = (_git(cwd, 'stash', 'create') or '').strip() or (_git(cwd, 'rev-parse', '--verify', '-q', 'HEAD') or '').strip()
    if not base:
        return {}
    return {'base': base, 'untracked': _untracked(cwd)[:UNTRACKED_MAX]}


def _counts(full):
    """(lines, binary) of a new file: its lines unless it looks binary (a NUL early on) or is too big to read. Only a
    regular file is opened — never a link (it could lead to a device), a pipe (opening it waits for a writer) or a
    socket — and never more of it than NEW_FILE_MAX."""
    try:
        # Opened once, then looked at: what is read is what was checked, even if the file changes in between.
        fd = os.open(full, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        return None, False
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            return None, False
        with os.fdopen(fd, 'rb', closefd=False) as f:
            data = f.read(NEW_FILE_MAX + 1)
    except OSError:
        return None, False
    finally:
        os.close(fd)
    if len(data) > NEW_FILE_MAX:
        return None, False
    if b'\0' in data[:8000]:
        return None, True
    return data.count(b'\n') + (1 if data and not data.endswith(b'\n') else 0), False


def changes(cwd, base, before=()):
    """The files that differ from the snapshot, by path: [{'path', 'status' ('M' changed, 'A' new, 'D' deleted, 'T'
    type), 'added', 'deleted' (lines; None when binary or unknown), 'binary'}], at most FILES_MAX — or None when git
    cannot compare (the folder gone, the snapshot pruned)."""
    if not base or not os.path.isdir(cwd or ''):
        return None
    status = _git(cwd, 'diff', '--no-renames', '--name-status', '-z', base)
    numstat = _git(cwd, 'diff', '--no-renames', '--numstat', '-z', base)
    if status is None or numstat is None:
        return None
    files = {}
    parts = status.split('\0')
    for st, path in zip(parts[::2], parts[1::2]):
        if path:
            files[path] = {'path': path, 'status': st[:1] or 'M', 'added': None, 'deleted': None, 'binary': False}
    for rec in numstat.split('\0'):
        bits = rec.split('\t', 2)
        if len(bits) == 3 and bits[2] in files:
            binary = bits[0] == '-'
            files[bits[2]].update(added=None if binary else int(bits[0]), deleted=None if binary else int(bits[1]), binary=binary)
    was = set(before or ())
    for path in _untracked(cwd):
        if path not in was and path not in files:
            lines, binary = _counts(os.path.join(cwd, path))
            files[path] = {'path': path, 'status': 'A', 'added': lines, 'deleted': 0 if lines is not None else None, 'binary': binary, 'new': True}
    return sorted(files.values(), key=lambda f: f['path'])[:FILES_MAX]


def diff(cwd, base, before, path):
    """One file's unified diff against the snapshot: {'path', 'diff', 'truncated'} — None when the file is not among
    `changes` (only those are shown: no path of the caller's reaches git)."""
    listed = changes(cwd, base, before) or []
    f = next((x for x in listed if x['path'] == path), None)
    if not f:
        return None
    if f.get('new'):  # untracked: against nothing (exit 1 means "they differ")
        text = _git(cwd, 'diff', '--no-index', '--', os.devnull, path, ok=(0, 1))
    else:
        text = _git(cwd, 'diff', '--no-renames', base, '--', path)
    text = text or ''
    return {'path': path, 'status': f['status'], 'binary': f['binary'], 'diff': text[:DIFF_MAX], 'truncated': len(text) > DIFF_MAX}
