# Dotfiles

Install dependencies:

```
brew install stow
cd homebrew && stow casks && cd ..
brew bundle install
bash ./scripts/pipx_install.sh
bash ./scripts/go_install.sh
```

### Patched JankyBorders

The Brewfile uses `thalesmello/JankyBorders`, with native Mission Control fading,
through its `borders-mission-control` formula. If upstream Borders is already
installed, unlink it once before running `brew bundle install`:

```bash
brew unlink felixkratz/formulae/borders
brew bundle install
```

The fork supplies the normal `borders` command. The yabai supervisor prefers
`/opt/homebrew/opt/borders-mission-control/bin/borders` (or `/usr/local/opt/...`
on Intel), with the manually compiled `~/.local/libexec/jankyborders/borders`
as a fallback. It enables `mission_control=on mission_control_fade=80`.
The fade is timed, not linked to trackpad gesture progress.

Set `fish` as default shell

```
echo "$(which fish)" | sudo tee -a /etc/shells
chsh -s "$(which fish)"
```

Create a symbolic links for your files:

```
mkdir -p ~/.pi/agent
stow main
stow local
ln "$(pwd)/mouseless/config.yaml" "$HOME/Library/Containers/net.sonuscape.mouseless/Data/.mouseless/configs/config.yaml"
```

Include the local bin folder in the PATH

```
fish_add_path ./bin
```

Add dependencies into PATH

```
fish_add_path /opt/homebrew/opt/coreutils/libexec/gnubin
fish_add_path (python3 -m site --user-base)/bin
mkdir -p ~/.local/bin && fish_add_path ~/.local/bin
mkdir -p ~/go/bin && fish_add_path ~/go/bin
```

## macOS settings

Apply system `defaults` preferences and Spotlight exclusions (`scripts/spotlight-exclusions.txt`):

```
make macos
```

Note: updating Spotlight's system-wide `VolumeConfiguration.plist` requires the terminal app to have **Full Disk Access** enabled in **System Settings → Privacy & Security → Full Disk Access** (writable user folders also receive a `.metadata_never_index` sentinel file automatically).

Verify that the current machine matches the configured macOS settings:

```
make test-macos
```

To discover the `defaults` domain and key when toggling a setting in System Settings:

```
defaults-diff
```

## Alfred workflows

The `.stowrc` in `homebrew/` targets Homebrew's tap folder, so
run `stow casks` from that folder (above). Stow requires a package
name, so bare `stow` does not work.
The Brewfile installs every cask in its `Casks/` folder. Requires Alfred Powerpack.

**Quit Alfred before migrating existing workflows.** Settings are preserved;
custom script changes are backed up, not merged. Do not change the sync folder
while installing.

```
HOMEBREW_ALFRED_WORKFLOWS_MIGRATE=1 brew bundle install
```

Backups: `~/Library/Application Support/Alfred Workflow Backups/`.


## Herdr / Herdr App transition

`bin/hc-preset` is the session-aware adapter. Legacy panes use `herdr`;
core terminals use `hc` for terminal operations and `herdr-app` for the
window. `hc-preset backend` prints the selected backend. Use
`hc-preset --backend herdr|hc ...` or `HC_PRESET_BACKEND` to select one
explicitly when both runtimes are open.

`stow main` installs both configurations side by side:

- `~/.config/herdr/config.toml`: legacy TUI configuration and plugins.
- `~/.config/herdr-core/config.toml`: new terminal runtime's shell.
- `~/.config/herdr-app/settings.json`, `keys.json`, `themes/`: desktop look
  and direct shortcuts. `mods/prefix/` implements the Ctrl-Space bindings;
  the command runner mods host interactive terminal popups.

Keep the legacy installation during the transition. Core terminal IDs
and app pane IDs are different, and neither can be used as a legacy
pane ID. Remote terminal labels use IDs local to that remote machine.
The adapter is not a replacement for every native API; consult the
installed help for the operation you need.

Pi receives only a short, session-specific skill pointer, not the full
manual: load `herdr --skill` in legacy sessions when interacting with
other panes; load `hc --skill` for core terminal/agent operations and
`herdr-app --skill` for desktop operations when needed.

## Herdr plugins

The Herdr plugins live as scripts under
`stow_modules/main/dot-config/herdr/scripts/`, with small manifests under
`stow_modules/main/dot-config/herdr/local-plugins/`. They are linked into
Herdr (`herdr plugin link`), not installed from GitHub, and there is
nothing to build.

Run these commands after `stow main`, with Herdr installed:

```
herdr
herdr-preset ensure-local-plugins-installed
~/.config/herdr/scripts/reload-config.sh
```

What each command does:

1. `herdr` starts the Herdr server once, so the next command can talk to
   it. Detach with `prefix+q` after it opens.
2. `ensure-local-plugins-installed` links every local plugin into Herdr's
   registry and checks all of them are present. Run it by hand any time;
   the agent-handler plugin also runs it at every Herdr server start, and
   it relinks anything missing (for example on a new installation).
3. `reload-config.sh` relinks the local plugins and reloads the Herdr
   config. After it, start a new Herdr client so it picks up the key
   bindings.

