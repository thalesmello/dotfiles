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

Include the local bin folder in the PATH

	fish_add_path ./bin

Add dependencies into PATH

	fish_add_path /opt/homebrew/opt/coreutils/libexec/gnubin
	fish_add_path (python3 -m site --user-base)/bin

	mkdir -p ~/.local/bin && fish_add_path ~/.local/bin

