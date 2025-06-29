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

Create a symbolic links for your files:

```
stow --target "$HOME" --dotfiles main
stow --target "$HOME" --dotfiles local
ln "$(pwd)/mouseless/config.yaml" "$HOME/Library/Containers/net.sonuscape.mouseless/Data/.mouseless/configs/config.yaml"
```
