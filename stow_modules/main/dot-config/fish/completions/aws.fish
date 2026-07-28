function __fish_aws_completer
    set --local --export fish_trace 1
    set --local --export COMP_SHELL fish
    set --local --export COMP_LINE "$(commandline)"

    aws_completer | sed 's/ $//'
end

test -x (type -q aws_completer)
and complete --command aws --no-files --arguments '(__fish_aws_completer)'


# Load rest of completions
set --local aws_paths $fish_complete_path/aws.fis?

for path in $aws_paths[-1..1]
  if test "$path" != "$(status --current-filename)"
    source $path
  end
end
