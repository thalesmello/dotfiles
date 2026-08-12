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
# herdr_socket -- print the API socket path, or fail.
#
#   Needed for the requests the CLI does not expose (layout.export,
#   layout.set_split_ratio). Same reasoning as herdr_bin: the injected env var
#   first, then the default locations. Mirrors herdr_socket in herdr-lib.fish.
#
# herdr_request <method> <json-params> -- one-shot API call, prints the response.
#
#   One request per connection: herdr answers the first request on a connection
#   and silently ignores anything written after it, so a caller with several
#   requests to make has to reconnect for each one.
#
# herdr_die -- report a fatal error as a herdr notification, then exit 1.
#
#   Neither a detached command nor an exec'd pane that closes on exit has
#   anywhere to show a message: stderr goes to the server log at best, and a
#   pane printing an error disappears in the same instant. The notification is
#   what actually reaches the screen.
#
#   Except when the message is too long to be one. A notification is a couple of
#   lines of banner; past HERDR_DIE_HOLD_CHARS (100) the interesting part -- the
#   tail of some CLI's complaint -- is exactly what gets cut off. So if the
#   caller has a terminal (a popup, which stays up only as long as the command
#   runs), a long message is printed there and held until a keypress instead.
#   /dev/tty rather than stdout: these scripts call herdr_die from inside
#   command substitutions, where stdout is a pipe.

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

herdr_socket() {
    if [ -n "$HERDR_SOCKET_PATH" ] && [ -S "$HERDR_SOCKET_PATH" ]; then
        printf '%s\n' "$HERDR_SOCKET_PATH"
        return 0
    fi

    for _candidate in "$HOME/.config/herdr/herdr.sock" \
        "$HOME/.local/state/herdr/herdr.sock"; do
        if [ -S "$_candidate" ]; then
            printf '%s\n' "$_candidate"
            return 0
        fi
    done

    return 1
}

herdr_request() {
    _sock=$(herdr_socket) || return 1
    printf '{"id":"sh","method":"%s","params":%s}\n' "$1" "$2" | nc -U "$_sock"
}

HERDR_DIE_HOLD_CHARS=${HERDR_DIE_HOLD_CHARS:-100}

# Show <message> on the controlling terminal and wait for one keypress.
# Returns 1 when there is no terminal to show it on.
herdr_hold_on_tty() {
    { : >/dev/tty; } 2>/dev/null || return 1

    printf '\n%s\n\n[press any key to close] ' "$1" >/dev/tty 2>/dev/null || return 1

    # sh has no `read -n1`: put the terminal in raw mode and take a single byte.
    _stty=$(stty -g </dev/tty 2>/dev/null)
    [ -n "$_stty" ] && stty -echo -icanon min 1 time 0 </dev/tty 2>/dev/null
    dd bs=1 count=1 </dev/tty >/dev/null 2>&1
    [ -n "$_stty" ] && stty "$_stty" </dev/tty 2>/dev/null

    printf '\n' >/dev/tty 2>/dev/null
    return 0
}

# herdr_die <title> <body>...
herdr_die() {
    _title=$1
    shift
    _body=$*

    if [ "${#_body}" -gt "$HERDR_DIE_HOLD_CHARS" ] \
        && herdr_hold_on_tty "$_title: $_body"; then
        printf '%s: %s\n' "$_title" "$_body" >&2
        exit 1
    fi

    _bin=$(herdr_bin) \
        && "$_bin" notification show "$_title" --body "$_body" --sound request \
            >/dev/null 2>&1

    printf '%s: %s\n' "$_title" "$_body" >&2
    exit 1
}
