#!/bin/sh
# open-popup.sh <plugin> <entrypoint> [width] [height] [KEY=VALUE ...]
#
# What the config's named-popup keybindings run (type = "shell"): opens a
# plugin popup pane, whose border carries the manifest's descriptive title
# instead of the generic "popup" a [[keys.command]] type = "popup" gets.
#
# Forwards the HERDR_ACTIVE_* variables herdr injected into this command's
# environment: several popup scripts act on the pane/tab/workspace that was
# focused when the key fired and read it from exactly those names. Extra
# KEY=VALUE args are passed through as popup env (snooze's list screen).

plugin=$1
entrypoint=$2
width=${3:-}
height=${4:-}
if [ $# -ge 4 ]; then shift 4; else shift $#; fi
# Remaining args are env pairs. Save them now: the command is built with
# set -- below, which replaces $@.
extra_pairs=$*

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$script_dir/herdr-lib.sh"

herdr=$(herdr_bin) || herdr_die "popup" "herdr CLI not found"

case "$herdr" in
    *hc-preset)
        "$herdr" popup-open "$plugin" "$entrypoint" "${width:-}" "${height:-}" $extra_pairs >/dev/null 2>&1 \
            || herdr_die "popup" "couldn't open $plugin/$entrypoint"
        exit 0
        ;;
esac

set -- "$herdr" plugin pane open \
    --plugin "$plugin" --entrypoint "$entrypoint" \
    --placement popup --focus
[ -n "$width" ] && set -- "$@" --width "$width"
[ -n "$height" ] && set -- "$@" --height "$height"
for name in HERDR_ACTIVE_PANE_ID HERDR_ACTIVE_TAB_ID HERDR_ACTIVE_WORKSPACE_ID; do
    eval "value=\${$name:-}"
    [ -n "$value" ] && set -- "$@" --env "$name=$value"
done
for pair in $extra_pairs; do
    set -- "$@" --env "$pair"
done

"$@" >/dev/null 2>&1 || herdr_die "popup" "couldn't open $plugin/$entrypoint (is another popup open?)"
