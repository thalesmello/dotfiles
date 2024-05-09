function __zoxide_z_complete_smart
    set -l tokens (commandline --current-process --tokenize)
    set -l curr_tokens (commandline --cut-at-cursor --current-process --tokenize)

    if test (count $tokens) -le 2 -a (count $curr_tokens) -eq 1
        # If there are < 2 arguments, use `cd` completions with query results
        # __fish_complete_directories "$tokens[2]" ''
        set -l directories (__fish_complete_directories "$tokens[2]" 'Directory')
        set -l zoxide_suggestions (zoxide query --list --score --exclude "$(__zoxide_pwd)" -- $query | awk '{ pos=index($0, $2); print substr($0, pos) "\t" "Zoxide-score " $1 }')
        printf '%s\n' $directories $zoxide_suggestions
    else if test (count $tokens) -eq (count $curr_tokens)
        # If the last argument is empty, use interactive selection.
        set -l query $tokens[2..-1]
        set -l result (zoxide query --exclude (__zoxide_pwd) -i -- $query)
        and echo $__zoxide_z_prefix$result
        commandline --function repaint
    end
end

complete --command z --no-files --keep-order --arguments '(__zoxide_z_complete_smart)'
