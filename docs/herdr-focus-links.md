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

## Offline tests

From the dotfiles repository:

```sh
lua tests/herdr_focus_test.lua
bun test stow_modules/main/dot-pi/agent/tests/herdr-skill.test.ts
bun test stow_modules/main/dot-pi/agent/tests/osc8-links.test.ts
```
