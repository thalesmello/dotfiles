Create a symbolic links for your files:

	ln -s $(pwd)/vimrc.local ~/.vimrc.local
	ln -s $(pwd)/vimrc.bundles.local ~/.vimrc.bundles.local
	ln -s $(pwd)/tmux.conf.local ~/.tmux.conf.local
	ln -s $(pwd)/zshrc.plugins ~/.zshrc.plugins
	ln -s $(pwd)/zshrc.config ~/.zshrc.config
	ln -s $(pwd)/editrc ~/.editrc
	ln -s $(pwd)/inputrc ~/.inputrc

Copy this right before `source $ZSH/oh-my-zsh.sh` in your `.zshrc`

	source ~/.zshrc.plugins

Copy this to the end of your `.zshrc`

	source ~/.zshrc.local
	source ~/.zshrc.secrets
	source ~/.zshrc.config

