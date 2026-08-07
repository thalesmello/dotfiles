#!/bin/sh
# Open the live Herdr config for editing (prefix+shift+e).
#
# Bound as a `type = "shell"` command in config.toml. A full-screen popup would
# swallow the prefix key while the editor runs, so instead this opens a real
# vertical split, zooms it, and runs the editor there. The pane is exec'd, so
# quitting the editor closes the pane (and drops the zoom) automatically.
#
# Re-invokes itself with --edit inside the new pane; that branch runs the editor
# and reloads the config when it exits.
#
# Failures are reported as herdr notifications: a detached command has no
# terminal, so stderr goes nowhere visible. See herdr-lib.sh, which also
# explains why the herdr CLI is resolved rather than assumed on PATH, and why
# the resolved path is passed into the split.

. "$(dirname "$0")/herdr-lib.sh"

herdr=$(herdr_bin) || herdr_die "edit-config" \
    "herdr CLI not found (HERDR_BIN_PATH unset and no herdr on PATH)"

config="${XDG_CONFIG_HOME:-$HOME/.config}/herdr/config.toml"

if [ "$1" = "--edit" ]; then
    "${EDITOR:-nvim}" "$config"
    "$herdr" server reload-config >/dev/null \
        || herdr_die "edit-config" "server reload-config failed"
    exit 0
fi

pane="${HERDR_ACTIVE_PANE_ID}"
[ -n "$pane" ] || herdr_die "edit-config" \
    "HERDR_ACTIVE_PANE_ID is unset -- no pane to split"

# Absolute path: `pane run` hands the command to the split's shell, which has
# its own cwd (and would re-expand a leading ~).
self=$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")

split_out=$("$herdr" pane split "$pane" --direction right --ratio 0.5 --focus \
    --env "HERDR_BIN_PATH=$herdr" 2>&1)
new=$(printf '%s' "$split_out" \
    | sed -n 's/.*"pane_id":"\([^"]*\)".*/\1/p' | head -1)
[ -n "$new" ] || herdr_die "edit-config" "pane split failed: $split_out"

"$herdr" pane zoom "$new" --on >/dev/null 2>&1

# exec so quitting the editor closes the pane instead of dropping back to fish.
run_out=$("$herdr" pane run "$new" exec "$self" --edit 2>&1)
case "$run_out" in
*'"error"'*)
    herdr_die "edit-config" "pane run failed: $run_out"
    ;;
esac
