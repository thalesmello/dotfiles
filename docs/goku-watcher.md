# Automatic Goku compilation

Hammerspoon loads `gokuWatcher.lua` from `init.lua`. Saving
`~/.config/karabiner.edn` automatically runs `goku -c ~/.config/karabiner.edn`
to regenerate and apply Karabiner's JSON configuration.

The watcher monitors both the symlink parent and the resolved target parent,
so editor atomic saves work. Changes debounce for 250 ms, unchanged content
is skipped, and Goku runs asynchronously through `shell.task`. Saves during
a run queue a single follow-up check rather than launch overlapping compiles.
Generated JSON and temporary-file events are ignored. Failures show an alert
and are logged in the Hammerspoon console; saving again retries.

No compilation runs merely because Hammerspoon starts. Reload Hammerspoon
once after installing the watcher.

Offline tests, from the dotfiles repository:

```sh
lua tests/goku_watcher_test.lua
```
