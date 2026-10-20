"""The listening socket launchd hands a server it starts on demand (tools/install_app.py): its LaunchAgent declares a
`Sockets` entry named LISTENERS, launchd listens on that port itself while the app is off, and starts the server on the
first connection, passing the socket over. `launch_activate_socket(3)` is how a process takes it: libSystem's, reached
through ctypes (no dependency). Anywhere else (not macOS, not started by launchd) there is none, and the server binds
its port as always.
"""
import ctypes
import socket
import sys

LISTENERS = 'Listeners'


def activated_sockets(name=LISTENERS):
    """The sockets launchd passed under `name`, or [] when it passed none (or this is not macOS)."""
    if sys.platform != 'darwin':
        return []
    try:
        libc = ctypes.CDLL(None)
        fn = libc.launch_activate_socket
    except (OSError, AttributeError):
        return []
    fn.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.POINTER(ctypes.c_int)), ctypes.POINTER(ctypes.c_size_t)]
    fn.restype = ctypes.c_int
    fds = ctypes.POINTER(ctypes.c_int)()
    count = ctypes.c_size_t(0)
    if fn(name.encode(), ctypes.byref(fds), ctypes.byref(count)) != 0:
        return []  # ESRCH: not started by launchd; ENOENT: no such socket name
    out = [socket.socket(fileno=fds[i]) for i in range(count.value)]
    libc.free.argtypes = [ctypes.c_void_p]
    libc.free(fds)
    return out
