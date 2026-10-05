---
name: tot-app
description: Read and operate on Tot.app notes/dots. Use when asked to inspect, summarize, organize, search, show, append, prepend, replace, or otherwise manipulate Tot/Tot.app contents via the tot:// AppleEvent URL integration. Reads are allowed without extra confirmation; mutations require explicit user authorization immediately before execution.
compatibility: macOS with Tot.app installed
---

# Tot.app skill

Use this skill for Tot.app, the seven-dot note app by The Iconfactory.

Before operating on Tot, read `references/applescript-integration.md` from this skill directory for the current automation findings and URL routes.

## Core rules

1. Tot has seven dots, numbered `1` through `7`.
2. You may read Tot contents whenever needed to satisfy the user's request.
3. You must ask for and receive explicit user authorization before any write/mutation (`append`, `prepend`, or `replace`).
4. Do not treat broad prior intent as write authorization. Ask right before the mutation and state:
   - target dot number(s),
   - operation (`append`, `prepend`, or `replace`),
   - exact text to be written or a concise diff/summary if the text is long,
   - whether the current dot was read first.
5. Only mutate using Tot's automation URL handler. Prefer `scripts/totctl.swift`; if the current harness cannot dispatch AppleEvents/LaunchServices but a user-visible Herdr pane can, you may run an `open "tot://..."` command from a new Herdr pane after explicit authorization. Do not edit Tot backup JSON, preferences, caches, or iCloud files directly.
6. If a read uses backup fallback, clearly say it is a backup snapshot and may be stale.
7. When using Markdown in Tot text, preserve literal `*` characters in the URL query so `**bold**` stays unescaped. Encode other query-significant characters inside `text=`; for Markdown links such as `[Home](tot://1)`, do **not** leave `:`, `/`, `[`, `]`, `(`, or `)` raw in the URL.
8. Tot smart bullets are inserted by the UI with Control-8, but automation should write the visible characters (`○` for open items, `●` for completed items) rather than a literal control character.

## Helper commands

Run scripts relative to this skill directory. Prefer:

```bash
swift <skill-dir>/scripts/totctl.swift read all
swift <skill-dir>/scripts/totctl.swift read 1
```

The helper sends `tot://<dot>/content` as a `GURL` AppleEvent and prints the returned text. For all-dot reads it prints JSON keyed by dot number.

If AppleEvents are unavailable and a best-effort snapshot is acceptable:

```bash
swift <skill-dir>/scripts/totctl.swift read all --backup-fallback
```

## Mutations

The helper refuses writes unless `--authorized` is present. Only include it after the user has approved the exact proposed mutation.

Examples after authorization:

```bash
printf '%s' 'text to append' | swift <skill-dir>/scripts/totctl.swift append 2 --stdin --authorized
printf '%s' 'text to prepend' | swift <skill-dir>/scripts/totctl.swift prepend 2 --stdin --authorized
printf '%s' 'full replacement text' | swift <skill-dir>/scripts/totctl.swift replace 2 --stdin --authorized
```

After a mutation, read the affected dot again when feasible and report the result at a high level. If readback shows escaped Markdown markers such as `\*\*Title\*\*`, repair by replacing the dot again with literal `*` preserved in the URL encoding.

## Herdr pane workaround

In this Pi harness, direct AppleEvent or LaunchServices calls may fail even when the same command works in a normal terminal:

- `AppleEvent failed: ... Code=-600 "procNotFound"`
- `_LSOpenURLsWithCompletionHandler() failed ... error -54`

When `HERDR_ENV=1`, a new Herdr pane can be closer to the user's interactive GUI session and may successfully dispatch Tot URLs. Use it only after mutation authorization.

Pattern:

```bash
# Create/use a Herdr pane, then run a script in that pane:
herdr pane split --current --direction right --cwd "$PWD" --no-focus
herdr pane run <pane-id> 'python3 /tmp/replace_tot_dot.py'
```

For Markdown-friendly URL writes from Python, encode the text like this:

```python
url = f"tot://{dot}/replace?text=" + urllib.parse.quote(text, safe='*')
subprocess.run(["open", url], check=True)
```

Use `safe='*'` only: it preserves `**bold**` markers while still encoding nested link URLs like `[Home](tot://1)` safely inside the `text=` query value.

## Non-mutating UI operations

Showing/selecting a dot changes Tot's UI state but not note contents:

```bash
swift <skill-dir>/scripts/totctl.swift show 3
```

Ask before showing a dot if the user did not request UI interaction.
