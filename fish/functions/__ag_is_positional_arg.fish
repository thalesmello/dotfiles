function __ag_is_positional_arg --argument pos
    set -l curr_tokens (commandline --cut-at-cursor --current-process --tokenize | string match -re '^[^-]')
    if test (count $curr_tokens) -eq $pos
        return 0
    else
        return 1
    end
end
