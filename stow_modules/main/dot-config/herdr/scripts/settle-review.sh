#!/usr/bin/env bash
# prefix+alt+d: "settle review" -- open a Pi session in the settle-review
# workspace that scans every idle/done agent, judges whether each is a good
# candidate for settling (freeze + close pane, reopenable from
# herdr-settled), and asks Thales via one questionnaire before touching
# anything.
#
# This launcher only creates the tab and hands Pi a prompt file. All the
# scanning, verdicts, asking, and settling happen inside that Pi session,
# so nothing is closed by pressing the key -- only by answering Settle in
# the questionnaire the review agent puts up.
#
# The settle-review workspace is reused (created on first use); every press
# opens a NEW tab in it, so an earlier review session is never disturbed.

set -u

here=$(cd "$(dirname "$0")" && pwd)
. "$here/herdr-lib.sh"

PATH="$HOME/.local/bin:$HOME/src/dotfiles/bin:$PATH"
export PATH

WORKSPACE_LABEL=settle-review
DIR="$HOME/src"

herdr=$(herdr_bin) || herdr_die 'settle-review' 'herdr CLI not found'
[ -d "$DIR" ] || herdr_die 'settle-review' "$DIR does not exist"

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

workspace_with_label() {
  "$herdr" workspace list 2>/dev/null | python3 -c '
import json, sys

label = sys.argv[1]
try:
    workspaces = json.load(sys.stdin)["result"]["workspaces"]
except Exception:
    workspaces = []
print(next((w["workspace_id"] for w in workspaces if w.get("label") == label), ""))
' "$1"
}

pane_available_shell_name() {
  python3 - "$1" <<'PY'
import json
import sys

try:
    info = json.loads(sys.argv[1])["result"]["process_info"]
except Exception:
    raise SystemExit(1)

shell_pid = info.get("shell_pid")
fg_pgid = info.get("foreground_process_group_id")
processes = info.get("foreground_processes") or []
shell_names = {"bash", "fish", "sh", "zsh"}

for proc in processes:
    if proc.get("pid") == shell_pid and proc.get("name") in shell_names:
        print(proc["name"])
        raise SystemExit(0)

if shell_pid is not None and fg_pgid == shell_pid:
    for proc in processes:
        if proc.get("name") in shell_names:
            print(proc["name"])
            raise SystemExit(0)

raise SystemExit(1)
PY
}

pane_shell=''
wait_for_shell_pane() {
  local _pane=$1 _attempt=1 _max _info _shell
  _max=${SETTLE_REVIEW_SHELL_WAIT_ATTEMPTS:-150}
  case $_max in ''|*[!0-9]*) _max=150 ;; esac
  [ "$_max" -gt 0 ] 2>/dev/null || _max=150

  while [ "$_attempt" -le "$_max" ]; do
    if _info=$("$herdr" pane process-info --pane "$_pane" 2>/dev/null) \
      && _shell=$(pane_available_shell_name "$_info"); then
      pane_shell=$_shell
      return 0
    fi
    sleep 0.2
    _attempt=$((_attempt + 1))
  done
  return 1
}

# --- 1. the tab -------------------------------------------------------------

workspace=$(workspace_with_label "$WORKSPACE_LABEL")

if [ -n "$workspace" ]; then
  created=$("$herdr" tab create --workspace "$workspace" --cwd "$DIR" \
    --label "$WORKSPACE_LABEL" --focus) \
    || herdr_die 'settle-review' "could not create tab in the $WORKSPACE_LABEL workspace"
else
  created=$("$herdr" workspace create --label "$WORKSPACE_LABEL" --cwd "$DIR" \
    --focus) \
    || herdr_die 'settle-review' "could not create the $WORKSPACE_LABEL workspace"
  workspace=$(printf '%s' "$created" | json_field workspace_id)
fi

pane=$(printf '%s' "$created" | json_field pane_id)
tab=$(printf '%s' "$created" | json_field tab_id)

[ -n "$pane" ] || herdr_die 'settle-review' "could not open a tab in the $WORKSPACE_LABEL workspace"
[ -n "$tab" ] && "$herdr" tab rename "$tab" "$WORKSPACE_LABEL" >/dev/null 2>&1
wait_for_shell_pane "$pane" \
  || herdr_die 'settle-review' "pane $pane did not become an available shell"

# --- 2. the prompt ------------------------------------------------------------

prompt_file=$(mktemp "${TMPDIR:-/tmp}/settle-review.XXXXXX.md") \
  || herdr_die 'settle-review' 'could not create temporary prompt file'
chmod 600 "$prompt_file" >/dev/null 2>&1 || true

cat >"$prompt_file" <<'EOF'
# Settle review

You are the settle-review agent. Your own pane is @OWN_PANE@ in workspace
@OWN_WORKSPACE@ (label `settle-review`), tab @OWN_TAB@. NEVER settle, close,
snooze, prompt, or send keys to your own pane, and exclude yourself and every
pane in the `settle-review` workspace from the scan.

Settling means: `python3 ~/.config/herdr/scripts/herdr-settled.py settle <pane_id>`
freezes the session into the settled registry and closes its pane. It is
reopenable later (prefix+alt+s, or `herdr-settled.py reopen <conversation>`),
so settling is not deletion -- but it does close the live window, so only
Thales can approve it.

## 1. Scan

Run `herdr agent list` and take every agent whose `agent_status` is `idle`
or `done`. Skip `working`, `blocked`, and `unknown`. Note each candidate's
pane_id, workspace_id, tab_id, agent kind, terminal_title_stripped, cwd, and
status.

## 2. Evaluate

For each candidate, read its recent output:

    herdr agent read <pane_id> --source recent-unwrapped --lines 120

Do this IN PARALLEL -- the scan is the slow part and the candidates are
independent. Either issue the reads as multiple tool calls in one block,
or run one bash command that backgrounds a read per candidate
(`herdr agent read <pane> ... > /tmp/settle-review-read-<pane>.txt &`)
and `wait`s for all of them, at most ~8 at a time. Never read candidates
one by one in a sequential loop. Keep each output labelled by pane_id so
verdicts cannot get crossed.

(If that comes back short because the agent runs on the alternate screen,
ask it for nothing -- judge from what you can read and mark the verdict
Uncertain rather than guessing.)

Verdicts:

- **Settle**: the task is clearly finished -- a final answer, report, or
  result was delivered, no question is waiting for Thales, no follow-up was
  promised, no background job was left running, nothing is blocked.
- **Keep**: something is waiting on Thales (a question, an approval, a
  decision), work is unfinished, or an error needs his call.
- **Uncertain**: the transcript does not prove either way. Uncertain is a
  verdict, not a failure -- say what is missing.

Already-snoozed candidates (a `$snoozed` token in `herdr agent list`) are
still listed, marked as snoozed.

Only **Settle** verdicts go to Thales as suggestions. Keep and Uncertain
candidates are reported in the table below and otherwise left alone --
they are NOT questionnaire options.

## 3. Report, then ask ONE question

First print a table in chat: pane, workspace/tab title, status, verdict,
and one line of evidence per candidate (what it last did / what it is
waiting on). Every candidate appears in the table, Keep and Uncertain
included; only the Settle ones go on to the questionnaire.

If NO candidate has a Settle verdict, stop here: report that there is
nothing to settle and do not call the questionnaire at all.

Otherwise call the `questionnaire` tool exactly once, with exactly ONE
question that has multiple choices -- never one question per candidate:

- id: `settle-selection`
- multiple: true
- prompt: `I suggest settling (freeze + close) these sessions. Select
  the ones to settle. Unselected sessions stay open, untouched. If a
  session should be snoozed instead of settled, add a custom entry
  naming it and for how long, e.g. "snooze <pane_id> until tomorrow" or
  "snooze <pane_id> 2h".`
- options: ONLY the Settle-verdict candidates, one each, with
  - value: the pane_id
  - label: `Agent: <title>` -- e.g. `Agent: develop new workflow`
    (no "suggest" wording: the question above already says these are
    the settle suggestions)
  - description: `<pane_id> · <workspace> · <status> -- <evidence>`

Do not settle anything on your own suggestion unless he selects it.

## 4. Act only on his answer

His answer has two kinds of entries:

- **Selected pane_ids**: settle each selected session. Unselected
  sessions: do nothing, they stay open.
- **Custom entries**: free text naming a session to snooze instead of
  settling (or, if it clearly says so, another action). Match the entry
  to a candidate by pane_id or unambiguous title, and do what it says
  instead of (never in addition to) settling that session. A custom
  entry overrides a selection of the same session -- if he both selected
  it and wrote "snooze it", snooze wins. Translate relative times into
  a snooze duration (`tomorrow` = `1d`, a clock time = the hours until
  then, minimum `1h`; no time given = `1d`). If a custom entry does not
  unambiguously name a candidate or an action, do NOT guess: act on the
  clear entries, then ask him in chat what he meant by that one.

Immediately before acting, re-run `herdr agent get <pane_id>` for every
session you are about to touch -- again IN PARALLEL (one block of tool
calls, or background jobs + `wait`) -- and skip any (report why) that are
no longer `idle`/`done` or no longer exist: they may have resumed
working while Thales was deciding.

The actions themselves run ONE AT A TIME, in sequence. In particular
never run two `herdr-settled.py settle` commands concurrently: it
rewrites the settled registry with an unlocked read-modify-write, so
parallel settles can silently drop each other's entries. (Read-only
herdr commands parallelize freely; mutating ones do not.)

- `settle` -> `python3 ~/.config/herdr/scripts/herdr-settled.py settle <pane_id>`
- `keep` -> do nothing
- `snooze` -> `python3 ~/.config/herdr/scripts/herdr-snooze.py snooze <pane_id> <duration>` (`1d` unless he said otherwise)

Never settle a session he did not select or name in a custom entry, and
never settle anyone who was not listed as an option.

## 5. Verify and report

After acting, run `herdr agent list` again and confirm every settled pane
is gone and every kept/snoozed pane is still there. Print a final table:
pane, title, his answer, action taken, verified result. Note that settled
sessions reopen from prefix+alt+s.
EOF

python3 - "$prompt_file" "$pane" "$workspace" "$tab" <<'PY'
import sys

path, pane, workspace, tab = sys.argv[1:5]
with open(path, encoding="utf-8") as f:
    text = f.read()
text = (text.replace("@OWN_PANE@", pane or "unknown")
            .replace("@OWN_WORKSPACE@", workspace or "unknown")
            .replace("@OWN_TAB@", tab or "unknown"))
with open(path, "w", encoding="utf-8") as f:
    f.write(text)
PY

# --- 3. the agent session -----------------------------------------------------

session_id=''
if command -v uuidgen >/dev/null 2>&1; then
  session_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
else
  session_id=$(python3 -c 'import uuid; print(uuid.uuid4())')
fi

shell_quote_fish() {
  python3 - "$1" <<'PY'
import re
import sys

arg = sys.argv[1]
safe = re.compile(r"^[A-Za-z0-9_@%+=:,./-]+$")
if arg and safe.match(arg):
    print(arg)
else:
    print("'" + arg.replace("\\", "\\\\").replace("'", "\\'") + "'")
PY
}

startup_prompt="We're working on settle-review. Details are in @$prompt_file"
agent_command="pi --session-id $(shell_quote_fish "$session_id") -- $(shell_quote_fish "$startup_prompt")"
case "${pane_shell:-fish}" in
  fish) ;;
  *) agent_command="pi --session-id '$session_id' -- '$startup_prompt'" ;;
esac

run_output=$("$herdr" pane run "$pane" "$agent_command" 2>&1) \
  || herdr_die 'settle-review' "could not launch pi in pane $pane: $run_output"

printf 'settle-review: pi session %s in pane %s (workspace %s)\n' \
  "$session_id" "$pane" "$workspace"
