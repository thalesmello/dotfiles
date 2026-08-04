# herdr-specific fish configuration.
# Sourced from config.fish only when running inside a herdr session
# (detected via the HERDR_ENV environment variable).

# ---------------------------------------------------------------------------
# Auto-name the current workspace from the working directory on `cd`.
#
# Only the workspace's *root pane* is allowed to rename the workspace, so
# cd-ing around in split panes or extra tabs never fights over the name.
# The root pane is defined as the first pane of the workspace's first
# (lowest-numbered) tab. That fact is computed once per shell and cached.
# ---------------------------------------------------------------------------

# Transform a directory path into the desired workspace label.
# Strips a leading ISO date prefix, e.g. 2026-08-03-es-monitoring-proposal
# becomes es-monitoring-proposal. Tweak this function to change the naming.
function __herdr_workspace_label --argument-names dir
    string replace -r '^\d{4}-\d{2}-\d{2}-' '' -- (path basename -- "$dir")
end

# Print the id of the root pane for a workspace: the first pane of its
# lowest-numbered tab. Prints nothing if it cannot be determined.
function __herdr_root_pane_id --argument-names workspace
    command -q python3; or return
    herdr api snapshot 2>/dev/null | python3 -c '
import sys, json
ws = sys.argv[1]
try:
    snap = json.load(sys.stdin)["result"]["snapshot"]
except Exception:
    sys.exit(0)
tabs = [t for t in snap.get("tabs", []) if t.get("workspace_id") == ws]
if not tabs:
    sys.exit(0)
root_tab = min(tabs, key=lambda t: t.get("number", 1 << 30))["tab_id"]
layout = next((l for l in snap.get("layouts", []) if l.get("tab_id") == root_tab), None)
panes = (layout or {}).get("panes") or []
if panes:
    print(panes[0]["pane_id"])
' "$workspace"
end

# True only when the current pane is its workspace's root pane. Result is
# cached in $__herdr_is_root_pane so `cd` stays fast after the first check.
function __herdr_is_root_pane
    if not set -q __herdr_is_root_pane
        set -g __herdr_is_root_pane 0
        if test "$HERDR_PANE_ID" = (__herdr_root_pane_id "$HERDR_WORKSPACE_ID")
            set -g __herdr_is_root_pane 1
        end
    end
    test "$__herdr_is_root_pane" = 1
end

# Rename the current workspace to match $PWD. Fires on every directory
# change, but only acts from the interactive root-pane shell.
function __herdr_rename_workspace_on_cd --on-variable PWD
    status is-interactive; or return
    set -q HERDR_WORKSPACE_ID; and set -q HERDR_PANE_ID; or return
    __herdr_is_root_pane; or return

    set -l label (__herdr_workspace_label "$PWD")
    test -n "$label"; or return
    test "$label" = "$__herdr_last_workspace_label"; and return

    set -g __herdr_last_workspace_label "$label"
    herdr workspace rename "$HERDR_WORKSPACE_ID" "$label" >/dev/null 2>&1
end

# Set the initial name once for the root pane's starting directory.
if status is-interactive
    __herdr_rename_workspace_on_cd
end
