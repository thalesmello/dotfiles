function __ag_completion_smart
    set -l tokens (commandline --current-process --tokenize | string match -re '^[^-]')
    set -g query '\b\w*'"$(string escape $tokens[2])"'\w*\b'
    set -g results (ag -o "$query" | cut -d":" -f3- | sort | uniq -c | sort -k1,1 -n -r | awk '{ print $2 }')
    printf '%s\n' $results
end
