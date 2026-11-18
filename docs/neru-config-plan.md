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
| Hyper+; | UI hints; select a label to click |
| Tap Right Shift / F16 | **Regular Grid**, with alternating-hand labels |
| Hyper+, | Vim text mode (press `s` inside it to start a labeled jump) |
| Hyper+d | Open Scroll; page down while Scroll is active |
| Hyper+u in Scroll | Page up (plain d/u also remain available) |
| **Cmd+Right Shift → Cmd+F16** | Recursive Grid from idle; **continuous toggle in every active mode** |
| Escape in Recursive Grid | Backtrack, like Backspace |
| Shift+Escape | Quit the active grid |
| Right Shift again / Cmd+Right Shift again | Toggle regular / recursive Grid closed |
| Hyper+Shift+; | Hammerspoon Command Palette |
| Hyper+Space → Hyper+r → Hyper+n | Start/restart Neru, quitting Mouseless |
| Hyper+Space → Hyper+r → Hyper+m | Restart Mouseless, quitting Neru |

Hyper means Ctrl+Option+Command, without Shift.
Karabiner directly maps Cmd+Right Shift to a clean Cmd+F16 key event: no Shift
output, raw-modifier detection, or tap timeout. This makes that combination a
dedicated command; use Left Shift for ordinary Cmd+Shift shortcuts.

### Click behavior

In mouse modes, **Space or Enter clicks**, then leaves the mode by default.
Option+Space **or Option+Enter** right-clicks; Cmd+Space **or Cmd+Enter**
middle-clicks. Ctrl+Space/Ctrl+Enter now start a held left-button drag in
Grid, Recursive Grid, and Vim. Hints/Scroll/Bisect retain Ctrl-middle-click. Holding Option while completing a hint
label right-clicks that target; holding Cmd or Ctrl middle-clicks it. Pressing
Option alone does not click.
The native Neru click must succeed before the post-click step runs.
Hammerspoon's `afterClick` callback only controls leaving the mode; it never
schedules a delayed mouse-down.
Shift+Space/Shift+Enter move the cursor without clicking, then follow the same
normal/continuous completion policy. Grid/RG/Bisect commit their virtual
selection; Hints/Scroll use the real pointer. At Grid's empty root, move-only
falls back to the existing cursor rather than failing for lack of selection.

**Continuous mode** is off by default and toggled with Cmd+F16 in any active
mode (Cmd+Right Shift physically), or the palette's Continuous Clicks entry.
There is no Hyper+Shift+/ binding. The status message names no shortcut.
It persists across Hammerspoon reloads.
When on, confirmation clicks/moves reset Grid/Recursive Grid to their base
layer and keep the overlay open for consecutive targets. Backspace still
backtracks; Ctrl+Backspace manually resets. Cmd+Right Shift toggles continuous
mode in every active mode; from idle it opens Recursive Grid.
In both grids, Escape resets to the starting layer (Backspace still
backtracks one level in Recursive Grid). Use Shift+Escape or Right Shift
again to quit. Right Shift opens regular Grid instead.
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

**Right Shift: regular Grid (auto-click).** It opens with `--action left_click`,
so the fine-tune subgrid keypress clicks immediately and exits; in continuous
mode it reopens at the base layer. Three-character cell labels alternate hands:
left-hand region prefix, right-hand column, then left-hand row. Example: `QYQ`.
Main labels use only letters (right-hand alphabet `yuiophjklnm`), excluding
hard-to-read punctuation. The final 3×3 fine-adjustment subgrid uses right-hand
keys `uio / jkl / m,.`, where comma/period are explicitly allowed, continuing
left → right → left → right. Native Grid's number of divisions adapts to the
display. `max_label_length = 3` is a maximum, not a force-length flag; the
planner was verified to produce only three-character labels at both current
display sizes (1920×1080 and 1280×832).

**Cmd+Right Shift: alternating-hand Recursive Grid.** Each level is 5×3.
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
option. Regular Grid is now the Right Shift binding.

`neruLayouts.lua` switches only the section between the managed-layout markers
in `config.toml`, preserving all colors and other settings, then reloads Neru.
It uses an atomic write and refuses ambiguous markers or concurrent edits.
The chosen layout appears in the tracked config file; selecting the other
preset can therefore create a small working-tree diff. Cmd+Right Shift selects
the alternating-hand recursive layout. Right Shift always selects regular
Grid, switching from other modes or closing it when already open.

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

- W/A/S/E move the pointer in Scroll. Shift triples movement; Option slows it.
- h/j/k/l scroll; d/u page; g goes top and Shift+G bottom (`gg` disabled).
- Arrow keys nudge; held-key repeat is enabled.
- Tab changes monitors in mouse modes. In Hints, Tab/Shift+Tab move the
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
