function __fish_aws_completer
    set --local --export COMP_SHELL fish
    set --local --export COMP_LINE (commandline)

    aws_completer | sed 's/ $//'
end

test -x (type -q aws_completer)
and complete --command aws --no-files --arguments '(__fish_aws_completer)'
