#!/usr/bin/env python3
"""Resize herdr's sidebar from the keyboard.

  sidebar-resize.py +2      prefix++   (wider)
  sidebar-resize.py -2      prefix+_   (narrower)
  sidebar-resize.py 36                 (absolute)

Ported from herdr-agent-inbox's actions.py (github.com/douglascorrea/
herdr-agent-inbox, MIT); nothing here is inbox-specific, it is just the piece
of herdr's UI that has no keybinding of its own.

Why it is this convoluted: herdr's live sidebar width is SESSION state (mouse
drags on the divider land there), and config's `ui.sidebar_width` only wins
when config owns it -- but the `sidebar_min_width`/`sidebar_max_width` clamps
re-apply to the live width on every reload-config. So a resize is two writes:

  1. pin width = min = max = target, reload  -- the clamp drags the live width;
  2. relax the bounds back to [DRAG_MIN, DRAG_MAX], reload -- so herdr's own
     mouse drag keeps somewhere to move.

Step 2 must happen even when step 1 fails, or the sidebar is left frozen at one
width. config.toml is rewritten through os.path.realpath (this config is a stow
symlink -- replacing it with a regular file would silently unlink it from the
dotfiles), tmp + os.replace, mode preserved, under a flock so a held-down key
cannot interleave two read-modify-writes.
"""

import fcntl
import json
import os
import re
import subprocess
import sys

SIDEBAR_FLOOR = 10
SIDEBAR_CEIL = 80
# Bounds left in config afterwards, so herdr's native mouse drag keeps a useful
# range. These are the values this config already carries.
DRAG_MIN = 18
DRAG_MAX = 60


def config_path():
    p = os.environ.get("HERDR_CONFIG_PATH") or os.path.expanduser(
        "~/.config/herdr/config.toml"
    )
    return os.path.realpath(p)


def herdr_bin():
    return os.environ.get("HERDR_BIN_PATH") or "herdr"


def lock_dir():
    base = os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state")
    d = os.path.join(base, "herdr")
    os.makedirs(d, exist_ok=True)
    return d


def notify(title, body=None):
    argv = [herdr_bin(), "notification", "show", title, "--position", "top-right",
            "--sound", "none"]
    if body:
        argv += ["--body", body]
    subprocess.run(argv, check=False, capture_output=True)


def _live_width():
    """Best-known current width.

    session.json holds the live value (mouse drags land there) but herdr saves
    it lazily, while our own config writes are instant -- so trust whichever
    file is fresher.
    """
    sock = os.environ.get("HERDR_SOCKET_PATH") or os.path.expanduser(
        "~/.config/herdr/herdr.sock")
    sess = os.path.join(os.path.dirname(sock), "session.json")
    sess_w = cfg_w = None
    try:
        with open(sess) as f:
            w = json.load(f).get("sidebar_width")
        sess_w = int(w) if w else None
    except (OSError, ValueError, TypeError):
        pass
    try:
        with open(config_path()) as f:
            m = re.search(r"(?m)^\s*sidebar_width\s*=\s*(\d+)", f.read())
        cfg_w = int(m.group(1)) if m else None
    except OSError:
        pass
    if sess_w is not None and cfg_w is not None:
        try:
            newer_sess = os.path.getmtime(sess) > os.path.getmtime(config_path())
        except OSError:
            newer_sess = True
        return sess_w if newer_sess else cfg_w
    return sess_w if sess_w is not None else cfg_w


def _write_bounds(width, mn, mx):
    """Rewrite the three width lines and reload. Returns an error string or None.

    The keys must already exist and be uncommented in config.toml: this edits
    values in place rather than appending, so it can never end up with two
    definitions of the same key in different sections.
    """
    path = config_path()
    with open(path, "r") as f:
        text = f.read()

    matches = {}
    for key in ("sidebar_width", "sidebar_min_width", "sidebar_max_width"):
        m = re.search(r"(?m)^(\s*%s\s*=\s*)(\d+)" % key, text)
        if not m:
            return "missing %s in %s (uncomment it)" % (key, path)
        matches[key] = m
    values = {"sidebar_width": width, "sidebar_min_width": mn,
              "sidebar_max_width": mx}
    # Right-to-left, so earlier match offsets stay valid as the text shifts.
    for key, m in sorted(matches.items(), key=lambda kv: -kv[1].start(2)):
        text = text[: m.start(2)] + str(values[key]) + text[m.end(2):]

    tmp = path + ".sidebar-resize.tmp"
    mode = os.stat(path).st_mode & 0o7777
    with open(tmp, "w") as f:
        f.write(text)
    os.chmod(tmp, mode)
    os.replace(tmp, path)

    r = subprocess.run([herdr_bin(), "server", "reload-config"],
                       capture_output=True, text=True)
    try:
        diags = json.loads(r.stdout)["result"].get("diagnostics") or []
    except (ValueError, KeyError, TypeError, AttributeError):
        diags = ["reload-config failed: %s" % (r.stderr or r.stdout)]
    return "; ".join(diags) if diags else None


def resize(spec):
    lock = open(os.path.join(lock_dir(), "sidebar-resize.lock"), "a")
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        base = _live_width()
        if base is None:
            base = 26          # herdr's default when config says nothing
        new = base + int(spec) if spec[:1] in "+-" else int(spec)
        new = max(SIDEBAR_FLOOR, min(SIDEBAR_CEIL, new))

        err = _write_bounds(new, new, new)
        # Relax unconditionally: leaving min == max pinned would disable
        # herdr's own mouse drag on the divider.
        relax = _write_bounds(new, min(DRAG_MIN, new), max(DRAG_MAX, new))
        return new, (err or relax)
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


def main():
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        _, err = resize(sys.argv[1])
    except (OSError, ValueError) as e:
        _, err = None, str(e)
    if err:
        # A detached type = "shell" binding has no terminal; the toast is the
        # only place this can be seen.
        notify("sidebar resize failed", err)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
