# Hammerspoon startup

Runtime initialization keeps input taps, hotkeys, URL handlers, timer restoration,
and app-level listeners eager. Potentially expensive work is moved out of the
initial config evaluation, with these safeguards:

- **EmmyLua:** never loaded by init.lua. The Neovim Lua LSP on_attach hook generates
  annotations offline in a headless Neovim process, only for Hammerspoon buffers.
  The adapter reuses the Spoon generator without a running Hammerspoon instance.
  Other editors can invoke `bin/hammerspoon-lsp-annotations` from their LSP hook.
  Generated annotation Lua files are excluded from config auto-reload.
- **Shell:** requiring shell.lua launches no process. Environment comes from an
  unstarted hs.task object. Fish login PATH discovery starts asynchronously on
  the first task/readiness request. All tasks wait for fresh PATH; cached PATH
  only supports synchronous lookups. Queued tasks remain cancellable. Failure
  or a 10-second timeout fails dependent work explicitly and allows retry.
  Direct Neru watch and Herdr paste tasks also wait for readiness.
- **Zoom/Tot:** NSWorkspace and Space listeners start immediately. Initial AX
  attachment/window enumeration runs on the next event-loop turn. Launch events
  can attach first; generation guards and timer cleanup avoid duplicate/stale
  attachment. This is deferred main-thread work, not parallel Accessibility I/O.
- **Downloads:** capture directory membership without stat calls, install the
  listener, then lazily calculate the metadata baseline on the next turn. New
  filenames during that gap are not seeded as existing downloads. Notifications
  during initialization coalesce into a scan after the baseline is ready.
- **Mission Control:** no startup compilation. The local
  `thalesmello/hammerspoon/hammerspoon-hidtap` formula builds the native bundle.
  See `homebrew/casks/thalesmello/homebrew-hammerspoon/README.md` for installation
  and rebuilding after Hammerspoon upgrades. The existing /tmp helper is a
  migration-only fallback; install the formula before reboot.

## Live measurements (2026-11-18)

The remaining multi-second reload stall was Neru's safety check for an absent
Mouseless app. `hs.application.get("Mouseless")` took 1,566 ms because its name
lookup fell back to a global Accessibility search. The replacement
`applicationsForBundleID("net.sonuscape.mouseless")` took 0.43 ms and retains the
same ownership safety check. Mouseless handoff/restart lookups use it too.

Config evaluation before that fix measured 1,641 ms. Subsequent reloads measured
85 and 259 ms; the latest first-event-loop marker, including deferred bootstrap
work, measured 305 ms. These are live Lua reload measurements, not app launch
benchmarks. Timing varies with desktop/app state.

A follow-up profile of a full `hs.reload()` found no further multi-second stall:

| Stage | Measured |
| --- | --- |
| Teardown + Lua reinitialization before init.lua | 133 ms |
| init.lua evaluation | 63 ms |
| First event loop, including deferred bootstrap | 74 ms |
| **Total reload** | **207 ms** |

Largest remaining config cost: keybinding/hotkey registration (~38 ms main,
~18 ms local overrides), anti-distraction setup (~14 ms), and Chrome bridge
server startup (~5 ms). These are registrations required for functionality.

Two perceived-latency fixes:

- Routine hotkey enable/override logging (>100 console lines per reload) is set
  to `warning`. Opt back in with
  `hs -c 'hs.settings.set("hammerspoon.hotkeyLogLevel", "info")'` and reload.
- The "Hammerspoon!" ready alert now appears instantly (no 150 ms fade-in) and
  stays 0.5 s instead of 2 s. Other alerts keep the default style.

`startupTiming.lua` wraps `hs.reload` to record the request time, so
`totalReloadMs` includes teardown. Plain app launches report only init and
first-event-loop times.

`HammerspoonStartup` retains `beforeInitMs`, `initMs`, `firstEventLoopMs`, and
`totalReloadMs` (tracked reloads only) for inspection:

```sh
hs -q -c 'return hs.inspect(HammerspoonStartup)'
```

The native formula was installed and `brew test` passed; the live Mission Control
event tap was verified enabled after reload.

## Checks

```sh
lua tests/hammerspoon_startup_test.lua
lua tests/hammerspoon_startup_timing_test.lua
lua tests/neru_navigation_test.lua
python3 tests/hammerspoon_build_test.py
```

Deferred callbacks still consume main-thread time once they run. Compare true
app relaunches separately from Lua reloads, and measure both end of init.lua and
first-event-loop readiness before claiming end-to-end speedups.
