#!/bin/sh
# Copy the previous command's output to the clipboard.
#
# Uses herdr's native clipboard forwarding instead of pbcopy so it works whether
# the herdr server is local or remote (herdr --remote <ssh-target>). herdr
# intercepts OSC 52 clipboard escape sequences that pass through a pane it
# renders and forwards the payload to the ATTACHED CLIENT's machine -- i.e. your
# local clipboard. pbcopy, by contrast, runs on whatever host the herdr *server*
# lives on, so on a remote server it copies into the remote machine's clipboard,
# which is useless. herdr exposes no clipboard-write command over its socket API,
# so OSC 52 is the only script-reachable entry into that native clipboard path.
#
# IMPORTANT: the OSC 52 bytes are only intercepted when they flow through a
# herdr-RENDERED PTY, so the matching keybinding in config.toml runs this as a
# `type = "popup"` command (a rendered terminal), NOT a detached `type = "shell"`
# command whose stdout goes nowhere herdr parses.
#
# Only acts when the focused pane is running fish. Uses the prompt marker that
# theme-cmorrell.com's fish_prompt prints on every prompt line: the nerd-font
# glyph U+E007 (UTF-8 bytes ef 80 87), emitted by `show_user`'s first
# `prompt_segment`. The previous command's output is everything between the two
# most recent prompt markers (the marker line itself holds the prompt + typed
# command, so it is skipped).
#
# Pane identity comes from $HERDR_ACTIVE_PANE_ID, which herdr auto-injects into
# custom commands (along with HERDR_SOCKET_PATH and HERDR_BIN_PATH). Note it is
# NOT $HERDR_PANE_ID -- that only exists inside a pane's interactive shell and,
# for a popup command, would point at the popup itself rather than the pane that
# was focused when the keybinding fired.

herdr="${HERDR_BIN_PATH:-herdr}"

pane="${HERDR_ACTIVE_PANE_ID}"
[ -n "$pane" ] || exit 1

# Gate: only act when fish is the foreground program in this pane.
"$herdr" pane process-info --pane "$pane" 2>/dev/null | grep -qw fish || exit 0

# Prompt marker glyph U+E007, given as octal bytes so the raw glyph never has to
# survive an editor/transport that might strip Private-Use characters.
marker=$(printf '\357\200\207')

output=$("$herdr" pane read "$pane" --source recent --lines 2000 2>/dev/null | awk -v m="$marker" '
  { line[NR] = $0; if (index($0, m)) mark[++n] = NR }
  END {
    if (n < 2) exit 1                       # need a previous prompt and the current one
    for (i = mark[n-1] + 1; i <= mark[n] - 1; i++) print line[i]
  }
') || exit 0

# Route through herdr via OSC 52. base64 is stripped of newlines so the payload
# is one continuous token (some terminals reject a wrapped payload). The BEL
# (\007) terminates the sequence; herdr parses it off the popup PTY before the
# command exits and forwards it to the client's clipboard.
b64=$(printf '%s' "$output" | base64 | tr -d '\r\n')
printf '\033]52;c;%s\007' "$b64"
