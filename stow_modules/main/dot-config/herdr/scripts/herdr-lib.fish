#!/usr/bin/env fish
# Shared helpers for the fish keys.command scripts. Meant to be sourced:
#
#   source (status dirname)/herdr-lib.fish
#
# This is the fish counterpart of herdr-lib.sh (which the older .sh bindings
# source); the two are independent on purpose, so neither has to be written in
# the other's dialect.

# herdr_bin -- print the herdr CLI to use, or fail.
#
#   A `type = "shell"` binding runs DETACHED from the herdr server, inheriting
#   the server's environment rather than a login shell's, so a bare `herdr` is
#   only resolvable if the server itself was started with ~/.local/bin on PATH.
#   herdr injects HERDR_BIN_PATH into keys.command environments, but only when
#   it knows its own path -- it is absent often enough that it can't be the only
#   source. So: HERDR_BIN_PATH, then PATH, then the usual install locations.
function herdr_bin
    if set -q HERDR_BIN_PATH; and test -x "$HERDR_BIN_PATH"
        echo $HERDR_BIN_PATH
        return 0
    end

    set -l resolved (command -v herdr)
    if test -n "$resolved"
        echo $resolved
        return 0
    end

    for candidate in $HOME/.local/bin/herdr /opt/homebrew/bin/herdr /usr/local/bin/herdr
        if test -x $candidate
            echo $candidate
            return 0
        end
    end

    return 1
end

# herdr_socket -- print the API socket path, or fail.
#
#   Needed for the requests the CLI does not expose (pane.focus by id,
#   events.subscribe). Same reasoning as herdr_bin: the injected env var first,
#   then the default location.
function herdr_socket
    if set -q HERDR_SOCKET_PATH; and test -S "$HERDR_SOCKET_PATH"
        echo $HERDR_SOCKET_PATH
        return 0
    end

    for candidate in $HOME/.config/herdr/herdr.sock $HOME/.local/state/herdr/herdr.sock
        if test -S $candidate
            echo $candidate
            return 0
        end
    end

    return 1
end

# herdr_request <method> <json-params> -- one-shot API call, prints the response.
function herdr_request --argument-names method params
    set -l sock (herdr_socket); or return 1
    printf '{"id":"fish","method":"%s","params":%s}\n' $method $params | nc -U $sock
end

# herdr_notify <title> [body] -- best-effort toast; never fatal.
#
#   A detached `type = "shell"` command has no terminal, so stderr only reaches
#   the server log. The notification is what actually reaches the screen.
function herdr_notify --argument-names title body
    set -l bin (herdr_bin); or return 0
    if test -n "$body"
        $bin notification show $title --body $body --position top-right --sound none >/dev/null 2>&1
    else
        $bin notification show $title --position top-right --sound none >/dev/null 2>&1
    end
    return 0
end

# herdr_current_pane -- print the focused pane id, or fail.
#
#   herdr injects HERDR_ACTIVE_PANE_ID into every keys.command environment, so
#   the common path needs no CLI call at all.
function herdr_current_pane
    if set -q HERDR_ACTIVE_PANE_ID; and test -n "$HERDR_ACTIVE_PANE_ID"
        echo $HERDR_ACTIVE_PANE_ID
        return 0
    end

    # Fallback asks which pane is focused, not `pane current`: that one reports
    # the pane the command was launched from, which is only the same thing when
    # the caller happens to be running inside the focused pane.
    set -l bin (herdr_bin); or return 1
    set -l pane ($bin pane list 2>/dev/null |
        jq -r 'first((.result // .).panes[] | select(.focused) | .pane_id) // empty')
    test -n "$pane"; or return 1
    echo $pane
end

# herdr_focus_pane <pane_id> -- focus any pane, switching workspace and tab.
#
#   `herdr agent focus` does the same thing but refuses panes it does not know
#   as agents ("agent target ... not found"), and focus history is full of plain
#   shells. The pane.focus API call has no such restriction.
function herdr_focus_pane --argument-names pane
    herdr_request pane.focus (printf '{"pane_id":"%s"}' $pane) >/dev/null 2>&1
end

# herdr_focus_history_dir -- print (and create) the focus-history state dir.
function herdr_focus_history_dir
    set -l base $HOME/.local/state
    if set -q XDG_STATE_HOME; and test -n "$XDG_STATE_HOME"
        set base $XDG_STATE_HOME
    end
    set -l dir $base/herdr/focus-history
    mkdir -p $dir 2>/dev/null
    echo $dir
end

# herdr_focus_history_running -- true when the focus-history daemon is alive.
function herdr_focus_history_running
    set -l dir (herdr_focus_history_dir)
    set -l pid (cat $dir/daemon.lock/pid 2>/dev/null)
    test -n "$pid"; or return 1
    kill -0 $pid 2>/dev/null; or return 1
    # Guard against pid reuse: the pid must still be our daemon.
    ps -p $pid -o command= 2>/dev/null | string match -q '*focus-history-daemon*'
end

# herdr_ensure_focus_history -- start the focus-history daemon if it is not up.
#
#   Both focus bindings call this, so the history starts recording the first
#   time either key is pressed rather than needing a separate autostart.
function herdr_ensure_focus_history
    herdr_focus_history_running; and return 0

    set -l daemon (status dirname)/focus-history-daemon.fish
    test -x $daemon; or return 1

    # Detached: the keybinding process exits immediately, the daemon keeps
    # running under init. Its own lock decides whether it survives, so a race
    # between two presses is harmless.
    fish -c "$daemon >/dev/null 2>&1 &" >/dev/null 2>&1
    return 0
end
