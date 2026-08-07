#!/bin/sh
# Shared helpers for the herdr keys.command scripts. POSIX sh, meant to be
# sourced:
#
#   . "$(dirname "$0")/herdr-lib.sh"
#
# herdr_bin -- print the herdr CLI to use, or fail.
#
#   A `type = "shell"` binding runs DETACHED from the herdr server, inheriting
#   the server's environment rather than a login shell's, so a bare `herdr` is
#   only resolvable if the server itself was started with ~/.local/bin on PATH.
#   herdr injects HERDR_BIN_PATH into keys.command environments, but only when
#   it knows its own path -- it is absent often enough that it can't be the only
#   source. So: HERDR_BIN_PATH, then PATH, then the usual install locations.
#
#   Scripts that hand work to a new pane should also pass the resolved path down
#   (`pane split --env HERDR_BIN_PATH=...`): a pane shell does not inherit the
#   launcher's environment, and may not have herdr on PATH either.
#
# herdr_die -- report a fatal error as a herdr notification, then exit 1.
#
#   Neither a detached command nor an exec'd pane that closes on exit has
#   anywhere to show a message: stderr goes to the server log at best, and a
#   pane printing an error disappears in the same instant. The notification is
#   what actually reaches the screen.

herdr_bin() {
    if [ -n "$HERDR_BIN_PATH" ] && [ -x "$HERDR_BIN_PATH" ]; then
        printf '%s\n' "$HERDR_BIN_PATH"
        return 0
    fi

    _resolved=$(command -v herdr 2>/dev/null)
    if [ -n "$_resolved" ]; then
        printf '%s\n' "$_resolved"
        return 0
    fi

    for _candidate in "$HOME/.local/bin/herdr" /opt/homebrew/bin/herdr /usr/local/bin/herdr; do
        if [ -x "$_candidate" ]; then
            printf '%s\n' "$_candidate"
            return 0
        fi
    done

    return 1
}

# herdr_die <title> <body>...
herdr_die() {
    _title=$1
    shift
    _body=$*

    _bin=$(herdr_bin) \
        && "$_bin" notification show "$_title" --body "$_body" --sound request \
            >/dev/null 2>&1

    printf '%s: %s\n' "$_title" "$_body" >&2
    exit 1
}
