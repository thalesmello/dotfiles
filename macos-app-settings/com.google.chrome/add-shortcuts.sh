# To see the current shortcuts: defaults read com.google.chrome NSUserKeyEquivalents
defaults write com.apple.universalaccess com.apple.custommenu.apps -array-add "com.googlecode.iterm2"
defaults write com.google.chrome NSUserKeyEquivalents -dict-add 'Thales (Personal)' -string '~^p';
defaults write com.google.chrome NSUserKeyEquivalents -dict-add 'Thales (Work)' -string '~^l';
defaults write com.google.chrome NSUserKeyEquivalents -dict-add 'Move Tab to New Window' -string '^$d';
