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

Tests: `bun test stow_modules/main/dot-pi/agent/tests/codemode*.test.ts`.
