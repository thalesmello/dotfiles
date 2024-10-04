function __ag_completion_smart
    set -l tokens (commandline --current-process --tokenize | string match -re '^[^-]')
    set -g query '\b\w*'"$(string escape $tokens[2])"'\w*\b'
    set -g results (ag -o "$query" | cut -d":" -f3- | sort | uniq -c | sort -k1,1 -n -r | awk '{ print $2 }')
    printf '%s\n' $results
end


# Load rest of completions
set --local ag_paths $fish_complete_path/ag.fis?

for path in $ag_paths[-1..1]
  if test "$path" != "$(status --current-filename)"
    source $path
  end
end

# Overwrite smart completion
complete --command ag -n '__fish_is_first_token 1' --no-files --keep-order --arguments '(__ag_completion_smart)'
