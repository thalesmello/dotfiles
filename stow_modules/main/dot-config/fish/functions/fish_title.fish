# Terminal title. Mirrors fish's default, but prepends [ssh], [et] or [mosh]
# while a remote session is the foreground command, so remote shells are
# obvious at a glance in the window/tab title.
function fish_title
    # emacs' "term" is basically the only term that can't handle it.
    if set -q INSIDE_EMACS; and string match -q '*,term:*' -- $INSIDE_EMACS
        return
    end

    set -l cmd $argv[1]
    set -l prefix (__fish_title_remote_prefix $cmd)

    test -n "$cmd"; or set cmd fish

    echo -- $prefix $cmd (prompt_pwd -d 1 -D 1)
end

# Print "[ssh]", "[et]" or "[mosh]" when the given command line runs one of
# those, and nothing otherwise. Leading wrappers (sudo, command, env VAR=val,
# ...) are skipped so `sudo ssh host` is still tagged.
function __fish_title_remote_prefix --argument-names cmd
    for token in (string split -n ' ' -- $cmd)
        switch (path basename -- $token)
            case ssh et mosh
                echo "[$(path basename -- $token)]"
                return
            case command builtin exec sudo doas env time nice nohup '*=*'
                continue
            case '*'
                return
        end
    end
end
