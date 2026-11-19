# On-demand Herdr panels

The personal `transition` layout uses `files-on-demand` and `changes-on-demand`, cloned from the installed Herdr 0.1.16 panels. Shipped panels are unchanged.

## Behavior

- Hidden ancestors and unselected stack children suppress refresh commands.
- A one-second **local** visibility check runs without triggering redraws. Visible panels keep their original ten-second refresh interval.
- Showing a panel resumes refreshing on render or the next visibility tick.
- Local folder watches are cancelled on hiding (within one tick), context changes, and closing. Cancellation does not restart the watch loop.
- An already-started command can finish, but subsequent reads/Git commands are guarded against hidden or stale context. Explicit user-initiated commits still finish even if the panel is hidden.
- Herdr's checker does not execute commands or start watches.

The layout keeps its original `files`/`changes` node IDs, so the existing buttons and shortcuts still work. Each clone is bound to its own slot with `props: { "visibility_node": "files" }` or `"changes"`. This prevents another visible copy of the same mod from activating a hidden copy. Overlay copies are visible for their lifetime. These clones are intended for layout/overlay slots, not arbitrary tab mod panes.

## Validation

```sh
bun test tests/herdr_on_demand.test.ts
herdr-app check ~/.config/herdr-app/mods/files-on-demand
herdr-app check ~/.config/herdr-app/mods/changes-on-demand
herdr-app status
```

The regression suite covers hidden startup/ticks, stack and ancestor visibility, polling cadence, hiding during an in-flight request, watch cancellation/restart, and checker side-effect guards.

## Rollback

In `stow_modules/main/dot-config/herdr-app/layouts/transition.json`, change `files-on-demand` back to `files` and `changes-on-demand` back to `changes`, removing their `visibility_node` props. Saving hot-reloads the original shipped panels. No core restart is needed.

## Scope

Only the on-demand panel mods are enabled. Native terminal-stream optimization was cancelled at the user's request; no custom build was installed and no terminal-stream setting was enabled. The installed Herdr app and ET transport are unchanged. Hidden terminal output therefore continues to stream as before.
