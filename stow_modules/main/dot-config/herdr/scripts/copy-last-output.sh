#!/bin/sh
# Copy the previous command's output to the clipboard.
#
# Only runs when the focused pane is running fish. Uses the prompt marker that
# theme-cmorrell.com's fish_prompt prints on every prompt line: the nerd-font
# glyph U+E007 (UTF-8 bytes ef 80 87), emitted by `show_user`'s first
# `prompt_segment`. The previous command's output is everything between the two
# most recent prompt markers (the marker line itself holds the prompt + typed
# command, so it is skipped).

pane="${HERDR_PANE_ID}"
[ -n "$pane" ] || exit 1

# Gate: only act when fish is the foreground program in this pane.
herdr pane process-info --pane "$pane" 2>/dev/null | grep -qw fish || exit 0

# Prompt marker glyph U+E007, given as octal bytes so the raw glyph never has to
# survive an editor/transport that might strip Private-Use characters.
marker=$(printf '\357\200\207')

herdr pane read "$pane" --source recent --lines 2000 2>/dev/null | awk -v m="$marker" '
  { line[NR] = $0; if (index($0, m)) mark[++n] = NR }
  END {
    if (n < 2) exit 1                       # need a previous prompt and the current one
    for (i = mark[n-1] + 1; i <= mark[n] - 1; i++) print line[i]
  }
' | pbcopy
