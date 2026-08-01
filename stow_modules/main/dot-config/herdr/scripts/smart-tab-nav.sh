#!/bin/sh
# Smart tab navigation for prefix+ctrl+{n,p}.
#
# Walks every tab of every workspace as one flat, wrapping ring:
#   next: not the last tab of the workspace -> next tab in this workspace
#         last tab of the workspace         -> first tab of the next workspace
#   prev: mirror image (first tab -> last tab of the previous workspace)
#
# Workspace order comes from `workspace list`, tab order from `tab list`, so the
# ring matches the sidebar top-to-bottom order rather than raw id order.
# Set HERDR_SMARTNAV_DEBUG=1 to print the target tab instead of focusing it.

dir="${1:-next}"   # next | prev

herdr="${HERDR_BIN_PATH:-herdr}"

target=$(
  { "$herdr" workspace list 2>/dev/null; "$herdr" tab list 2>/dev/null; } | jq -rs --arg dir "$dir" '
    ((.[0].result // .[0]).workspaces // []) as $ws
    | ((.[1].result // .[1]).tabs // []) as $tabs
    # flatten to sidebar order: tabs grouped by workspace, workspaces in list order
    | [ $ws[] | .workspace_id as $w | $tabs[] | select(.workspace_id == $w) ] as $ring
    | ($ring | length) as $n
    | ($ring | map(.focused) | index(true)) as $i
    | if $i == null or $n == 0 then empty
      else ($ring[ ($i + (if $dir == "prev" then -1 else 1 end) + $n) % $n ]
            | "\(.workspace_id) \(.tab_id)")
      end
  ' 2>/dev/null
)

[ -n "$target" ] || exit 0

if [ "${HERDR_SMARTNAV_DEBUG:-}" = "1" ]; then
  printf 'dir=%s -> %s\n' "$dir" "$target"
  exit 0
fi

# Focus the owning workspace first so cross-workspace hops also move the sidebar.
"$herdr" workspace focus "${target% *}" >/dev/null 2>&1
"$herdr" tab focus "${target#* }" >/dev/null 2>&1
