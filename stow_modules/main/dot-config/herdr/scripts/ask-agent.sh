#!/usr/bin/env bash
# prefix+a: "ask" -- one question, one throwaway workspace directory, one agent
# session started on it.
#
# The popup does as little as possible, because the popup is modal: while it is
# up, herdr's prefix key belongs to it and the rest of the terminal is out of
# reach. So everything that can WAIT happens in the new tab instead.
#
#   in the popup (fast, no network):
#     1. prompt for the question (prompt-lib.sh)
#     2. pick the agent: the first of the words claude / pi / codex that appears
#        in the question, defaulting to pi -- name claude or codex to route there
#     3. reserve a private runner path under /tmp
#     4. open a tab in the "qq" workspace (created on the first ask), labelled
#        "asking..." for now, with that runner path in its environment
#     5. write the runner script there: everything below, with the question, the
#        agent and the tab id baked in
#     6. start the runner in the new tab
#
#   in the new tab (slow, so it is out of the way):
#     7. a small model LABELS the topic of the work -- apfel (Apple
#        Intelligence, on-device) where that exists, else `pi -p` on gemini
#        flash (see "WHO TITLES") -- and that label is slugified. A label and
#        not a slug of the question, because slugifying the question verbatim
#        gives names like why-are-people-in-https-chat-google-com-u-0 where the
#        point was github-access-investigation
#     8. rename the tab to that slug
#     9. `try new --print-path <slug>` makes ~/src/tries/<date>-<slug>
#    10. cd there and exec the agent with the question as its opening prompt, so
#        the answer is already coming in and the session is live to keep talking
#        to
#
# WHY IT MOVED. The titling model call (a second or several, longer when the API
# is slow) used to run in the popup, which froze the whole terminal on it: no
# other tab, no other key, nothing to do but wait for a cosmetic name. Now the
# popup returns the instant the tab exists and the waiting is visible in the tab
# that is doing it.
#
# The runner is a FILE and not a `pane run` one-liner because it is a program by
# now (a model call, a rename, a mkdir, a cd and an exec, with the question
# quoted through all of it). The pane only sees a short fixed command that
# expands $HERDR_ASK_AGENT_RUNNER, so the actual /tmp path never has to appear
# in shell history. The file deletes itself before exec'ing the agent.
#
# Bound as a `type = "popup"` command so the prompt runs in a herdr-rendered PTY
# where interactive input works -- a detached `type = "shell"` command has no
# terminal. Esc (or an empty question) cancels and creates nothing.
#
# PRIVACY: step 7 shows the question to a titling model. With apfel that model
# is on-device and the question does not leave the machine at all; only the
# fallback sends it out. Nothing else leaves except what the agent you picked
# would send anyway.

set -u

here=$(cd "$(dirname "$0")" && pwd)
. "$here/herdr-lib.sh"
. "$here/prompt-lib.sh"

# A popup inherits the herdr SERVER's environment, not a login shell's, so the
# tools this script calls are not necessarily on PATH (same reasoning as
# herdr_bin in herdr-lib.sh). The runner gets the same treatment: it is started
# by `pane run` in a pane's login shell, which does have a real PATH, but it is
# cheap to be sure.
ASK_PATH="$HOME/.local/bin:$HOME/src/dotfiles/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
PATH=$ASK_PATH
export PATH

# WHO TITLES. Two titlers, cheapest first, and never the agent the question was
# routed to -- a title is not worth a frontier model or a second agent startup.
#
#   apfel, on a Mac where Apple Intelligence answers: Apple's ON-DEVICE model,
#   ~0.4-0.6s, and the question never leaves the machine. First choice for both
#   reasons. Absent, disabled or silent -> the fallback runs, so nothing has to
#   detect whether Apple Intelligence is turned on: an empty answer IS the
#   detection.
#
#   pi on gemini flash otherwise: ~1.2s with tools, extensions, sessions and
#   thinking all off -- the flags matter more than the model here, since almost
#   all of a titling call is startup. (For scale: the same call on
#   claude-haiku-4-5 with the defaults took ~5s, and `claude -p` ~10s.)
#
# HOW THE INSTRUCTION IS DELIVERED differs per titler, and both ways were found
# the hard way:
#
#   pi wants --system-prompt. Passed as a second positional (just another
#   message) flash answers the QUESTION instead of titling it: "The most common
#   reason, by far, is that the repository is set to private..."
#
#   apfel wants it in the USER prompt. Its -s is honoured by the CLI but ignored
#   by the on-device model, which answers the question at length; the same text
#   as the user turn, with the question quoted after "Request:", works.
SLUG_MODEL=google/gemini-2.5-flash
SLUG_PI_ARGS="--no-tools --no-extensions --no-session --thinking off"
# THE SANDBOX FLAG, and why every pi launch here needs it.
#
# The 3pai launcher sandboxes pi with writable roots derived from the launch
# directory. A try directory is brand new and belongs to no repository, so that
# set comes out narrow -- narrow enough to exclude pi's OWN state directory, and
# pi dies on startup:
#
#   EPERM: operation not permitted, mkdir
#   '~/.pi/agent/sessions/--Users-me-src-tries-2026-09-10-some-slug--'
#
# It is specifically ~/.pi/agent that is missing: the try directory itself is
# writable (the agent can create files in it just fine), and claude is not
# affected. `--meta-add-writable-dir` grants exactly the path given, so handing
# it ~/.pi/agent -- pi's own sessions, settings and auth locks -- is the whole
# fix. `git init` in the try dir does NOT help, and neither does pre-creating
# the session directory.
PI_SANDBOX_ARGS="--meta-add-writable-dir $HOME/.pi/agent"
# The title is a LABEL, not a sentence: it becomes a tab name and a directory
# name, so what is wanted is the topic named as a thing -- "GitHub access
# investigation", not "Troubleshooting why people cannot see the repo". Left to
# themselves the models restate the question as a phrase (flash in particular
# answers with "Explain the herdr sidebar tokens"), hence the noun-phrase rule
# and the at-most-4-meaningful-words budget spelled out twice.
SLUG_INSTRUCTION='Name the TOPIC of the work a coding-agent session started from
the prompt below is about.
Output a NOUN PHRASE: a thing, named. At most 4 meaningful words (ignore short
function words like the, of, a, in). Never a sentence, a command, a question or
a restatement of the prompt -- no leading verb like explain, fix, debug, add or
investigate, and no question words.
Drop URLs, quotes, file paths and punctuation.
The prompt may start by naming the agent to route to (claude, pi, codex) -- that
is addressing, not subject matter, so never put it in the label: "pi: what day
is it" is "Current date", not "Pi current date".
Examples:
"why are people in https://chat.google.com/u/0/app unable to see my repo" ->
"GitHub access investigation".
"codex explain the herdr sidebar tokens" -> "Herdr sidebar tokens".
"fix the flaky test in the payments service" -> "Payments flaky test".
Output only the label, in plain words, with no punctuation.'

WORKSPACE_LABEL=qq
PENDING_LABEL='asking...'
RUNNER_ENV=HERDR_ASK_AGENT_RUNNER

herdr=$(herdr_bin) || herdr_die 'ask' 'herdr CLI not found'

# --- 1. the question -------------------------------------------------------

prompt_line 'Ask: ' || exit 0
question=$PROMPT_LINE
[ -n "${question// /}" ] || exit 0

# --- 2. the agent ----------------------------------------------------------

# Word-wise, first match wins: "ask codex to explain pi" is a codex question.
# tr splits on anything that is not a letter or digit, so "codex," and "(pi)"
# still count, but "pineapple" and "claudette" do not.
# Nothing named: pi, the default -- claude and codex have to be asked for.
agent=$(printf '%s\n' "$question" \
  | tr '[:upper:]' '[:lower:]' \
  | tr -cs 'a-z0-9' '\n' \
  | awk '/^(claude|pi|codex)$/ { print; exit }')
[ -n "$agent" ] || agent=pi

# --- 3. reserve the runner path --------------------------------------------

# mktemp under /tmp, so two asks at once cannot collide, and 700 so the
# question -- which is the user's own words, and is baked into this file -- is
# not readable by anyone else while it sits there.
runner=$(mktemp /tmp/ask-agent-run.XXXXXX) \
  || herdr_die 'ask' 'could not create the runner script'
chmod 700 "$runner"

# --- 4. the tab ------------------------------------------------------------

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

# --cwd $HOME: the try directory does not exist yet -- step 9, in the tab,
# creates it, and step 10 cd's into it. A pane cannot be born in a directory that
# is not there.
if [ -n "$workspace" ]; then
  created=$("$herdr" tab create --workspace "$workspace" --cwd "$HOME" \
    --label "$PENDING_LABEL" --env "$RUNNER_ENV=$runner" --focus)
else
  # First ask of the session: the workspace comes with a tab and a pane already,
  # so use those rather than creating a second tab in it.
  created=$("$herdr" workspace create --label "$WORKSPACE_LABEL" --cwd "$HOME" \
    --env "$RUNNER_ENV=$runner" --focus)
fi

pane=$(printf '%s' "$created" | json_field pane_id)
tab=$(printf '%s' "$created" | json_field tab_id)

[ -n "$pane" ] || herdr_die 'ask' "could not open a tab in the $WORKSPACE_LABEL workspace"
[ -n "$tab" ] && "$herdr" tab rename "$tab" "$PENDING_LABEL" >/dev/null 2>&1

# --- 5. the runner ---------------------------------------------------------

# printf %q for every value: this file is bash and so is this shell, so %q's
# quoting is exactly what bash will read back -- newlines, quotes and $ in the
# question and in the instruction all survive verbatim, with no escaping rules
# of our own to get wrong.
{
  printf '#!/usr/bin/env bash\n'
  printf '# Generated by ask-agent.sh. Deletes itself; not meant to be kept.\n'
  printf 'set -u\n'
  printf 'PATH=%q\n' "$ASK_PATH"
  printf 'export PATH\n'
  printf 'SELF=%q\n' "$runner"
  printf 'RUNNER_ENV=%q\n' "$RUNNER_ENV"
  printf 'HERDR=%q\n' "$herdr"
  printf 'TAB=%q\n' "$tab"
  printf 'AGENT=%q\n' "$agent"
  printf 'QUESTION=%q\n' "$question"
  printf 'SLUG_MODEL=%q\n' "$SLUG_MODEL"
  printf 'SLUG_PI_ARGS=%q\n' "$SLUG_PI_ARGS"
  printf 'PI_SANDBOX_ARGS=%q\n' "$PI_SANDBOX_ARGS"
  printf 'SLUG_INSTRUCTION=%q\n' "$SLUG_INSTRUCTION"
  cat <<'RUNNER'

# Everything lives in main(): bash parses a function whole before running it, so
# main can delete this very file (see the exec below) without bash losing the
# rest of the script under itself.
main() {
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

  # Show the failure and STAY: this pane is the only place the message exists,
  # and exiting would close the tab with it (see the exec at the end).
  fail() {
    printf '\nask: %s\n\n' "$1" >&2
    rm -f -- "$SELF"
    exec "${SHELL:-/bin/sh}" -l
  }

  # --- 7. the name -------------------------------------------------------

  # Both titlers print the answer and little else, but `pi` announces its
  # gateway on startup, so it is the LAST non-empty line that is the title, not
  # the first.
  last_line() { awk 'NF { last = $0 } END { print last }'; }

  # A LABEL, or nothing. Asked to name a topic, a model sometimes answers the
  # question instead -- apfel turned "how do herdr popups actually work" into a
  # paragraph about monitoring and alerting -- and a paragraph makes a 48-char
  # slug of pure noise. Anything past label size is treated as no answer at all,
  # which is what puts the next titler in the chain to work.
  label_ok() {
    [ -n "$1" ] || return 1
    [ "${#1}" -le 60 ] || return 1
    [ "$(printf '%s\n' "$1" | wc -w | tr -d ' ')" -le 6 ]
  }

  # apfel first, and only on a Mac: Apple Intelligence, on-device, and the
  # question stays here. Missing, switched off or rambling -> the fallback runs,
  # so nothing has to probe whether Apple Intelligence is available.
  #
  # ONE USER PROMPT, NOT -s. apfel's -s took the instruction and the on-device
  # model ignored it wholesale: given "how do herdr popups actually work" it
  # wrote five paragraphs about state management and CSS transitions instead of
  # a label -- a small model follows the last user turn, and a question in that
  # turn beats any system prompt telling it not to answer. With the same
  # instruction moved INTO the user turn and the question quoted after
  # "Request:", every case above titles correctly in ~0.4s. (pi is the opposite:
  # it wants --system-prompt, see below.)
  #
  # </dev/null on both titlers: neither is meant to read the terminal, and this
  # runs in a pane the user may already be typing into.
  title=''
  if [ "$(uname -s)" = Darwin ] && command -v apfel >/dev/null 2>&1; then
    printf 'naming (apfel)...'
    got=$(apfel -q "$SLUG_INSTRUCTION
Request: \"$QUESTION\"" </dev/null 2>/dev/null | last_line)
    if label_ok "$got"; then title=$got; else printf ' no label;'; fi
  fi

  # $PI_SANDBOX_ARGS for the reason documented where it is set (this call runs
  # before the cd, but it is the same launcher and the same state directory).
  # $SLUG_PI_ARGS is what makes it fast, --no-session also keeping the titling
  # exchange out of ~/.pi/agent/sessions, out of `pi --resume` and out of the
  # agent inbox's history.
  if [ -z "$title" ]; then
    printf 'naming (%s)...' "$SLUG_MODEL"
    got=$(pi $PI_SANDBOX_ARGS -p $SLUG_PI_ARGS \
      --model "$SLUG_MODEL" --system-prompt "$SLUG_INSTRUCTION" \
      "$QUESTION" </dev/null 2>/dev/null | last_line)
    label_ok "$got" && title=$got
  fi

  slug=$(slugify "$title")
  # No model, no network, no answer: the question's own first words are a worse
  # name (this is the verbatim-question case the title exists to avoid) but
  # never a missing one.
  [ -n "$slug" ] || slug=$(slugify "$QUESTION")

  # "pi: what day is it" is a question about the day, not about pi: the agent
  # name is how the question was addressed (the popup already consumed it), so
  # it is not part of what this try is called. Leading only: a trailing "-pi" is
  # usually a real word of the title ("debug-with-pi"), while a leading one is
  # the address.
  stripped=$(printf '%s' "$slug" | sed -E 's/^(claude|pi|codex)-//')
  # ...unless that was the whole name ("ask pi about pi"), in which case the
  # agent name is all there is to go on.
  [ -n "$stripped" ] && slug=$stripped
  [ -n "$slug" ] || slug=ask

  printf ' %s\n' "$slug"

  # --- 8. the tab name ---------------------------------------------------

  [ -n "$TAB" ] && "$HERDR" tab rename "$TAB" "$slug" >/dev/null 2>&1

  # --- 9. the directory --------------------------------------------------

  # `--print-path` creates the dated directory and prints it, instead of the
  # mkdir+cd script `try` normally emits: the cd happens below, in this shell.
  # See cmd_new! in dotfiles/bin/try.
  dir=$(try new --print-path "$slug" 2>&1) || fail "try new failed: $dir"
  [ -d "$dir" ] || fail "try new produced no directory: $dir"
  cd "$dir" || fail "could not cd into $dir"

  # --- 10. the agent session ---------------------------------------------

  # All three agents take an opening prompt as a positional argument and stay
  # interactive afterwards, which is the whole point: the answer starts arriving
  # on its own and the session is there to keep talking to.
  #
  # Launcher flags per agent, in the positional parameters rather than an array:
  # "$@" is safe when empty under `set -u`, `"${arr[@]}"` is not in the bash 3.2
  # that /usr/bin/env bash still finds on a stock macOS.
  case $AGENT in
    pi) set -- $PI_SANDBOX_ARGS ;;
    *)  set -- ;;
  esac

  unset "$RUNNER_ENV"
  rm -f -- "$SELF"

  # NOT exec: an exec'd agent that dies at startup takes the tab down with it,
  # and the traceback with the tab -- which is exactly how the sandbox EPERM
  # above hid for a whole round of debugging ("it created the new window but it
  # didn't persist"). Run it instead, and only let the tab close on a clean
  # exit, which is the ordinary way out of all three agents.
  "$AGENT" "$@" "$QUESTION"
  rc=$?
  [ "$rc" -eq 0 ] && exit 0
  printf '\nask: %s exited with status %d\n\n' "$AGENT" "$rc" >&2
  exec "${SHELL:-/bin/sh}" -l
}

main "$@"
RUNNER
} >"$runner"

# Start the runner through the environment variable we planted on the tab: the
# pane only sees the fixed command below, not the actual /tmp path. exec so the
# agent, not a wrapper, owns the pane.
"$herdr" pane run "$pane" 'exec bash "$HERDR_ASK_AGENT_RUNNER"'
