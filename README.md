Create a symbolic links for your files:

	ln -s (pwd)/tmux.conf ~/.tmux.conf
	ln -s (pwd)/tmate.conf ~/.tmate.conf
	ln -s (pwd)/editrc ~/.editrc
	ln -s (pwd)/inputrc ~/.inputrc
	ln -s (pwd)/snips ~/.snips
	ln -s (pwd)/gitconfig ~/.gitconfig
	ln -s (pwd)/gitignore ~/.gitignore
	ln -s (pwd)/tmux.theme ~/.tmux.theme
	ln -s (pwd)/ctags ~/.ctags
	ln -s (pwd)/w3m ~/.w3m
	ln -s (pwd)/kitty ~/.config/kitty
	ln -s (pwd)/hammerspoon ~/.hammerspoon
	ln -s (pwd)/R ~/.R
	ln -s (pwd)/Karabiner ~/Library/Application\ Support/Karabiner

Include the local bin folder in the PATH

	set -U fish_user_paths (pwd)/bin $fish_user_paths

