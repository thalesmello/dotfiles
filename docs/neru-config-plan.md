# Neru configuration — active in the original repository

Neru v1.63.0 is installed and configured in `~/src/dotfiles`.
`~/.config/neru` links to `stow_modules/main/dot-config/neru`.
Hammerspoon owns global shortcuts; Neru's `[hotkeys]` table stays empty.
Mouseless remains installed for fallback. Neru's official login service is
installed (`neru services install`): launchd agent `com.y3owk1n.neru`,
RunAtLoad, starts at login. Manage it with `neru services status|start|stop|restart`.

## Current shortcuts

| Gesture | Action |
| --- | --- |
| Hyper+; | Open Vim with `s` search active; inside Vim, cancel input and restart `s` search |
| Right Shift / F16 in Idle | Open the last-used **Hints or Regular Grid** (Grid if none is saved) |
| Right Shift / F16 in Grid | Return to Idle |
| Right Shift / F16 in any other active mode | Open **Regular Grid** |
| Left Shift+Right Shift / Shift+F16 (also Option+Left Shift+Right Shift) | Open **Regular Grid** directly (does not toggle it closed) |
| Hyper+, | Open Vim Normal mode anywhere; cancel pending Vim input when already active |
| Hyper+/ | Open Vim with `/` search active; inside Vim, cancel input and restart `/` search |
| Double-tap Left Ctrl → F20 | Toggle Ghostty/iTerm quick terminal (run only one app to avoid hotkey competition) |
| Hyper+d | Open Scroll; page down while Scroll is active |
| Ctrl+U / Ctrl+D in Scroll | Page up / down (Hyper+U/D remain aliases) |
| W/A/S/D in Scroll | Move cursor up/left/down/right; Shift fast, Option fine |
| **Cmd+Right Shift → Cmd+F16** | Open UI Hints directly anywhere |
| **Cmd+Left Shift+Right Shift → Cmd+Shift+F16** | Toggle continuous clicks anywhere |
| **Ctrl+Right Shift → Ctrl+F16** | Open alternating-hand Recursive Grid directly |
| Escape / Shift+Escape | Quit the active mode |
| Hyper+Shift+; | Hammerspoon Command Palette |
| Hyper+Space → Hyper+r → Hyper+n | Start/restart Neru, quitting Mouseless |
| Hyper+Space → Hyper+r → Hyper+m | Restart Mouseless, quitting Neru |

Hyper means Ctrl+Option+Command, without Shift.
Karabiner directly maps Cmd+Right Shift to a clean Cmd+F16 key event: no Shift
output, raw-modifier detection, or tap timeout. This makes that combination a
dedicated command; use Left Shift for ordinary Cmd+Shift shortcuts.
Left Shift+Right Shift emits clean Shift+F16 immediately to open regular Grid
directly; Option+Left Shift+Right Shift remains an Alt+Shift+F16 alias.
Ctrl+Right Shift similarly emits clean Ctrl+F16 for Recursive Grid (replacing
the old Ctrl+Right Shift hide-cursor gesture). Cmd+Left Shift+Right Shift
emits Cmd+Shift+F16 for continuous clicks. The last successfully entered
Hints/Grid mode is persisted in `neruNavigation.lastPointerMode` and recalled
only from Idle. In Grid, plain Right Shift exits; in every other active mode,
it opens Grid. With no saved preference, Grid is the default.

Example: Cmd+Right Shift opens Hints. Quit Hints, then Right Shift recalls
Hints; pressing Right Shift again opens Grid, then again exits to Idle. The
next Right Shift recalls Grid, so repeated use returns to the Grid default.
Physical Caps is grabbed by Karabiner before Hammerspoon's F19 remap, so grid
Caps behavior goes through a Karabiner variable: Hammerspoon sets `neru-grid=1`
while a grid is open; Karabiner maps Caps tap to F17 (`action reset --toggle`)
and Shift+Caps to Escape (quit). Caps resets partial labels, selected cells,
and deeper recursive levels; at the untouched base it exits. Ctrl+Backspace
remains reset-only. The Hammerspoon F19 tap path uses the same toggle action.

### Click behavior

In mouse modes, **Space clicks and resets the grid (staying open)**; **Enter
clicks and exits**. This is independent of the continuous-mode flag.
Option+Space **or Option+Enter** right-clicks; Cmd+Space **or Cmd+Enter**
middle-clicks. Ctrl+Space/Ctrl+Enter now start a held left-button drag in
Grid, Recursive Grid, and Vim. Scroll/Bisect retain Ctrl-middle-click.

In **Hints**, Space and Enter always left-click at the real cursor position
(`--bare`), never a hint selection. Cmd, Option and Ctrl are actual click
modifiers, including combinations. Space refreshes/stays in Hints; Enter exits
after the click. Shift+Space/Enter remain move-only. Selecting a hint label
still uses Option for right-click and Cmd/Ctrl for middle-click. Pressing
Option alone does not click.
The native Neru click must succeed before the post-click step runs.
Hammerspoon's `afterClick` callback only controls leaving the mode; it never
schedules a delayed mouse-down.
Shift+Space/Shift+Enter move the cursor without clicking, then follow the same
normal/continuous completion policy. Grid/RG/Bisect commit their virtual
selection; Hints/Scroll use the real pointer. At Grid's empty root, move-only
falls back to the existing cursor rather than failing for lack of selection.

**Continuous mode** is off by default and toggled with Cmd+Shift+F16
(Cmd+Left Shift+Right Shift physically) anywhere, including Idle, or with the
palette's Continuous Clicks entry. Cmd+Right Shift always opens Hints without
changing the continuous setting.
There is no Hyper+Shift+/ binding. The status message names no shortcut.
It persists across Hammerspoon reloads.
When on, confirmation clicks/moves reset Grid/Recursive Grid to their base
layer and keep the overlay open for consecutive targets. Backspace still
backtracks; Ctrl+Backspace manually resets.
Escape and Shift+Escape quit either grid; Backspace backtracks one level in
Recursive Grid. Right Shift exits regular Grid and opens regular Grid from
Recursive Grid or any other active mode.
UI Hints uses Neru's native `--repeat` while continuous mode is on, so selecting
one hint clicks and redraws hints. Toggling inside Hints refreshes that session.

In **Vim**, normal-mode **Enter clicks the character and exits**; **Space
clicks and stays in Vim**. Vim's visual-mode Enter still performs its native
selection drag and exits. These mappings do not intercept Enter/Space typed
into the app or used to complete a search/jump. Vim Space/Enter behavior is
independent of the mouse continuous flag. The same modifier mouse buttons
work in Vim: Option+Space/Enter right-clicks and Cmd/Ctrl+Space/Enter
middle-clicks at the Vim text cursor (Cmd; Ctrl is now hold-start). Space variants stay in Vim; Enter
variants leave after clicking. Normal Enter/Space used in searches, jumps,
visual selection or app typing retain their context-specific behavior.
Shift+Space moves to the Vim cursor without clicking and stays; Shift+Enter
moves then exits. Tab/Shift+Tab switch to the next/previous display and refresh
Vim's screen text there. These are Neru bindings, not changes to Neovim editor
Tab behavior; Tab completion on Neru's colon line is replaced by this mapping.

### Grid modes

**Regular Grid (Shift+Right Shift, or Right Shift from Hints).** The fine-tune subgrid keypress only moves the
selection; Space/Enter confirms the click (in continuous mode the grid resets
to the base layer and stays open, so Space twice quickly is a double-click).
Three-character cell labels alternate hands:
left-hand region prefix, right-hand column, then left-hand row. Example: `QYQ`.
Main labels use only letters (right-hand alphabet `yuiophjklnm`), excluding
hard-to-read punctuation. The final 3×3 fine-adjustment subgrid uses right-hand
keys `uio / jkl / m,.`, where comma/period are explicitly allowed, continuing
left → right → left → right. Native Grid's number of divisions adapts to the
display. `max_label_length = 3` is a maximum, not a force-length flag; the
planner was verified to produce only three-character labels at both current
display sizes (1920×1080 and 1280×832).

**Ctrl+Right Shift: alternating-hand Recursive Grid.** Each level is 5×3.
The first level uses left-hand keys, the next right-hand keys, then left again:

```text
Left-hand levels:       Right-hand levels:
q w e r t              y u i o p
a s d f g              h j k l ;
z x c v b              n m , . /
```

The sets are disjoint, with 15 unique keys each and no number keys.
The right-hand set includes punctuation to match the keyboard rows.

Pick the target cell repeatedly until sufficiently precise, then confirm with
Space/Enter. No label selection automatically clicks in this layout.
Next-level previews are disabled. The first level uses left-hand keys, the
next right-hand keys, then left again: odd depths use the right-hand set and
even depths the left-hand set. There are no number keys. Muted-red 2px separators use the same 50% opacity
as the background.

**Palette → Neru: Mouseless Layout.** This retains the literal original
Mouseless dimensions:

| Depth | Columns × rows | Keys |
| --- | --- | --- |
| 0 | 1 × 26 | a–z rows |
| 1 | 26 × 1 | a–z columns |
| 2 | 2 × 1 | j/l halves |
| 3 | 8 × 3 | QWER UIOP / ASDF JKL; / ZXCV M,./ |

The nominal resolution is 416×78 = 32,448 target cells. The final 24-cell key
order matches Mouseless. Its two-way callback labels were not verifiable from
YAML, so j/l are deliberate new labels. This is a literal geometry match,
not a claim of identical original keystroke semantics.

Only the native Grid **subgrid shape** is fixed at 3×3 in this version—not
its display styling. Row/column labels, sublayer keys, fonts, colors, borders,
label length and matching behavior are configurable. UI Hints also supports
custom label characters, placement and styling. Consequently the Mouseless-style
layout uses a **second recursive preset**, not an unsupported native Grid
option. Regular Grid has the Shift+Right Shift direct binding.

`neruLayouts.lua` switches only the section between the managed-layout markers
in `config.toml`, preserving all colors and other settings, then reloads Neru.
It uses an atomic write and refuses ambiguous markers or concurrent edits.
The chosen layout appears in the tracked config file; selecting the other
preset can therefore create a small working-tree diff. Ctrl+Right Shift selects
the alternating-hand recursive layout. Right Shift recalls Hints/Grid only
from Idle, exits regular Grid, and opens regular Grid from other active modes.

Both grids use **cursor-hold aiming**: grid key selections update the virtual
selection without moving the real cursor. Clicks commit that position before
performing the mouse action. Explicit pointer-movement commands still move it.

## Readability and Mouseless colors

Neru exposes no configurable text-shadow setting in this version. Instead:

- Recursive/Bisect labels have **dark translucent backgrounds** for contrast.
- Labels use **Atkinson Hyperlegible Mono Bold**, installed through Homebrew
  and recorded as `font-atkinson-hyperlegible-mono` in the Brewfile. CoreText
  registers the variable font's Bold instance as
  `AtkinsonHyperlegibleMono-ExtraLight_Bold`; that exact font name is used.
- Hints use dark brown badges with near-white labels and orange matched text.
- The same Mouseless theme is used in both system appearances and all modes.
- Base brown/red: `#7A4949`; selection red: `#B87671`.
- Labels: `#FEFEFE` / white; cursor and search accents: `#FF8A00`.
- Both grids use near-black burgundy `#80180C10` at 50% opacity, with the same
  near-white text. Recursive separators are also 50% opaque; static borders are hidden.
- Static Grid borders are hidden; labels remain visible.
- Vim selection, search, containers and status bar; monitor selection;
  mode indicators and the virtual pointer use the same palette.

Colors are written in Neru's alpha-first `#AARRGGBB` format. Recursive Grid has
one shared cell fill; native Grid can have distinct base/selected fills.

In either grid, `-` / `=` adjust fill opacity in 5-percentage-point steps,
clamped to 5–95%. After a 300ms pause in these keypresses, Hammerspoon calls
`neru set-grid-opacity --value <alpha>` on the local native build. This updates
only cell fills: no config reload, selection reset, window recreation, or
separator changes. The TOML fill is also saved for the next daemon start.

With continuous mode ON, Space clicks reset the grid before the slow mouse
event, then call `neru peek-grid --duration 5s --opacity 0.25`: the native
window dims to 25% of normal while accepting and rendering selection updates.
The original window opacity is restored after five seconds, or immediately
when any letter is typed (including nudge keys), without reloading or resetting
the grid. A letter typed while the click is finishing also cancels the later
peek, so delayed command completion cannot dim the grid again.
With continuous mode OFF, Space clicks and exits with no peek. Enter always
clicks and exits. Rapid Space/Enter repeats
within 400ms reuse the previous click point until another aiming key is typed;
Hammerspoon serializes them and ignores key autorepeat. Neru emits bounded
single/double/triple-click metadata for left, right, and middle buttons.

A fine-key tap aims; repeating a short tap at the same selected position
confirms a click. Tap-versus-hold is decided using a 200ms threshold: holds
and their releases never click. Space/Enter also confirm. Repeat taps honor the modifiers captured on press:
Option right-clicks, Cmd middle-clicks, Ctrl starts a left-button hold, and
Shift moves without clicking, matching the respective Space bindings. Other
modifier combinations defer to the configured modified Space chord. During
an active Ctrl+Space drag, repeating the destination fine key commits that
point and releases the held button without an extra click. Hold any valid
pregrid or fine-grid key for 200ms to arm nudging. Pregrid holds assume the
center of their matching rectangle; a fine hold starts at its selected point.
While held, W/K/I nudge up, S/J down, A/H left, and D/L right. Sixteen nudges span
one active cell width/height, with fractional steps retained to avoid drift.
Releasing a held key only ends nudging: it never clicks. Another fine key
then selects that fine-cell center normally. `nudge-grid` updates the virtual
selection while cursor-hold is enabled; Space commits it to the actual mouse.

In continuous Hints, each click schedules a rescan 500ms later, allowing the UI
to settle. `refresh_hints --if-input-empty` skips that rescan during token input
or search. Backspace deletes a typed token character; with empty input it
asynchronously refreshes the current hint session. Leaving Hints cancels the
pending background refresh.

## Held drag workflow

In Grid, Recursive Grid and Vim:

1. Aim at the source, then **Ctrl+Space or Ctrl+Enter**.
2. The cursor commits to the source and the left button is held locally.
3. In both grids the base level is restored before destination input is accepted.
4. Select the destination, then bare **Space or Enter** releases there—no second click.

In Vim, start from normal text navigation, then move/jump to the destination.
Complete an `s` jump with its label before dropping. Space-drop keeps Vim open;
Enter-drop exits. There is no subdivision level to reset in Vim.

The shared Shift+I mouse-down default is for pointer modes, not the installed
Vim text mode. Pointer modes means Grid/Recursive Grid/Bisect/Hints/Scroll,
not an additional mode. In Vim, native `:leftdown`/`:leftup` provide drag;
Shift+I (`I`) inserts at line start. Visual Enter or `gs`+motion drag-selects text.

Hold/drop uses local ordered events, token/mode guards, and consumes drop-key
repeats through each key-up. Mode exit, config reload and shutdown release the
button. An immediate drop during base reset cancels at the source.

## Other mouse behavior

- h/j/k/l scroll; Ctrl+U/D page up/down (Hyper+U/D are aliases).
- W/A/S/D move the cursor up/left/down/right: 15 px, Shift 45 px, Option 5 px.
  Ctrl+Shift+W/A/S/D also nudge 15 px while dragging.
- g goes top and Shift+G bottom (`gg` disabled).
- Arrow keys nudge; held-key repeat is enabled.
- Tab changes monitors in mouse modes. Scroll auto-exits after 10s without a
  keystroke (Hammerspoon timer; Neru has no native mode timeout), and
  Cmd+Tab/Cmd+Shift+Tab pass the app-switch chord through and exit Scroll. In Hints, Tab/Shift+Tab move the
  cursor to the next/previous display and exit Hints (hints belong to the
  focused window, so reopen Hints there). During an active hint search, Tab
  still cycles search matches.
- Shift+Ctrl holds the left button while navigating, excluding Cmd/Option/Hyper.
- Shift+Ctrl dragging first commits the virtual target, temporarily enables
  cursor follow, and only then posts local mouse-down while the chord is still
  held in the same session. Releasing restores cursor-hold aiming.
- Hammerspoon converts mouseMoved to leftMouseDragged during its local hold.
- Releasing modifiers, mode exit, watch termination, profile handoff or shutdown
  releases that button. Ctrl+Option+Enter is the explicit Neru-managed
  left-button hold/release toggle, leaving the simpler Enter chords for clicks.
  In both grids it commits the virtual target before either pressing or dropping.
  Canceled preparations never post down; follow cleanup is serialized. If
  cleanup fails, further local dragging is blocked until Neru is restarted.

Modified-letter aliases let grid cells be selected with Shift or Shift+Ctrl
held. They include the alphabet needed by the Mouseless preset, even though
the default alternating-hand layout uses only letters and right-hand punctuation.

The original left-Control-only restriction,
Shift-tap repeat-last-action, opacity/overlay locking and mouse side-button
back/forward are not exact replicas.

## Local native build

- Fork: `https://github.com/thalesmello/neru`, cloned at `~/src/neru`.
- Branch: `live-overlay-controls`, based on the installed `v1.63.0` release.
- One commit per feature: live fill opacity, visual peek, flicker-free reset,
  fine-key confirmation, repeated-click metadata, nudging, hint refresh, and
  Caps reset-or-exit, among others. Pushed to the fork; no pull request.
- Build: `just build-version v1.63.0-local-overlay`, then
  `just dist bin/neru build/dist 1.63.0 1.63.0 local-overlay`.
- Active app: `~/src/Applications/Neru.app`; the existing CLI symlink and
  `com.y3owk1n.neru` login service still point there.
- Stock app backup:
  `~/Library/Application Support/Neru/local-build-backups/stock-20261118-123949/Neru.app`.
- `Brewfile` installs the fork instead of the upstream cask:
  `brew "thalesmello/neru/neru", args: ["HEAD"]`. The formula lives in the local
  tap `homebrew/casks/thalesmello/homebrew-neru` (stowed into Homebrew's Taps
  via `cd homebrew && stow casks`) and compiles the `live-overlay-controls`
  branch from source, producing `bin/neru`, man pages, and an ad-hoc signed
  `$(brew --prefix)/opt/neru/Neru.app`. Its caveats show how to copy that app to
  `~/src/Applications` (then re-grant Accessibility). Revert to
  `cask "y3owk1n/tap/neru"` once the changes are upstream.
- Native appearance commands are macOS-only initially; other backends
  explicitly report unsupported.

## Profile/restart safety

The default profile on a new install is Mouseless; this machine selected Neru.
Real Hammerspoon launcher handles are disabled in fallback, so F16 reaches
Mouseless. Its newer Application Support config and the legacy repo hardlink
both include F16 alongside the old Hyper+; overlay shortcut.

Profile switching/restarting persists **disarmed** before handoff. Failed
readiness or process checks therefore remain disarmed across reloads.
There is no silent fallback on command failure.

Restart commands quit the competing app and the target's old instance, verify
process exit, then start only the requested app. A service that automatically
respawns it prevents verified exit and fails closed. The login service's
KeepAlive can respawn the daemon after a kill; the profile switch then pauses
it with `neru stop`, so Mouseless still gets exclusive keyboard capture.
A normal palette switch may pause Neru rather than quit it entirely.

An identity/generation-checked watch stream tracks mode changes. Late output
cannot restore a dead session. `caps_hyper.rearm()` recreates the Hyper tap
without losing held/used/timing state, around commands and mode entries.

## Related open upstream issues

Checked the public GitHub issues:

- [#1116: Subgrid preview (similar to subkey preview)](https://github.com/y3owk1n/neru/issues/1116)
  is open. It requests next-level boundary previews, not combined two-character
  labels or current/next label pairs side by side.
- [#1743: Allow multiple keys per cell in recursive grid](https://github.com/y3owk1n/neru/issues/1743)
  is open. It requests alternate keys selecting one cell, not a multi-character
  address or a different native Grid subdivision.

No exact open request for combined recursive labels or configurable native
Grid subgrid dimensions was found in the searches. That is not a guarantee
that no differently worded issue exists. Recursive Grid rows/columns are already
configurable; this setup uses that capability for its alternating 5×3 layout.

## Automatic config reload

`neruConfigWatcher.lua` watches `config.toml` and `config.override.toml` in the
resolved Neru config directory. Saves debounce for 250ms before reloading the
running enabled daemon. There is no implicit startup while Neru is stopped;
new config loads next time it starts. Invalid edits leave the previous config
active. Config edits cancel any held drag safely.

The layout picker marks its own write as already handled, avoiding a second
reload that would close the newly opened grid. A real file edit was verified
to emit `config_reload` with `ok: true` without a manual reload command.

## Installation and testing

The normal app/Homebrew folders were write-protected from the agent's sandbox,
so the official installer placed Neru at `~/src/Applications/Neru.app`, with
`~/.local/bin/neru` on PATH. Checksum and code signature verified.
Desktop operations use Herdr's normal execution context. No TCC database or
permission grant was edited automatically. Vim needs Screen Recording.

Backups before initial activation: `/tmp/neru-production-backup.ciaBI2`.
Config before the 3×3/click update: `/tmp/neru-before-grid-click-update.toml`.

Offline checks:

```sh
lua tests/neru_navigation_test.lua
lua tests/neru_binary_resolution_test.lua
python3 tests/quick_terminal_shortcuts_test.py
lua tests/caps_hyper_test.lua
lua tests/neru_layouts_test.lua
python3 tests/neru_config_test.py
neru config validate
```

Navigation/Caps/config tests pass, along with the layout-preservation checks.
Live validation confirmed both presets and all-mode theme values. Cursor-hold
was checked through regular and recursive selections: the real pointer's
coordinates stayed unchanged until an explicit mouse action. Space was
fed through Neru's mode handler against temporary protected test overlays:
**one mouse-down, one mouse-up, and a return to idle** were observed.
Physical key delivery, native-app drag behavior, repeated hints, and OCR remain
user acceptance checks. No test clicked an underlying application button.
