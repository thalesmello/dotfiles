#!/bin/sh
# Even out every split in the focused tab (prefix+=), tmux's
# `select-layout even-horizontal/even-vertical` for an arbitrary split tree.
#
# herdr has no "balance panes" action or CLI command: `pane resize` only nudges
# one divider by a relative amount, and the layout tree it would have to be
# aimed at is not exposed there either. Both halves of the job live on the API
# socket instead -- layout.export returns the split tree, layout.set_split_ratio
# moves one divider to an absolute ratio -- so this talks to the socket
# directly (see herdr_request in herdr-lib.sh).
#
# Evening out a tree is not one ratio: every split gets
#
#   ratio = leaves(first child) / leaves(whole split)
#
# which is what makes each pane end up the same size along its parent's axis
# regardless of how lopsided the tree is. A pane split off a pane that was
# itself split gets 1/3, not 1/2.
#
# A split node's address is `path`, a list of booleans read from the root:
# false descends into `first`, true into `second`, and [] is the root split
# itself. One request per divider, and one connection per request -- herdr
# answers only the first request written to a connection.

. "$(dirname "$0")/herdr-lib.sh"

pane="${HERDR_ACTIVE_PANE_ID:-${HERDR_PANE_ID:-${HC_TERMINAL_ID:-}}}"
if [ -z "$pane" ]; then
    herdr=$(herdr_bin) || herdr_die "Even layout" "herdr CLI not found"
    pane=$("$herdr" pane current 2>/dev/null | jq -r '(.result // .).pane.pane_id // empty')
fi
[ -n "$pane" ] || herdr_die "Even layout" "no focused pane"

herdr=$(herdr_bin) || herdr_die "Even layout" "adapter not found"
if [ "$("$herdr" backend 2>/dev/null)" = hc ]; then
    "$herdr" even-layout "$pane" || herdr_die "Even layout" "could not balance the selected tab"
    exit 0
fi

layout=$(herdr_request layout.export "$(printf '{"pane_id":"%s"}' "$pane")")
[ -n "$layout" ] || herdr_die "Even layout" "layout.export returned nothing"

# One `{"path":[...],"ratio":n}` per split, deepest-last order is irrelevant:
# ratios are relative to their own split, so they can be applied in any order.
requests=$(printf '%s' "$layout" | jq -c --arg pane "$pane" '
  def leaves: if .type == "split" then (.first | leaves) + (.second | leaves) else 1 end;
  def splits($path):
    if .type == "split" then
      {path: $path, ratio: ((.first | leaves) / leaves)},
      (.first | splits($path + [false])),
      (.second | splits($path + [true]))
    else empty end;
  (.result // .).layout.root
  | splits([])
  | {pane_id: $pane, path: .path, ratio: .ratio}
' 2>/dev/null)

[ -n "$requests" ] || exit 0   # single pane: nothing to do

printf '%s\n' "$requests" | while IFS= read -r params; do
    herdr_request layout.set_split_ratio "$params" >/dev/null || exit 1
done
