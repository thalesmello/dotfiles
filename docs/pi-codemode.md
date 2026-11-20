# Pi codemode controls

The shared extension is `stow_modules/main/dot-pi/agent/extensions/codemode.ts`.
Run `/reload` after installing it in an existing Pi session.

| Command | Effect |
| --- | --- |
| `/codemode` | Open the chooser: Enter applies to this session; Ctrl+S saves the highlighted choice as the default without changing this session; Escape cancels. |
| `/codemode on` | Enable optional codemode alongside direct tools. |
| `/codemode off` | Disable codemode without changing other active tools. |
| `/codemode only` | Enable codemode and force tool access through scripts. |
| `/codemode status` | Report whether codemode is active. |
| `/codemode default on` | Enable codemode by default for future sessions on this machine. |
| `/codemode default off` | Disable codemode by default for future sessions on this machine. |
| `/codemode default only` | Enable forced codemode by default for future sessions on this machine. |

Default commands write `defaultTools` in the agent's `settings.json`, honoring
`PI_CODING_AGENT_DIR`. They preserve unrelated settings and write through the
existing settings symlink into meta-dotfiles. They do not change the current
session or the other machine's default. Project settings, CLI flags, and resumed
session tool selections can override the saved global default.

`on` leaves direct tools available; `only` hides their declarations so the model
reaches them through scripts. Changing between `on` and `only` saves
`codemode.mode` in this machine's agent settings and automatically reloads Pi.
This also changes the presentation mode for future sessions, but preserves
`defaultTools` (whether codemode is enabled by default). Project settings can
override the global presentation mode. `off` does not change the saved mode.
Default `on`/`only` commands save both enablement and presentation mode, without
reloading or changing the current session.
If the built-in codemode extension is disabled, enable `builtin:codemode` in
Pi configuration and reload before using `/codemode on`.

## Open-TUI rendering

In compact tool-view mode, the built-in codemode tool is rendered as one group:
JavaScript heading, parent completion/progress summary, nested tool names and
statuses, and a short preview of the script output. Settled calls use the same
rounded block as Bash, enclosing the heading, nested calls, and output together. Caught nested errors remain
visible even when the script succeeds. Large groups show an expansion hint;
Click a nested block to expand or collapse only that call. Ctrl+O expands the
parent script and all nested calls; individual clicks can override those states.
Source and command previews are syntax-highlighted, including embedded inline
scripts and heredoc bodies. In fullscreen mode, selecting text inside a nested
card is confined to that card's body and omits both its own borders and the
outer codemode frame—even when the pointer is dragged beyond the card.

Successful nested Edit calls show a colored diff preview inside the card while
collapsed, matching the normal Edit renderer. Native diffs retain actual file
line numbers. Older calls without a saved diff show the requested old/new
changes without inventing file line numbers; failed edits do not claim applied
changes.

This works without enabling generic extension-tool rendering. Native tool-view
mode, explicit tool exclusions, custom codemode overrides, and Zen rendering
retain their existing behavior. Execution, permission hooks, and model-visible
tool content are unchanged. Bounded child-output snapshots are saved as UI-only
parent result metadata: up to 64 child calls, 8KiB UTF-8 text plus edit diffs per
child, and 64KiB content per script (plus metadata overhead). Image bytes are not duplicated. Older
sessions without snapshots show the arguments and explain that nested output
was not recorded; the parent script output remains available.

Supported source languages include Python, Ruby, Rust, C/C++, Java, PHP,
JavaScript/TypeScript, R, SQL, Go, Lua, Perl, Swift, Kotlin, Scala, C#, Dart,
PowerShell/shell, JSON, YAML, TOML, HTML/XML and CSS. Filename extensions and
known interpreters determine the language; uncertain shell constructs stay
shell-highlighted rather than guessing. Source preview preparation is bounded
across sections to avoid freezing the UI on large scripts or edit batches.

Tests:

```sh
bun test stow_modules/main/dot-pi/agent/tests/codemode*.test.ts
bun test stow_modules/main/dot-pi/agent/tests/open-tui-codemode.test.ts \
  stow_modules/main/dot-pi/agent/tests/script-language.test.ts \
  stow_modules/main/dot-pi/agent/tests/nested-output.test.ts \
  stow_modules/main/dot-pi/agent/tests/nested-block-selection.test.ts
```

Rebuild the loaded Open-TUI bundle after source changes:

```sh
bun build stow_modules/main/dot-pi/agent/extensions/open-tui/index.ts \
  --target bun --format esm \
  --external '@earendil-works/pi-coding-agent' \
  --external '@earendil-works/pi-tui' \
  --outfile stow_modules/main/dot-pi/agent/extensions/open-tui/bundle.js
```
