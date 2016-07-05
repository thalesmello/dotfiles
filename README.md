Create a symbolic links for your files:

	ln -s $(pwd)/vimrc.local ~/.vimrc.local
	ln -s $(pwd)/vimrc.bundles.local ~/.vimrc.bundles.local
	ln -s $(pwd)/tmux.conf.local ~/.tmux.conf.local
	ln -s $(pwd)/zshrc.plugins ~/.zshrc.plugins
	ln -s $(pwd)/zshrc.config ~/.zshrc.config
	ln -s $(pwd)/zshrc.alias ~/.zshrc.alias
	ln -s $(pwd)/editrc ~/.editrc
	ln -s $(pwd)/inputrc ~/.inputrc
	ln -s $(pwd)/snips ~/.snips
	ln -s $(pwd)/w3m.keymap ~/.w3m/keymap
	ln -s $(pwd)/hammerspoon ~/.hammerspoon

Include the local bin folder in the PATH

	echo "\n# Dotfiles bin folder\nexport PATH="'$PATH'":$(pwd)/bin" >> ~/.zshrc.local

Copy this right before `source $ZSH/oh-my-zsh.sh` in your `.zshrc`

	source ~/.zshrc.plugins

Copy this to the end of your `.zshrc`

	source ~/.zshrc.secrets
	source ~/.zshrc.config

