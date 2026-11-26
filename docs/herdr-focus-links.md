# Herdr pane focus hyperlinks

Hammerspoon handles this local URL event:

```text
hammerspoon://herdr-focus?pane=<percent-encoded-pane-id>
```

Get the **pane** ID from `herdr-app ls`, not `$HC_TERMINAL_ID`. Remote
panes keep their machine prefix: `devserver/p12` becomes `devserver%2Fp12`.
The click runs `herdr-app do pane.focus --pane <decoded-id>` on the Mac and
raises the existing Herdr application after success. It never creates a window
or runs a command inside the target terminal.

In Pi fullscreen mode, plain clicks are handled by Pi, not by the terminal.
Pi relays focus requests through OSC 52 to the attached Mac's Hammerspoon
clipboard watcher, avoiding sandboxed LaunchServices. The dedicated
`HERDR_FOCUS_PANE_V1` record contains only a validated pane ID; the web URL
relay remains restricted to HTTP(S). Hammerspoon restores the prior clipboard
(including rich content) before focusing. Cmd+click still follows Herdr's
native URL-opening path. Both paths use the same pane-focus operation. Invalid/missing targets and failed
focus commands report a notification rather than falling back to the current pane.

## Emit an OSC 8 link

Wrap a readable label in an actual OSC 8 sequence (ESC is byte `0x1b`):

```sh
printf '\033]8;;hammerspoon://herdr-focus?pane=p12\033\\Review pane (p12)\033]8;;\033\\\n'
```

Replace `p12` with a discovered pane ID. Percent-encode the query value,
including `/` for remote panes. This is a terminal hyperlink, not a Markdown
link or literal escape notation in a code block. Clicking it uses the Mac
Hammerspoon URL handler even when a remote agent printed it.

Pi's `extensions/herdr-skill.ts` adds this rule alongside the `herdr-app --skill`
pointer: whenever mentioning another pane to the user, embed its label/ID in
an OSC 8 focus link. Discover the pane first if only its terminal ID is known;
do not change the user's focus merely to reference it. The installed CLI skill
remains owned by Herdr and is not edited.

`herdrFocus.lua` is registered by Hammerspoon's `init.lua`. Reload Hammerspoon
to load the handler, and use `/reload` in existing Pi sessions to refresh the
prompt extension.

## Structured remote actions

The devserver's `herdr-remote` helper sends `HERDR_ACTION_V1` through the same
clipboard watcher. It restores the full clipboard before acting. Only the
enumerated actions are accepted, not arbitrary Herdr commands.

| CLI | Behavior |
|---|---|
| `attach [terminal] --space NAME --tab` | Attach a remote hc terminal; reuse the first matching workspace or create one |
| `attach [terminal] --space NAME --split right --pane ID` | Attach beside a validated pane in that workspace |
| `run --space NAME --tab -- command args...` | Confirm a local Mac command; workspace is mandatory and must be local |
| `focus TERMINAL` | Focus an existing terminal, including hidden coding sessions |
| `select-space SPACE` / `select-tab TAB` | Select exact IDs; tab selection first selects its workspace |
| `zoom PANE` | Toggle pane zoom on/off |
| `list agents` / `list workspaces` / `list tabs` | Return JSON to the calling devserver process |
| `move PANE --space SPACE [--tab TAB] [--name NAME]` | Move the same pane/terminal to an existing same-machine workspace; omitted tab creates a tab |

Prefix each CLI with `herdr-remote`. Use discovered IDs, preserving machine
prefixes. Names are accepted only for attach/run workspace lookup. Attach
currently creates an hc-attach wrapper terminal rather than adopting the
source terminal directly. Attach and UI navigation have no confirmation.
Local commands always require confirmation; move also confirms because it
runs a local Python helper. No close, terminal-input, or generic actions exist.

Listings require an hc core ID matching a configured machine on the Mac.
Replies travel over fixed `hc exec` argv to a receiver in the helper, with
stdin and a nonce-checked Unix socket in a private temporary directory.
Replies are capped at 1 MiB, with a 20-second deadline; no terminal paste or
clipboard read is needed. The directory/socket are removed on success or failure.

Move reuses the sibling `hc-preset` socket transport. It rereads the live
source, checks the confirmed terminal ID, writes the layout with its expected
version, then updates placement labels. It never launches or kills a terminal,
retries an uncertain write, or moves between machines. On partial label-update
failure, inspect the layout before retrying. Local splits reject `--folder`
and `--no-focus` rather than silently ignoring them.

## Offline tests

From the dotfiles repository:

```sh
lua tests/herdr_focus_test.lua
lua tests/herdr_action_test.lua
python3 -m unittest tests/herdr_remote_test.py
bun test stow_modules/main/dot-pi/agent/tests/herdr-skill.test.ts
bun test stow_modules/main/dot-pi/agent/tests/osc8-links.test.ts
```
