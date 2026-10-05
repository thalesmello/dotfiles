# Tot AppleScript / URL automation notes

Verified against `/Applications/Tot.app` version 2.1.1 (bundle `com.iconfactory.Tot`).

## What Tot exposes

Tot declares:

- `NSAppleScriptEnabled = true`
- URL scheme: `tot://`
- App Intents / Shortcuts actions in `Intents.intentdefinition`:
  - `GetDot` — returns all text from a dot
  - `SetDot` — sets all text in a dot
  - `AddToDot` — prepends or appends text
  - `ShowDot` — shows a dot
  - `QueryDot` — returns text and metadata
  - `SelectedDot` — returns the selected dot

The AppleScript dictionary could not be exported with `sdef` in this environment because `/usr/bin/sdef` requires full Xcode, but inspecting the app binary shows its AppleEvent URL handler and the exact URL paths below.

## AppleEvent URL handler

Tot handles `GURL` AppleEvents (the event behind `open location`) with the direct parameter set to a `tot://` URL. The useful routes are:

- `tot://<dot>/content` — returns the dot's text in the AppleEvent reply. Dot is `1` through `7`.
- `tot://<dot>/append?text=<encoded>` — appends text.
- `tot://<dot>/prepend?text=<encoded>` — prepends text.
- `tot://<dot>/replace?text=<encoded>` — replaces all text in the dot.
- `tot://<dot>` — shows/selects that dot.
- `tot://help` — opens Tot help/tutorial.
- `tot://settings` — opens Tot settings.
- `tot://empty` — opens Tot with no selected dot.

For write URLs, `text` must be URL-percent-encoded. Encode literal `+` as `%2B`; Tot converts `+` to space before percent-decoding. Newlines should be `%0A`.

Markdown caveat from live testing:

- To preserve Markdown bold markers, leave literal `*` unescaped in the `text=` value. Encoding asterisks as `%2A` can make Tot store/read back escaped markers like `\*\*Title\*\*`.
- Do not leave nested URL/link punctuation raw. For text containing `[Home](tot://1)`, encode `[` `]` `(` `)` `:` and `/` inside the `text=` value; Tot will decode them back into Markdown link syntax. In Python, use `urllib.parse.quote(text, safe='*')`.
- Avoid `safe='*[]()/:'`; live testing showed it can cause Tot to store literal `%20`/`%0A`-style percent escapes.
- Tot's Control-8 smart-bullet shortcut inserts/toggles visible smart bullet characters. Automation should write `○` for open tasks and `●` for completed tasks; do not write a literal control character for Control-8.

## Read strategy

Preferred read path:

```bash
swift scripts/totctl.swift read all
swift scripts/totctl.swift read 3
```

This sends `tot://N/content` via AppleEvent and captures the reply. If AppleEvents are unavailable and the user only needs a best-effort snapshot, `--backup-fallback` can read the newest Tot automatic backup JSON from:

```text
~/Library/Containers/com.iconfactory.Tot/Data/Library/Application Support/Tot/Backups/*.json
```

Backup fallback can be stale; always label it as a backup snapshot if used.

## Write strategy

Prefer the helper for mutations and include `--authorized`, but only after the user explicitly approves the exact operation. If the helper cannot dispatch AppleEvents from the current harness, use the Herdr pane `open "tot://..."` workaround below after the same explicit authorization:

```bash
printf '%s' 'text to append' | swift scripts/totctl.swift append 2 --stdin --authorized
printf '%s' 'replacement text' | swift scripts/totctl.swift replace 4 --stdin --authorized
```

Do not write by editing the backup JSON or preferences. Use Tot's URL automation so Tot updates its in-memory state, saves normally, and syncs through iCloud.

## Pi / Herdr dispatch workaround

In the Pi tool shell, direct dispatch to Tot can fail even when Tot is open:

```text
AppleEvent failed: NSOSStatusErrorDomain Code=-600 "procNotFound"
_LSOpenURLsWithCompletionHandler() failed ... error -54
```

If the same `open "tot://..."` command works in the user's normal terminal, and this agent is running inside Herdr (`HERDR_ENV=1`), create a new Herdr pane and run the `open` command there. This pane may have the correct interactive GUI/session context.

Example write script to run from the Herdr pane after explicit user authorization:

```python
#!/usr/bin/env python3
import subprocess, urllib.parse

dot = 1
text = "**Title**\n\n[Home](tot://1)\n○ Task"
url = f"tot://{dot}/replace?text=" + urllib.parse.quote(text, safe='*')
subprocess.run(["open", url], check=True)
```

Then verify from the same pane when possible:

```bash
/usr/bin/swift /path/to/scripts/totctl.swift read 1
```

If readback shows escaped asterisks (`\*\*Title\*\*`), repeat the replacement using the `safe='*'` encoding after confirming the dot is in plain-text mode or after Tot has converted the dot's stored view.

## Operational limitations

- Tot has exactly seven dots.
- Tot itself enforces a 100,000-character maximum per dot.
- Automation returns text, not rich-text object structure. Treat output as Tot's plain/Markdown text representation.
- macOS may prompt for Automation permission the first time a terminal/agent sends AppleEvents to Tot.
