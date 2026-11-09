---
name: dotfile-sync
description: Sync the dotfiles and meta-dotfiles repos between this machine, GitHub origin, and the devserver (thalesmello.sb), pushing and pulling committed changes both ways while stashing and restoring uncommitted work, then ensure `stow main` links everything into $HOME. Use when the user asks to sync, push, pull, or reconcile dotfiles or meta-dotfiles across the laptop and devserver, or to resolve a dotfile-sync or stow conflict.
---

# dotfile-sync

Sync `dotfiles` and `meta-dotfiles` across the local machine and the
devserver, and make sure the synced dotfiles are actually installed.
The deterministic work is done by the `dotfile-sync` script in
`meta-dotfiles/bin/` — your job is to run it, resolve any conflicts it
reports, ensure `stow main` succeeds on both machines, ask the user when a
conflict cannot be resolved safely, and verify convergence. Do not
reimplement the sync with ad-hoc git commands.

This skill is the single copy of these instructions: it lives in
`dotfiles/stow_modules/main/dot-pi/agent/skills/dotfile-sync/` and reaches
`~/.pi/agent/skills/dotfile-sync/` via `stow main` on every machine. Do not
copy it into `~/.claude/skills`, meta-dotfiles, or anywhere else.

## Run it

Locate the script (whichever repo checkout exists on this machine) and run it:

```bash
DOTFILE_SYNC="$(command -v dotfile-sync || true)"
[ -n "$DOTFILE_SYNC" ] || for d in ~/src/meta-dotfiles ~/meta-dotfiles; do
  [ -x "$d/bin/dotfile-sync" ] && DOTFILE_SYNC="$d/bin/dotfile-sync" && break
done
"$DOTFILE_SYNC"            # add --repo dotfiles or --repo meta-dotfiles to limit scope
```

Useful flags: `--dry-run` (preview), `--host <host>` (default
`thalesmello.sb`, or `$DOTFILE_SYNC_HOST`), `--transport auto|ek|ssh`
(default `auto`, or `$DOTFILE_SYNC_TRANSPORT`), `--local-only` (this machine
↔ origin only, no devserver), `--no-stow` (skip the stow step — only when
the user explicitly wants that).

Repos are found at `~/src/<repo>` or `~/<repo>` on each machine. The
devserver does not need a current copy of the script: the orchestrator feeds
the script to it over the transport's stdin.

Devserver transport is **Enkaku first**: with `--transport auto` (the
default) the script prefers an already-connected `ek` peer for the host
(`ek status --peers`, matching the `(...thalesmello.sb)` description) and
runs the peer pass with `ek run`, which rides the human-started daemon —
this works from Pi's sandbox, where direct SSH fails because the
`~/.fb-sks-agent` cert is unreadable. Plain SSH is the fallback, and
`--transport ek` additionally tries `ek connect <host>` when no peer is
connected yet. Check connectivity with `ek status --peers`.

## Ensure `stow main` succeeds

Syncing files into the `dotfiles` checkout is not enough: `$HOME` must link
to them. After a clean dotfiles sync the script runs `stow main` from the
dotfiles repo root, on this machine and (in its own pass) on the devserver,
reporting `state=stow-ok`. Your job is to make sure that actually happened
on both sides:

1. Check the output for `DOTFILE_SYNC repo=dotfiles side=local state=stow-ok`
   and the same with `side=peer`. If a side shows `stow-skipped` (its git
   sync did not finish cleanly), resolve that first, then run stow manually:
   `cd <dotfiles repo> && stow main` locally, and on the devserver via
   Enkaku, e.g. `ek run -s <ek-peer-hostname> 'cd ~/src/dotfiles 2>/dev/null || cd ~/dotfiles; stow main'`
   (peer hostname from `ek status --peers`; probe which checkout path
   exists there). SSH works too when it is available.
2. Verify the result, not just the exit code: the stowed skill itself must
   be readable at `~/.pi/agent/skills/dotfile-sync/SKILL.md` on this
   machine (and on the devserver, when it was in scope). Spot-check a
   synced file changed in this run the same way.
3. On `state=stow-failed`, read stow's output. The usual cause is a real
   file/directory in `$HOME` where stow wants to put a symlink. Compare the
   existing file with the repo version (`diff`): if identical, remove or
   move aside the real file and re-run `stow main`; if it has content the
   repo lacks, merge that content into the repo file first (it may be
   un-synced work — treat it like uncommitted work, never delete it
   silently). Never use `stow --adopt` or delete a differing file without
   the user's OK — ask, per the rules below.
4. `stow main` is idempotent, so re-running it to verify is always safe.
   Do not declare the sync done while any in-scope side lacks `stow-ok`.

## Interpret the output

One line per repo per side, plus a summary. Exit codes:

| Code | Meaning | Your move |
|---|---|---|
| 0 | `state=clean` / `stashed-clean` and `stow-ok` everywhere | Report success (table below). Done. |
| 10 | `state=conflict` — a stash pop conflicted | Resolve it (below), then re-run. |
| 11 | `state=diverged` / `in-progress` / `detached` | Manual rebase/merge help (below), then re-run. |
| 12 | `state=peer-unreachable` | No Enkaku peer is connected and SSH is not warm/working. Tell the user to connect with Enkaku once (`ek connect thalesmello.sb`, checking `ek status --peers`; SSH/`dev connect -n thalesmello.sb --ssh` also works for the SSH fallback), then re-run. Local ↔ origin sync was still attempted. Do not treat this as a sync conflict. |
| 1 | `state=error` / `missing` / `no-origin` / `stow-failed` | Show the detail, fix the plain cause if obvious, otherwise report it. Never force-push. For `stow-failed`, see the stow section above. |

## Resolve a stash-pop conflict (`state=conflict`)

The script stashed the user's uncommitted work, pulled/pushed commits, then
popped the stash. On conflict, **git keeps the stash entry** — nothing is
lost yet, and the stash must stay until the resolution is verified.

1. Go to the `path=` in the report. Run `git status` and list the
   conflicted (`UU`/`AA`) files; run `git stash list` and identify the
   `dotfile-sync …` entry for this repo.
2. In each conflicted file, `<<<<<<< Updated upstream` is the newly synced
   *committed* version and `>>>>>>> Stashed changes` is the user's
   *uncommitted* work. Read both sides and the surrounding code, then merge
   them semantically so both intents survive. Do not blindly pick a side,
   and do not use `git checkout --ours/--theirs` on a whole file unless one
   side is provably obsolete.
3. Check for leftover markers (`grep -rn '<<<<<<<\|>>>>>>>' <files>`), run
   any cheap relevant check (syntax/test) if the repo has one, then
   `git add` the resolved files.
4. Verify the worktree now contains the full intended result, and only then
   drop that specific stash entry: `git stash drop stash@{N}` (the
   `dotfile-sync` one — never a bare `git stash drop`, never the user's
   unrelated stashes).
5. Re-run `dotfile-sync` and confirm exit 0, including `stow-ok`.

An untracked file that now collides with a newly pulled tracked file shows
up the same way — keep both contents (rename/merge) rather than deleting
the user's untracked copy.

## Resolve divergence (`state=diverged` / `in-progress`)

The script already aborted its own rebase attempt, so the tree is clean
(and any stash was restored). Inspect both histories
(`git log --oneline origin/<branch>...HEAD`, `git diff`), then either
rebase (`git rebase origin/<branch>`, resolving each conflict semantically
as above, `git add`, `git rebase --continue`) or explain the divergence.
If a merge/rebase is `in-progress`, finish it or `--abort` it only with a
stated reason. Then re-run `dotfile-sync`.

## When you cannot resolve it — ask the user

Attempt a faithful resolution first. Stop and ask the user (with the
`questionnaire` tool when available, otherwise a plain question) when:

- both sides changed the same lines/logic in incompatible ways and the
  right intent is not inferable from the code, commits, or this session;
- the conflict is binary, or resolving would delete/replace user work;
- a stow conflict would require deleting or adopting over a real file in
  `$HOME` whose contents differ from the repo version;
- you would need a force-push, `reset --hard`, `clean`, or dropping a
  stash whose contents are not fully reflected in the worktree.

Offer concrete options — e.g. *keep the local (stashed) version*, *keep the
devserver/committed version*, *keep both / I will merge manually*, *abort
and leave everything as-is* — and state exactly what is preserved where
(in particular: "your uncommitted work is safe in `stash@{N}`"). Do not
proceed with a destructive option until the user picks one. This is the
"ask before completing the sync" rule: an unresolved conflict never gets
swept away silently.

## Report

Finish with a short table: for each repo, local head, devserver/origin
state, whether uncommitted work was stashed and restored, whether
`stow main` is `stow-ok` on each side, and any stash entries left behind
(with why). Mention if the devserver pass was skipped or unreachable.
