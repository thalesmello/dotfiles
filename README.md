Create a symbolic links for your files:

    ln -s $(pwd)/tmux.conf ~/.tmux.conf
    ln -s $(pwd)/tmate.conf ~/.tmate.conf
    ln -s $(pwd)/editrc ~/.editrc
    ln -s $(pwd)/inputrc ~/.inputrc
    ln -s $(pwd)/snips ~/.snips
    ln -s $(pwd)/gitconfig ~/.gitconfig
    ln -s $(pwd)/gitignore ~/.gitignore
    ln -s $(pwd)/tmux.theme ~/.tmux.theme
    ln -s $(pwd)/ctags ~/.ctags
    ln -s $(pwd)/w3m ~/.w3m
    ln -s $(pwd)/kitty ~/.config/kitty
    ln -s $(pwd)/hammerspoon ~/.hammerspoon
    ln -s $(pwd)/R ~/.R
    ln -s $(pwd)/Karabiner ~/Library/Application\ Support/Karabiner
    ln -s $(pwd)/ideavimrc ~/.ideavimrc
    ln -s $(pwd)/finicky.js ~/.finicky.js
    ln -s $(pwd)/btt_autoload_preset.json ~/.btt_autoload_preset.json
    ln -s $(pwd)/aerospace.toml ~/.aerospace.toml
    ln -s $(pwd)/fish ~/.config/fish
    ln -s $(pwd)/nvim ~/.config/nvim
    mkdir -p ~/.config/karabiner && ln -s $(pwd)/karabiner/karabiner.json ~/.config/karabiner/karabiner.json

Set `fish` as default shell

    echo "$(which fish)" | sudo tee -a /etc/shells
    chsh -s "$(which fish)"

Install dependencies:

    bash ./scripts/brew_install.sh
    bash ./scripts/brew_cask_install.sh
    bash ./scripts/pipx_install.sh

Include the local bin folder in the PATH

    fish_add_path ./bin

Add dependencies into PATH

    fish_add_path /opt/homebrew/opt/coreutils/libexec/gnubin
    fish_add_path (python3 -m site --user-base)/bin
    mkdir -p ~/.local/bin && fish_add_path ~/.local/bin

