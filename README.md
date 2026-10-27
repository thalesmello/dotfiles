# Dotfiles

Install dependencies:

```
brew bundle install
bash ./scripts/pipx_install.sh
bash ./scripts/go_install.sh
```

Set `fish` as default shell

```
echo "$(which fish)" | sudo tee -a /etc/shells
chsh -s "$(which fish)"
```

Create a symbolic links for your files:

```
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

