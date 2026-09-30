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

All mutation must use the helper and include `--authorized`, but only after the user explicitly approves the exact operation:

```bash
printf '%s' 'text to append' | swift scripts/totctl.swift append 2 --stdin --authorized
printf '%s' 'replacement text' | swift scripts/totctl.swift replace 4 --stdin --authorized
```

Do not write by editing the backup JSON or preferences. Use Tot's URL automation so Tot updates its in-memory state, saves normally, and syncs through iCloud.

## Operational limitations

- Tot has exactly seven dots.
- Tot itself enforces a 100,000-character maximum per dot.
- Automation returns text, not rich-text object structure. Treat output as Tot's plain/Markdown text representation.
- macOS may prompt for Automation permission the first time a terminal/agent sends AppleEvents to Tot.
