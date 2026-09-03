#!/usr/bin/env bash
# prefix+a: "ask" -- one question, one throwaway workspace directory, one agent
# session started on it.
#
#   1. prompt for the question in this popup (prompt-lib.sh)
#   2. pick the agent: the first of the words claude / pi / codex that appears
#      in the question, defaulting to claude
#   3. name the try: `pi -p` on a cheap OpenAI model TITLES the work the
#      session is about (see SLUG_MODEL), and that title is slugified -- a
#      title, not a slug of the question, because slugifying the question
#      verbatim gives names like why-are-people-in-https-chat-google-com-u-0
#      where the point was github-access-investigation. The question's own
#      words are only the fallback when the model gives nothing.
#   4. make the directory: `try new --print-path <slug>` -- today's date plus
#      the slug, under ~/src/tries
#   5. put it on screen: a new tab named after the slug in the "qq" workspace,
#      cwd'd into that directory (the workspace is created if this is the first
#      ask), running the agent with the question as its opening prompt, so the
#      answer is already coming in when the tab appears and the session is live
#      to keep talking to.
#
# Bound as a `type = "popup"` command so the prompt runs in a herdr-rendered PTY
# where interactive input works -- a detached `type = "shell"` command has no
# terminal. Esc (or an empty question) cancels and creates nothing.
#
# PRIVACY: step 3 sends the question to the slug model. Nothing else leaves the
# machine except what the agent you picked would send anyway.

set -u

here=$(cd "$(dirname "$0")" && pwd)
. "$here/herdr-lib.sh"
. "$here/prompt-lib.sh"

# A popup inherits the herdr SERVER's environment, not a login shell's, so the
# tools this script calls are not necessarily on PATH (same reasoning as
# herdr_bin in herdr-lib.sh). The agents themselves are launched by `pane run`
# in a pane's login shell, which does have a real PATH -- this is only for the
# CLIs *this* script runs: pi (slug) and try (directory).
PATH="$HOME/.local/bin:$HOME/src/dotfiles/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH

# Cheap and fast: the same model and CLI the agent-inbox daemon uses to title
# threads. `pi -p` starts fastest here, and the slug is not worth a frontier
# model.
SLUG_PROVIDER=openai
SLUG_MODEL=gpt-4.1-mini
SLUG_INSTRUCTION='Give a short title naming the WORK a coding-agent session
started from the prompt below is about -- the subject and the kind of work, not
a restatement of the question. 2-5 words. Drop URLs, quotes, file paths, and
question words. The prompt may start by naming the agent to route to (claude,
pi, codex) -- that is addressing, not subject matter, so never put it in the
title: "pi: what day is it" is "Current date", not "Pi current date".
Example: for "why are people in https://chat.google.com/u/0/app unable to see
my repo" a good title is "GitHub access investigation". Output only the title,
in plain words, with no punctuation.'

WORKSPACE_LABEL=qq

herdr=$(herdr_bin) || herdr_die 'ask' 'herdr CLI not found'

# --- 1. the question -------------------------------------------------------

prompt_line 'Ask: ' || exit 0
question=$PROMPT_LINE
[ -n "${question// /}" ] || exit 0

# --- 2. the agent ----------------------------------------------------------

# Word-wise, first match wins: "ask codex to explain pi" is a codex question.
# tr splits on anything that is not a letter or digit, so "codex," and "(pi)"
# still count, but "pineapple" and "claudette" do not.
agent=$(printf '%s\n' "$question" \
  | tr '[:upper:]' '[:lower:]' \
  | tr -cs 'a-z0-9' '\n' \
  | awk '/^(claude|pi|codex)$/ { print; exit }')
[ -n "$agent" ] || agent=claude

# --- 3. the name -----------------------------------------------------------

# Anything -> a safe slug: lowercase, [a-z0-9-] only, no runs of dashes, no
# leading/trailing dash, at most 48 chars (a tab label, and a directory name).
slugify() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | tr -c 'a-z0-9' '-' \
    | sed -e 's/--*/-/g' -e 's/^-//' -e 's/-$//' \
    | cut -c1-48 \
    | sed -e 's/-$//'
}

printf 'naming (%s)...' "$SLUG_MODEL"

# The LAST non-empty line, not the first: CLIs print banners (`pi` announces its
# gateway on startup) and the answer is what comes last.
title=$(pi -p --provider "$SLUG_PROVIDER" --model "$SLUG_MODEL" \
  "$SLUG_INSTRUCTION" "$question" 2>/dev/null \
  | awk 'NF { last = $0 } END { print last }')

slug=$(slugify "$title")
# No model, no network, no answer: the question's own first words are a worse
# name (this is the verbatim-question case the title exists to avoid) but never
# a missing one.
[ -n "$slug" ] || slug=$(slugify "$question")

# "pi: what day is it" is a question about the day, not about pi: the agent name
# is how the question was addressed (step 2 already consumed it), so it is not
# part of what this try is called. The instruction above asks the model for the
# same thing, but this also covers the fallback slug, which is the question
# verbatim and so always carries the prefix.
# Leading only: a trailing "-pi" is usually a real word of the title
# ("debug-with-pi"), while a leading one is the address.
stripped=$(printf '%s' "$slug" | sed -E 's/^(claude|pi|codex)-//')
# ...unless that was the whole name ("ask pi about pi"), in which case the agent
# name is all there is to go on.
[ -n "$stripped" ] && slug=$stripped

[ -n "$slug" ] || slug=ask

printf ' %s\n' "$slug"

# --- 4. the directory ------------------------------------------------------

# `--print-path` creates the dated directory and prints it, instead of the
# mkdir+cd script `try` normally emits: the cd has to happen in the new pane,
# not in this popup. See cmd_new! in dotfiles/bin/try.
dir=$(try new --print-path "$slug" 2>&1) \
  || herdr_die 'ask' "try new failed: $dir"
[ -d "$dir" ] || herdr_die 'ask' "try new produced no directory: $dir"

# --- 5. the tab ------------------------------------------------------------

# id out of a herdr CLI response, e.g. json_field pane_id / tab_id. The
# responses here nest the ids (tab_created has root_pane.pane_id), so this walks
# the whole object and takes the first match, the way the other scripts' seds
# do -- but without tripping over the second occurrence in a different object.
json_field() {
  python3 -c '
import json, sys

want = sys.argv[1]

def walk(node):
    if isinstance(node, dict):
        if isinstance(node.get(want), str):
            return node[want]
        for value in node.values():
            found = walk(value)
            if found:
                return found
    elif isinstance(node, list):
        for value in node:
            found = walk(value)
            if found:
                return found
    return None

try:
    print(walk(json.load(sys.stdin)["result"]) or "")
except Exception:
    print("")
' "$1"
}

workspace=$("$herdr" workspace list 2>/dev/null | python3 -c '
import json, sys

label = sys.argv[1]
try:
    workspaces = json.load(sys.stdin)["result"]["workspaces"]
except Exception:
    workspaces = []
print(next((w["workspace_id"] for w in workspaces if w.get("label") == label), ""))
' "$WORKSPACE_LABEL")

if [ -n "$workspace" ]; then
  pane=$("$herdr" tab create --workspace "$workspace" --cwd "$dir" \
    --label "$slug" --focus | json_field pane_id)
else
  # First ask of the session: the workspace comes with a tab and a pane already,
  # so use those rather than creating a second tab in it. Its tab is named "1"
  # until renamed.
  created=$("$herdr" workspace create --label "$WORKSPACE_LABEL" --cwd "$dir" --focus)
  pane=$(printf '%s' "$created" | json_field pane_id)
  tab=$(printf '%s' "$created" | json_field tab_id)
  [ -n "$tab" ] && "$herdr" tab rename "$tab" "$slug" >/dev/null 2>&1
fi

[ -n "$pane" ] || herdr_die 'ask' "could not open a tab in the $WORKSPACE_LABEL workspace"

# --- 6. the agent session --------------------------------------------------

# `pane run` hands the string to the pane's shell verbatim, so the question is
# single-quoted for it ('' inside a quoted string is a literal quote). All three
# agents take an opening prompt as a positional argument and stay interactive
# afterwards, which is the whole point: the answer starts arriving on its own
# and the session is there to keep talking to.
#
# exec so leaving the agent closes the tab instead of dropping back to fish
# (same as claude-tab.sh).
quoted="'${question//\'/\'\\\'\'}'"
"$herdr" pane run "$pane" "exec $agent $quoted"
