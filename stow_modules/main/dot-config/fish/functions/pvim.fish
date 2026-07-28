function pvim -a type -a resource
    cvim "E$type" "$resource"
end



complete -c pvim -n "__fish_is_nth_token 1" -xa '(complete -C "cvim O" | sed 's/^O//')'
complete -c pvim -n "__fish_is_nth_token 2" -xa '(complete -C "cvim E$(commandline -poc)[2] ")'
