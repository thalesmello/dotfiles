# herdr-specific fish configuration.
# Sourced from config.fish only when running inside a herdr session
# (detected via the HERDR_ENV environment variable).

# ---------------------------------------------------------------------------
# Auto-name the current workspace from the working directory on `cd`.
#
# Rules:
#   * Only the workspace's *root pane* renames the workspace, so cd-ing around
#     in split panes or extra tabs never fights over the name. By default the
#     root pane is the first pane of the workspace's lowest-numbered tab.
#   * Automatic naming applies only to a brand-new workspace, i.e. one that
#     still carries herdr's default label at shell startup. A workspace that
#     was already named when the shell started is left alone.
#   * Renaming the workspace yourself is a one-way trip: automatic naming
#     stops for the rest of the session and never resumes (not even if you
#     later clear the name).
#   * `fish_herdr_elect_root_panel` overrides all of the above: it makes the
#     current pane the workspace root and resumes automatic naming from it,
#     discarding any prior manual override. The election is recorded on the
#     workspace (via a herdr metadata token) so every other pane immediately
#     defers to the newly elected pane.
# ---------------------------------------------------------------------------

# Transform a directory path into the desired workspace label.
# Strips a leading ISO date prefix, e.g. 2026-08-03-es-monitoring-proposal
# becomes es-monitoring-proposal. Tweak this function to change the naming.
function __herdr_workspace_label --argument-names dir
    string replace -r '^\d{4}-\d{2}-\d{2}-' '' -- (path basename -- "$dir")
end

# Print the id of the *natural* root pane for a workspace: the first pane of
# its lowest-numbered tab. Prints nothing if it cannot be determined.
function __herdr_natural_root_pane_id --argument-names workspace
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

# Print two tab-separated fields for a workspace: its current label and its
# elected-root pane id (the herdr_autoroot metadata token, empty if none).
# Exits non-zero with no output if the workspace cannot be queried, so callers
# can distinguish a genuinely empty label from a failed query.
function __herdr_workspace_state --argument-names workspace
    command -q python3; or return 1
    herdr workspace get "$workspace" 2>/dev/null | python3 -c '
import sys, json
try:
    ws = json.load(sys.stdin)["result"]["workspace"]
except Exception:
    sys.exit(1)
label = ws.get("label", "") or ""
elected = (ws.get("tokens") or {}).get("herdr_autoroot", "") or ""
print(label + "\t" + elected)
'
end

# True when the current pane should drive naming for its workspace.
# An explicit election (elected pane id, passed in) wins; otherwise the
# natural root is used and cached per shell to keep `cd` fast.
function __herdr_pane_is_root --argument-names elected
    if test -n "$elected"
        test "$HERDR_PANE_ID" = "$elected"
        return
    end
    if not set -q __herdr_natural_root
        set -g __herdr_natural_root (__herdr_natural_root_pane_id "$HERDR_WORKSPACE_ID")
    end
    test "$HERDR_PANE_ID" = "$__herdr_natural_root"
end

# Rename the current workspace to match $PWD. Fires on every directory change,
# but only acts from the interactive root/elected pane while in automatic mode.
function __herdr_rename_workspace_on_cd --on-variable PWD
    status is-interactive; or return
    set -q HERDR_WORKSPACE_ID; and set -q HERDR_PANE_ID; or return

    # One query gives us both the live label and the elected-root pane.
    set -l state (__herdr_workspace_state "$HERDR_WORKSPACE_ID")
    test (count $state) -gt 0; or return
    set -l fields (string split \t -- $state[1])
    set -l cur $fields[1]
    set -l elected $fields[2]

    __herdr_pane_is_root "$elected"; or return

    # Decide once, at session start, whether this workspace is eligible for
    # automatic naming. An explicit election of this pane always counts as
    # eligible; otherwise only a brand-new workspace — one still carrying
    # herdr's default label (empty, or the cwd basename) — qualifies.
    if not set -q __herdr_naming_mode
        if test "$elected" = "$HERDR_PANE_ID"
            set -g __herdr_naming_mode auto
        else if test -z "$cur" -o "$cur" = (path basename -- "$PWD")
            set -g __herdr_naming_mode auto
        else
            set -g __herdr_naming_mode manual
        end
    end

    # A manual rename is a one-way trip: once you rename the workspace yourself,
    # automatic naming stops for the rest of the session and never resumes.
    # (Re-electing this pane clears this by resetting the state variables.)
    if test "$__herdr_naming_mode" = auto -a -n "$cur" \
            -a -n "$__herdr_auto_label" -a "$cur" != "$__herdr_auto_label"
        set -g __herdr_naming_mode manual
    end

    test "$__herdr_naming_mode" = auto; or return

    set -l label (__herdr_workspace_label "$PWD")
    test -n "$label"; or return
    set -g __herdr_auto_label "$label"
    if test "$label" != "$cur"
        herdr workspace rename "$HERDR_WORKSPACE_ID" "$label" >/dev/null 2>&1
    end
end

# Make the current pane the workspace's root pane and resume automatic naming
# from it, discarding any previous manual override. Records the election on the
# workspace so other panes defer to this one.
function fish_herdr_elect_root_panel
    if not set -q HERDR_WORKSPACE_ID; or not set -q HERDR_PANE_ID
        echo "fish_herdr_elect_root_panel: not inside a herdr workspace" >&2
        return 1
    end

    # Record the election on the workspace (authoritative, seen by every pane).
    herdr workspace report-metadata "$HERDR_WORKSPACE_ID" \
        --source herdr-fish --token herdr_autoroot="$HERDR_PANE_ID" >/dev/null 2>&1

    # Reset this shell's naming state so auto-naming takes over from here.
    set -g __herdr_naming_mode auto
    set -e __herdr_auto_label
    set -e __herdr_natural_root

    # Apply the current directory's name right away.
    __herdr_rename_workspace_on_cd
    echo "herdr: pane $HERDR_PANE_ID is now the root pane for workspace $HERDR_WORKSPACE_ID"
end

# Set the initial name once for the root pane's starting directory.
if status is-interactive
    __herdr_rename_workspace_on_cd
end
