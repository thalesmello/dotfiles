#!/usr/bin/env bash
# prefix+a: "ask" -- one question, one agent, and a purpose-appropriate
# starting directory (quick questions, prototypes, or configuration edits).
#
# The popup now does just enough classification before opening a tab, because
# the Herdr workspace itself depends on the prompt purpose:
#   quick      -> reuse/create the "qq" workspace and start in ~/src/qq
#   config     -> reuse/create the "src" workspace and start in ~/src
#   prototype  -> create a fresh try directory and slug-named workspace, then
#                 start the agent there
#
# Bound as a `type = "popup"` command so the prompt runs in a herdr-rendered PTY
# where interactive input works -- a detached `type = "shell"` command has no
# terminal. Esc (or an empty question) cancels and creates nothing.
#
# PRIVACY: routing shows the question to small models. With apfel
# that call is on-device and the question does not leave the machine at all;
# only the fallback sends it out. Nothing else leaves except what the agent you
# picked would send anyway.

set -u

here=$(cd "$(dirname "$0")" && pwd)
. "$here/herdr-lib.sh"
. "$here/prompt-lib.sh"

# A popup inherits the herdr SERVER's environment, not a login shell's, so the
# tools this script calls are not necessarily on PATH (same reasoning as
# herdr_bin in herdr-lib.sh). Keep the target agent startup on the same PATH.
ASK_PATH="$HOME/.local/bin:$HOME/src/dotfiles/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
PATH=$ASK_PATH
export PATH

# WHO ROUTES. Two small-model paths, cheapest first -- a slug/category decision
# is not worth a frontier model or a second full agent startup.
#
#   apfel, on a Mac where Apple Intelligence answers: Apple's ON-DEVICE model,
#   ~0.4-0.6s, and the question never leaves the machine. First choice for both
#   reasons. Absent, disabled or silent -> the fallback runs, so nothing has to
#   detect whether Apple Intelligence is turned on: an empty answer IS the
#   detection.
#
#   pi on gemini flash otherwise: ~1.2s with tools, extensions, sessions and
#   thinking all off -- the flags matter more than the model here, since almost
#   all of this call is startup. (For scale: the same call on claude-haiku-4-5
#   with the defaults took ~5s, and `claude -p` ~10s.)
#
# HOW THE INSTRUCTION IS DELIVERED differs per router, and both ways were found
# the hard way:
#
#   pi wants --system-prompt. Passed as a second positional (just another
#   message) flash answers the QUESTION instead of routing it.
#
#   apfel wants it in the USER prompt. Its -s is honoured by the CLI but ignored
#   by the on-device model, which answers the question at length; the same text
#   as the user turn, with the question quoted after "Prompt:", works.
ROUTING_MODEL=google/gemini-2.5-flash
ROUTING_PI_ARGS="--no-tools --no-extensions --no-session --thinking off"
ROUTING_INSTRUCTION='Return a slug and classification for a coding-agent session
started from the prompt below.

Output exactly one JSON object, with no markdown, comments, or surrounding text.
It must have two string keys: "slug" and "classification".
Generate the slug from the prompt; do not copy placeholder text.

slug: a filesystem-safe topic label, lowercase words joined by hyphens. At most
4 meaningful words and 32 characters. Never a sentence, command, question, or
restatement of the prompt. Drop URLs, quotes, file paths, punctuation, and
leading verbs like explain, fix, debug, add, or investigate. The prompt may start
by naming the agent to route to (claude, pi, codex); that is addressing, not
subject matter, so never put it in the slug: "pi: what day is it" should use a
slug like "current-date", not "pi-current-date".

classification: exactly one of quick, prototype, or config.
quick: a small question, explanation, lookup, debugging thought, or request for
advice where the expected result is an answer in chat, not new files.

prototype: the prompt asks for a custom-built solution, proof of concept,
script, app, generated artifact, deep analysis, investigation, or report where
new files/reports/workspace context are likely useful.

config: the prompt suggests editing, changing, fixing, tuning, adding, removing,
enabling, disabling, or reviewing for edits any configuration/settings/dotfiles
for shells, editors, terminals, agents, tools, apps, services, package managers,
linters, formatters, CI, or similar. Config wins over the other categories.

Examples:
"why are people in https://chat.google.com/u/0/app unable to see my repo" ->
{"slug":"github-access-investigation","classification":"quick"}
"codex explain the herdr sidebar tokens" ->
{"slug":"herdr-sidebar-tokens","classification":"quick"}
"fix the flaky test in the payments service" ->
{"slug":"payments-flaky-test","classification":"prototype"}'

QUICK_WORKSPACE_LABEL=qq
SRC_WORKSPACE_LABEL=src
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

# --- 3. slug and classify the prompt ---------------------------------------

# The popup needs the category to choose qq/src/prototype placement immediately,
# and it needs the slug up front for the tab name, prototype workspace, and
# managed-agent name. So the small routing call happens before the tab exists.
slugify() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | tr -c 'a-z0-9' '-' \
    | sed -e 's/--*/-/g' -e 's/^-//' -e 's/-$//' \
    | cut -c1-32 \
    | sed -e 's/-$//'
}

normalize_category() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z'
}

category_ok() {
  case "$1" in
    quick|prototype|config) return 0 ;;
    *) return 1 ;;
  esac
}

deterministic_category() {
  # Explicit category words in the ask prompt win before model classification.
  # Precedence is the order below: qq, then prototype, then config/dotfiles.
  local words
  words=$(printf '%s\n' "$question" \
    | tr '[:upper:]' '[:lower:]' \
    | tr -cs 'a-z0-9' '\n')
  if printf '%s\n' "$words" | grep -qx qq; then
    printf quick
  elif printf '%s\n' "$words" | grep -qx prototype; then
    printf prototype
  elif printf '%s\n' "$words" | grep -Eqx 'config|dotfiles?'; then
    printf config
  fi
}

parse_routing_decision() {
  response=$(cat)
  python3 - "$response" <<'PY'
import json
import re
import sys

text = sys.argv[1]


def balanced_objects(s):
    for start, ch in enumerate(s):
        if ch != "{":
            continue
        depth = 0
        in_string = False
        escape = False
        for i in range(start, len(s)):
            c = s[i]
            if in_string:
                if escape:
                    escape = False
                elif c == "\\":
                    escape = True
                elif c == '"':
                    in_string = False
            elif c == '"':
                in_string = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    yield s[start : i + 1]
                    break


def pick(d, *keys):
    for key in keys:
        value = d.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""

candidates = [text.strip()]
candidates.extend(m.group(1).strip() for m in re.finditer(r"```(?:json)?\s*(.*?)\s*```", text, re.I | re.S))
candidates.extend(reversed(list(balanced_objects(text))))

for candidate in candidates:
    if not candidate:
        continue
    try:
        data = json.loads(candidate)
    except Exception:
        continue
    if not isinstance(data, dict):
        continue
    slug = pick(data, "slug", "label", "title", "name")
    classification = pick(data, "classification", "category")
    if slug and classification:
        print(slug)
        print(classification)
        raise SystemExit(0)

slug_matches = re.findall(r'"(?:slug|label|title|name)"\s*:\s*"([^"]+)"', text, re.I)
classification_matches = re.findall(r'"(?:classification|category)"\s*:\s*"([^"]+)"', text, re.I)
if slug_matches and classification_matches:
    print(slug_matches[-1].strip())
    print(classification_matches[-1].strip())
    raise SystemExit(0)

raise SystemExit(1)
PY
}

accept_routing_decision() {
  parsed=$1
  got_slug=$(printf '%s\n' "$parsed" | sed -n '1p')
  got_category=$(printf '%s\n' "$parsed" | sed -n '2p')
  got_slug=$(slugify "$got_slug")
  got_category=$(normalize_category "$got_category")
  [ -n "$got_slug" ] || return 1
  [ "$got_slug" != lowercase-hyphen-slug ] || return 1
  category_ok "$got_category" || return 1
  slug=$got_slug
  category=$got_category
}

fallback_category() {
  python3 - "$question" <<'PY'
import re
import sys

q = re.sub(r"^\s*(claude|pi|codex)\b\s*[:,-]?\s*", "", sys.argv[1].lower())

config_words = r"\b(config|configuration|settings?|preferences?|dotfiles?|rc\s*file|[a-z0-9_.-]*rc\b|gitconfig|npmrc|editorconfig|env|fish|zsh|bash|tmux|vim|nvim|wezterm|kitty|ghostty|alacritty|iterm|vscode|herdr|scripts?|lint(er)?|formatter|ci)\b"
edit_words = r"\b(edit|change|update|modify|fix|add|remove|delete|set|configure|tweak|enable|disable|turn\s+on|turn\s+off|adjust|migrate|review|broken|wrong|improve|improved|improving|improvement)\b"
prototype_words = r"\b(prototype|poc|proof\s+of\s+concept|build|create|implement|write|generate|make|scaffold|script|tool|app|dashboard|report|analysis|analyze|investigation|research|benchmark)\b"
artifact_words = r"\b(file|files|report|markdown|md|csv|json|script|program|tool|app|prototype|folder|directory)\b"

if re.search(config_words, q) and re.search(edit_words, q):
    print("config")
elif re.search(prototype_words, q) and (re.search(artifact_words, q) or re.search(r"\b(build|create|implement|write|generate|make|scaffold|prototype|poc)\b", q)):
    print("prototype")
else:
    print("quick")
PY
}

slug=''
category=''
forced_category=$(deterministic_category)
if [ "$(uname -s)" = Darwin ] && command -v apfel >/dev/null 2>&1; then
  printf 'routing (apfel)...'
  got=$(apfel -q "$ROUTING_INSTRUCTION
Prompt: \"$question\"" </dev/null 2>/dev/null)
  parsed=$(printf '%s\n' "$got" | parse_routing_decision)
  if ! accept_routing_decision "$parsed"; then printf ' no decision;'; fi
fi

if [ -z "$slug" ] || [ -z "$category" ]; then
  if command -v pi >/dev/null 2>&1; then
    printf 'routing (%s)...' "$ROUTING_MODEL"
    got=$(pi -p $ROUTING_PI_ARGS \
      --model "$ROUTING_MODEL" --system-prompt "$ROUTING_INSTRUCTION" \
      -- "$question" </dev/null 2>/dev/null)
    parsed=$(printf '%s\n' "$got" | parse_routing_decision)
    if ! accept_routing_decision "$parsed"; then printf ' no decision;'; fi
  fi
fi

[ -n "$slug" ] || slug=$(slugify "$question")
stripped=$(printf '%s' "$slug" | sed -E 's/^(claude|pi|codex)-//')
[ -n "$stripped" ] && slug=$stripped
[ -n "$slug" ] || slug=ask
case "$slug" in
  [a-z]*) ;;
  *)
    slug=$(printf 'ask-%s' "$slug" | cut -c1-32 | sed -e 's/-$//')
    ;;
esac

if [ -n "$forced_category" ]; then
  category=$forced_category
else
  [ -n "$category" ] || category=$(fallback_category)
fi
category_ok "$category" || category=quick
printf ' %s %s\n' "$slug" "$category"

# --- 4. the target directory ------------------------------------------------

new_uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    python3 - <<'PYUUID'
import uuid
print(uuid.uuid4())
PYUUID
  fi
}

shell_quote() { printf '%q' "$1"; }

fish_script_escape() {
  command -v fish >/dev/null 2>&1 || herdr_die 'ask' 'fish is required to escape the pi prompt inline'
  fish -c 'string escape --style=script -- $argv[1]' -- "$1"
}

pi_start_command() {
  escaped_question=$(fish_script_escape "$question")
  command='exec pi'
  for arg in "${agent_start_args[@]}"; do
    escaped_arg=$(fish_script_escape "$arg")
    command="$command $escaped_arg"
  done
  command="$command -- $escaped_question"
  escaped_command=$(fish_script_escape "$command")
  printf 'fish -c %s' "$escaped_command"
}

clean_log_field() {
  printf '%s' "$1" | tr '\n\t' '  '
}

case "$category" in
  quick)
    workspace_label=$QUICK_WORKSPACE_LABEL
    dir="$HOME/src/qq"
    mkdir -p "$dir" || herdr_die 'ask' "could not create $dir"
    reuse_workspace=1
    ;;
  prototype)
    # Create the try directory before opening the pane so the pane's login shell
    # starts in the final working directory. `herdr agent start` requires the
    # target pane to be sitting at an interactive shell prompt, so we cannot use
    # an in-pane setup runner to cd before launching the agent.
    dir=$(try new --print-path "$slug" 2>&1) \
      || herdr_die 'ask' "try new failed: $dir"
    [ -d "$dir" ] || herdr_die 'ask' "try new produced no directory: $dir"
    workspace_label=$slug
    reuse_workspace=0
    ;;
  config)
    workspace_label=$SRC_WORKSPACE_LABEL
    dir="$HOME/src"
    [ -d "$dir" ] || herdr_die 'ask' "$dir does not exist"
    reuse_workspace=1
    ;;
  *)
    herdr_die 'ask' "unknown category: $category"
    ;;
esac

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

workspace=''
if [ "$reuse_workspace" = 1 ]; then
  workspace=$(workspace_with_label "$workspace_label")
fi

if [ -n "$workspace" ]; then
  created=$("$herdr" tab create --workspace "$workspace" --cwd "$dir" \
    --label "$slug" --env "PATH=$ASK_PATH" --focus) \
    || herdr_die 'ask' "could not create tab in the $workspace_label workspace"
else
  created=$("$herdr" workspace create --label "$workspace_label" --cwd "$dir" \
    --env "PATH=$ASK_PATH" --focus) \
    || herdr_die 'ask' "could not create the $workspace_label workspace"
fi

pane=$(printf '%s' "$created" | json_field pane_id)
tab=$(printf '%s' "$created" | json_field tab_id)

[ -n "$pane" ] || herdr_die 'ask' "could not open a tab in the $workspace_label workspace"
[ -n "$tab" ] && "$herdr" tab rename "$tab" "$slug" >/dev/null 2>&1

# --- 6. Claude project trust ----------------------------------------------

# Claude Code prompts once per project directory before it will run there.
# Ask-agent only starts in the dedicated quick-question folder, a fresh try
# directory, or ~/src for configuration edits; pre-trust that chosen project
# before `herdr agent start` so the first Claude frame is the actual session,
# not the trust dialog.
trust_claude_project() {
  [ "$agent" = claude ] || return 0

  python3 - "$dir" <<'PY'
import json
import os
import stat
import sys
import tempfile

project = os.path.abspath(sys.argv[1])
path = os.path.expanduser("~/.claude.json")
parent = os.path.dirname(path) or "."

try:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    mode = stat.S_IMODE(os.stat(path).st_mode)
except FileNotFoundError:
    data = {}
    mode = 0o600

if not isinstance(data, dict):
    raise SystemExit(f"{path} is not a JSON object")

projects = data.get("projects")
if not isinstance(projects, dict):
    projects = {}
    data["projects"] = projects

entry = projects.get(project)
if not isinstance(entry, dict):
    entry = {}
    projects[project] = entry

# Match the shape Claude normally writes for a trusted project, while preserving
# any richer per-project state if the entry already exists.
entry.setdefault("allowedTools", [])
entry.setdefault("disabledMcpjsonServers", [])
entry.setdefault("enabledMcpjsonServers", [])
entry.setdefault("hasClaudeMdExternalIncludesApproved", False)
entry.setdefault("hasClaudeMdExternalIncludesWarningShown", False)
entry["hasTrustDialogAccepted"] = True
entry.setdefault("mcpContextUris", [])
entry.setdefault("mcpServers", {})

fd, tmp = tempfile.mkstemp(prefix=".claude.json.", dir=parent, text=True)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.chmod(tmp, mode)
    os.replace(tmp, path)
except Exception:
    try:
        os.unlink(tmp)
    except OSError:
        pass
    raise
PY
}

trust_claude_project || herdr_die 'ask' "could not add $dir to ~/.claude.json trusted projects"

# --- 7. quick-question log -------------------------------------------------

session_id=''
agent_start_args=()
case "$agent" in
  pi|claude)
    session_id=$(new_uuid)
    [ -n "$session_id" ] || herdr_die 'ask' 'could not generate a session id'
    agent_start_args=(--session-id "$session_id")
    ;;
  codex)
    ;;
esac

# THE QUESTION IS A STARTUP ARGUMENT, NOT A SECOND CALL. Claude and codex take
# an opening prompt as a trailing positional to `herdr agent start`.
#
# Pi is launched below with `herdr pane run` and a fish-escaped one-line command:
# `fish -c 'exec pi --session-id ... -- <escaped prompt>'`. That keeps the
# prompt inline in the command line, including multiline prompts encoded with
# fish's script escape syntax, and avoids `agent start` rejecting control
# characters before it gets a chance to quote them.
case "$agent" in
  pi) ;;
  *)  agent_start_args+=("$question") ;;
esac

descriptor=$(clean_log_field "$slug")

quick_resume_command() {
  quoted_dir=$(shell_quote "$dir")
  case "$agent" in
    pi)
      quoted_session=$(shell_quote "$session_id")
      printf 'cd %s && pi --session-id %s' "$quoted_dir" "$quoted_session"
      ;;
    claude)
      quoted_session=$(shell_quote "$session_id")
      printf 'cd %s && claude --resume %s' "$quoted_dir" "$quoted_session"
      ;;
    codex)
      printf 'cd %s && codex resume --last' "$quoted_dir"
      ;;
  esac
}

append_quick_log() {
  [ "$category" = quick ] || return 0
  log=$dir/questions.log
  timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  resume=$(quick_resume_command)
  printf '%s\tslug=%s\tdescriptor=%s\tagent=%s\tsession_id=%s\tresume=%s\n' \
    "$timestamp" "$(clean_log_field "$slug")" "$descriptor" "$agent" \
    "$(clean_log_field "$1")" "$(clean_log_field "$resume")" >>"$log" \
    || herdr_die 'ask' "could not append to $log"
}

# Codex does not accept a caller-provided session id for a fresh interactive
# session. For quick questions, wait briefly for Codex to persist the thread
# that starts with this exact prompt, then append the same log shape with the
# actual thread id and a precise resume command. The agent should not be held
# hostage by this bookkeeping, so the watcher is best-effort and backgrounded.
start_codex_quick_log_watcher() {
  [ "$category" = quick ] || return 0
  [ "$agent" = codex ] || return 0

  log=$dir/questions.log
  start_ms=$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)

  python3 - "$log" "$slug" "$descriptor" "$dir" "$question" "$start_ms" <<'PY' >/dev/null 2>&1 &
import datetime as dt
import json
import os
import shlex
import sqlite3
import sys
import time

log_path, slug, descriptor, cwd, question, start_ms_s = sys.argv[1:]
start_ms = int(start_ms_s)
db = os.path.expanduser("~/.codex/thread_history_1.sqlite")

def text_from_item(item_json):
    try:
        item = json.loads(item_json)
    except Exception:
        return None
    pieces = []
    for part in item.get("content") or []:
        if isinstance(part, dict) and part.get("type") == "text":
            pieces.append(part.get("text") or "")
    return "".join(pieces)

def find_thread():
    if not os.path.exists(db):
        return None
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=1.0)
    try:
        rows = conn.execute(
            """
            SELECT thread_id, item_json
            FROM thread_items
            WHERE item_type = 'userMessage' AND created_at_ms >= ?
            ORDER BY created_at_ms DESC
            LIMIT 50
            """,
            (start_ms - 5000,),
        ).fetchall()
    finally:
        conn.close()
    for thread_id, item_json in rows:
        if text_from_item(item_json) == question:
            return thread_id
    return None

thread_id = None
for _ in range(90):
    try:
        thread_id = find_thread()
    except sqlite3.Error:
        thread_id = None
    if thread_id:
        break
    time.sleep(1)

if thread_id:
    session = thread_id
    resume = f"cd {shlex.quote(cwd)} && codex resume {shlex.quote(thread_id)}"
else:
    session = "unknown"
    resume = f"cd {shlex.quote(cwd)} && codex resume --last"

def clean(value):
    return str(value).replace("\n", " ").replace("\t", " ")

ts = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
line = (
    f"{ts}\tslug={clean(slug)}\tdescriptor={clean(descriptor)}"
    f"\tagent=codex\tsession_id={clean(session)}\tresume={clean(resume)}\n"
)
os.makedirs(os.path.dirname(log_path), exist_ok=True)
with open(log_path, "a", encoding="utf-8") as f:
    f.write(line)
PY
}

# --- 8. the agent session --------------------------------------------------

# Start the agent with the opening prompt already on the command line.
printf 'starting %s agent %s in %s (%s)\n' "$agent" "$slug" "$dir" "$category"

if [ "$agent" = pi ]; then
  command=$(pi_start_command)
  start_output=$("$herdr" pane run "$pane" "$command" 2>&1) \
    || herdr_die 'ask' "could not start pi agent through herdr pane run: $start_output"
else
  # Codex only gets a thread id once it has persisted the opening message, so
  # the watcher has to be listening before the agent starts. It no-ops for the
  # other agents and for non-quick categories.
  start_codex_quick_log_watcher

  start_output=$("$herdr" agent start "$slug" --kind "$agent" --pane "$pane" \
    -- "${agent_start_args[@]}" 2>&1) \
    || herdr_die 'ask' "could not start $agent agent through herdr agent start: $start_output"
fi

if [ "$category" = quick ] && [ "$agent" != codex ]; then
  append_quick_log "$session_id"
fi

printf 'asked %s\n' "$slug"
