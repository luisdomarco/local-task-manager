"""An agent run in a worktree of its own (server.py start_agent_run / launch_agent with where='worktree'): a new git
worktree of the agent's folder on a new branch, from HEAD, so the run changes nothing in the folder you work in.

It lives where Claude Code puts its own, `<repository>/.claude/worktrees/agents-<6 hex>`, on the branch
`agents/<command>-<6 hex>`; the run starts in the same place inside it as the agent's folder is inside the repository.
A worktree has only what is committed, so the command's own file must be (else Claude would not find it there).
`remove` takes the worktree away and keeps its branch: what the run committed stays. git runs with an argument list,
never a shell, with core.fsmonitor off. Stdlib only."""
import os
import re
import secrets
import subprocess

GIT = ('git', '-c', 'core.fsmonitor=false')
TIMEOUT = 30


class WorktreeError(Exception):
    """Why a worktree cannot be made or taken away, in words for the page. `dirty`: it holds changes."""

    def __init__(self, message, dirty=False):
        super().__init__(message)
        self.dirty = dirty


def _git(cwd, *args):
    """(ok, output, error) of a git command."""
    try:
        out = subprocess.run([*GIT, *args], cwd=cwd, capture_output=True, timeout=TIMEOUT)
    except (OSError, subprocess.SubprocessError) as e:
        return False, '', str(e)
    return out.returncode == 0, out.stdout.decode('utf-8', 'replace').strip(), out.stderr.decode('utf-8', 'replace').strip()


def toplevel(folder):
    """The repository a folder is in (its work tree's root), or None when it is in none."""
    ok, out, _ = _git(folder, 'rev-parse', '--show-toplevel')
    return os.path.realpath(out) if ok and out else None


def slug(name):
    """A command's name as a branch's: `dev:start` → `dev-start`."""
    return re.sub(r'[^a-z0-9]+', '-', str(name).lower()).strip('-')[:40] or 'run'


def committed(top, rel):
    """Whether a worktree would have file `rel` as it is now: the file committed and unchanged — or, when it is reached
    through a link (a `.claude/commands` linked to a folder elsewhere, as this tree's repositories do), that link,
    which a worktree has too and which leads to the same place. → the path that was checked, or None."""
    parts = rel.split(os.sep)
    for i in range(1, len(parts) + 1):
        sub = os.path.join(*parts[:i])
        if i < len(parts) and not os.path.islink(os.path.join(top, sub)):
            continue
        tracked, _, _ = _git(top, 'ls-files', '--error-unmatch', '--', sub)
        clean, _, _ = _git(top, 'diff', '--quiet', 'HEAD', '--', sub)
        return sub if tracked and clean else None
    return None


def create(folder, command_file, name):
    """A new worktree for a run of command `name` (its file `command_file`) of agent folder `folder`: {'worktree', 'branch',
    'cwd'} — cwd being where the run starts in it. Raises WorktreeError when the folder is in no repository, the
    repository has no commit, or the command's file is not committed as it is."""
    top = toplevel(folder)
    if not top:
        raise WorktreeError('this folder is not in a git repository: a worktree needs one')
    ok, _, _ = _git(top, 'rev-parse', '--verify', '-q', 'HEAD')
    if not ok:
        raise WorktreeError('this repository has no commit yet: a worktree starts from one')
    # The command's path as found (links not followed), from the repository's root.
    rel = os.path.relpath(os.path.join(os.path.realpath(folder), os.path.relpath(command_file, folder)), top)
    if rel.startswith('..'):
        raise WorktreeError(f'/{name} lives outside the repository: a new worktree would not have it')
    held = committed(top, rel)
    if not held:
        raise WorktreeError(f'/{name} is not committed as it is ({rel}): a new worktree only has what is committed — commit it, or run it in this folder')
    tag = secrets.token_hex(3)
    path = os.path.join(top, '.claude', 'worktrees', f'agents-{tag}')
    branch = f'agents/{slug(name)}-{tag}'
    ok, _, err = _git(top, 'worktree', 'add', '-b', branch, path, 'HEAD')
    if not ok:
        raise WorktreeError(f'git could not add the worktree: {err or "no reason given"}')
    inside = os.path.relpath(os.path.realpath(folder), top)
    return {'worktree': path, 'branch': branch, 'cwd': path if inside == '.' else os.path.join(path, inside)}


def remove(worktree, force=False):
    """Takes a run's worktree away; its branch stays. A worktree with changes is kept unless `force` (WorktreeError
    with dirty=True says so). Gone already: nothing to do."""
    if not os.path.isdir(worktree):
        return
    ok, out, err = _git(worktree, 'rev-parse', '--git-common-dir')
    if not ok:
        raise WorktreeError(f'this is not a git worktree any more: {err or worktree}')
    common = out if os.path.isabs(out) else os.path.join(worktree, out)
    repo = os.path.dirname(os.path.realpath(common))  # the main work tree: git works on a worktree from there
    if not force:
        ok, status, _ = _git(worktree, 'status', '--porcelain')
        if ok and status:
            raise WorktreeError('the worktree has changes nobody committed: taking it away loses them', dirty=True)
    ok, _, err = _git(repo, 'worktree', 'remove', *(['--force'] if force else []), worktree)
    if not ok:
        raise WorktreeError(f'git could not remove the worktree: {err or "no reason given"}', dirty='modified or untracked' in err)
