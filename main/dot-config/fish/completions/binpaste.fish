# Fish completion for binpaste — paste the clipboard's file(s) into a folder.

# The positional argument is a destination folder: complete directories only.
complete -c binpaste -f -a "(__fish_complete_directories)"

# Options
complete -c binpaste -s m -l move -d "Move the file(s) instead of copying"
complete -c binpaste -l replace -n "not __fish_contains_opt rename merge" \
    -d "Overwrite existing files/folders wholesale on collision"
complete -c binpaste -l rename -n "not __fish_contains_opt replace merge" \
    -d "Keep both, renaming on collision (name 2.ext)"
complete -c binpaste -l merge -n "not __fish_contains_opt replace rename" \
    -d "Merge into existing folders: overwrite overlapping files, keep the rest"
