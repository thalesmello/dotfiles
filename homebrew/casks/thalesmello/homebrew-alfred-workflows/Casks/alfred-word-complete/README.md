# Word Complete for Alfred

Save words and complete them from Alfred.

The workflow source is version controlled in this folder. `info.plist` contains
the workflow graph and inline shell scripts. `fuzzy.py` and `icon.png` are
workflow resources.

Edit these files, then deploy a copy with:

```sh
brew reinstall --cask thalesmello/alfred-workflows/alfred-word-complete
```

Saved words live in `~/.word_complete_for_alfred.txt`. The cask does not copy or
remove that file.
