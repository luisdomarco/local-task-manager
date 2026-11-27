"""The CLI's shim inside a vault: `<vault>/.task-manager/vault.py`, the stable path the vault's guide for agents names.

Why it exists (SUP-407). The guide used to publish the absolute path of the app that last wrote it
(`os.path.join(app_dir, 'tools', 'vault.py')`), and `app_dir` answers «where was I run from», not «where is the app».
Six copies of the CLI are invocable on one machine (the installed app, a checkout, a worktree each) and every write
reseals the line with the running one, so the file that teaches agents how to write the vault told them to use a copy
the repo's own rules forbid. A vault also travels: by iCloud to the iPhone, whose bundle path carries a UUID that
changes on every reinstall. Four different values were observed for that one line, and realigning it by hand held only
until the next write.

So the guide names a path **relative to the vault** (`REL`), the same on every device and in every clone, and this
file resolves the engine **when it runs**: `$TASK_MANAGER_APP`, then the app installed on this Mac, then an iOS bundle
by glob, then the checkout a vault inside one sits in. Nothing of the writer is written down, so there is nothing left
to drift. Found nothing: it says where it looked and exits 127, never a traceback.

`installed_app` is the one place that spells out where tools/install_app.py puts the app; the installer reads it from
here, so the constant cannot fork in two (tests/test_vault_shim.py runs the shim against an install to tie them).
"""
import os

from .fsutil import atomic_write

META_DIR = '.task-manager'
NAME = 'vault.py'
REL = f'{META_DIR}/{NAME}'  # as the guide writes it, and as a shell finds it from the vault's folder
ENV = 'TASK_MANAGER_APP'
# Where tools/install_app.py puts the app, under the user's home: the installer's locations() reads it from here.
APP_REL = ('Library', 'Application Support', 'TaskManager', 'app')
# The iOS app: one bundle folder per install, its name a UUID that changes with every reinstall.
IOS_GLOB = '/private/var/containers/Bundle/Application/*/TaskManager.app/app'
EXIT_NO_ENGINE = 127  # the shell's «command not found»: not 1 (a refusal) and not 2 (a wrong command line)


def installed_app(home):
    """The folder tools/install_app.py installs the app into, for `home`."""
    return os.path.join(home, *APP_REL)


def path(root):
    """Where the shim goes in the vault `root`."""
    return os.path.join(root, META_DIR, NAME)


SOURCE = '''#!/usr/bin/env python3
"""This vault's Task Manager CLI. Run it from the vault's folder:

    python3 {rel} overview

Written by the app (tm/vaultshim.py), like everything in {meta}/: never edit it, and never copy an app's path into the
vault's AGENTS.md — this file is the path that stays right. It holds no path of its own: it looks for the app when it
runs and hands it the arguments unchanged, so the same vault works on this Mac, on another one, on the iPhone and in a
clone. Order: ${env}, the app installed under your home, an iOS bundle, the checkout a vault inside one sits in.
"""
import glob
import os
import sys

ENV = {env!r}
APP_REL = {app_rel!r}
IOS_GLOB = {ios_glob!r}
EXIT_NO_ENGINE = {exit_code!r}
VAULT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def candidates():
    """(what it is, the app folder) in the order they are tried. The app folder, not the script: both tools/vault.py
    and tm/store.py must be in it, so a folder that only happens to hold a vault.py is never run."""
    out = [('${{}}'.format(ENV), os.environ.get(ENV) or '')]
    out.append(('the app installed under your home', os.path.join(os.path.expanduser('~'), *APP_REL)))
    bundles = sorted(glob.glob(IOS_GLOB))
    out += [('the iOS app bundle', b) for b in bundles] or [('an iOS app bundle', IOS_GLOB)]
    out.append(('the checkout this vault sits in', os.path.dirname(VAULT)))
    return out


def engine():
    """(the tools/vault.py to run, every place looked at), the first None when there is none."""
    looked = []
    for what, app in candidates():
        cli = os.path.join(app, 'tools', 'vault.py') if app else ''
        looked.append((what, cli or '(not set)'))
        if cli and os.path.isfile(cli) and os.path.isfile(os.path.join(app, 'tm', 'store.py')):
            return cli, looked
    return None, looked


def main(argv=None):
    cli, looked = engine()
    if cli is None:
        lines = ['vault.py: no Task Manager app on this machine, so this vault has no CLI to run.',
                 'Looked for tools/vault.py in, in this order:']
        lines += ['  - {{}}: {{}}'.format(what, where) for what, where in looked]
        lines += ['Install the app (python3 tools/install_app.py, from a checkout of it), or point ${{}} at the folder'
                  .format(ENV), 'that holds tools/vault.py.']
        sys.stderr.write('\\n'.join(lines) + '\\n')
        return EXIT_NO_ENGINE
    # The vault is the one this shim belongs to, unless the caller said otherwise (-C wins over $TM_VAULT, which wins
    # over the folder it runs in): so it is right when it is called from somewhere else by its full path.
    os.environ.setdefault('TM_VAULT', VAULT)
    args = list(sys.argv[1:] if argv is None else argv)
    python = sys.executable or 'python3'
    try:
        os.execv(python, [python, cli] + args)  # the engine's own exit code, stdout and stderr, nothing in between
    except OSError as e:
        sys.stderr.write('vault.py: cannot run {{}}: {{}}\\n'.format(cli, e))
        return EXIT_NO_ENGINE


if __name__ == '__main__':
    sys.exit(main())
'''.format(rel=REL, meta=META_DIR, env=ENV, app_rel=APP_REL, ios_glob=IOS_GLOB, exit_code=EXIT_NO_ENGINE)


def write(root):
    """Put the shim in the vault `root` (made if its folder is missing). Nothing when it is already this text, so
    turning the guide on again, or any refresh, costs no write. → whether it wrote.

    A link in its place is replaced, never written through: atomic_write resolves the path first, so writing (or
    chmod) would land on whatever it points at, outside the vault. The vault's own AGENTS.md is refused for the same
    reason (Store._guide_path); here it is replaced instead of refused, because .task-manager/ is the app's own folder
    and a link in it is not the owner's configuration — and because the guide names this file as the CLI."""
    full = path(root)
    if os.path.islink(full):
        os.remove(full)  # the link itself, not its target
    else:
        try:
            with open(full, encoding='utf-8') as f:
                if f.read() == SOURCE:
                    return False
        except OSError:
            pass
    os.makedirs(os.path.dirname(full), exist_ok=True)
    atomic_write(full, SOURCE)
    os.chmod(full, 0o755)
    return True


def remove(root):
    """Take the shim away (the guide turned off). → whether there was one."""
    try:
        os.remove(path(root))
        return True
    except OSError:
        return False
