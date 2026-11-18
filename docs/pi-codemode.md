# Pi codemode controls

The shared extension is `stow_modules/main/dot-pi/agent/extensions/codemode.ts`.
Run `/reload` after installing it in an existing Pi session.

| Command | Effect |
| --- | --- |
| `/codemode` | Open a chooser for the current session. Escape cancels. |
| `/codemode on` | Enable codemode without changing other active tools. |
| `/codemode off` | Disable codemode without changing other active tools. |
| `/codemode status` | Report whether codemode is active. |
| `/codemode default on` | Enable codemode by default for future sessions on this machine. |
| `/codemode default off` | Disable codemode by default for future sessions on this machine. |

Default commands write `defaultTools` in the agent's `settings.json`, honoring
`PI_CODING_AGENT_DIR`. They preserve unrelated settings and write through the
existing settings symlink into meta-dotfiles. They do not change the current
session or the other machine's default. Project settings, CLI flags, and resumed
session tool selections can override the saved global default.

Enabling codemode makes it available to the model; it does not force the model
to use it. The separate Pi `codemode.mode` setting (`on` or `only`) is unchanged.
If the built-in codemode extension is disabled, enable `builtin:codemode` in
Pi configuration and reload before using `/codemode on`.

Tests: `bun test stow_modules/main/dot-pi/agent/tests/codemode.test.ts`.
