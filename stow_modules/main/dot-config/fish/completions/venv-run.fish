function __fish_venv_run_missing_binary
    set cmd (commandline -opc)

    if test (count $cmd) -eq 1; and test $cmd[1] = 'venv-run'
        return 0
    end

    if test (count $cmd) -eq 2; and test $cmd[2] = '--'
        return 0
    end

    return 1
end

function __fish_venv_run_complete_binaries
    set -l venv_bin_dir (path dirname */bin/activat?)

    for file in $venv_bin_dir/*
        set -l filename (basename $file)

        if test -x $file
            echo $filename
        end
    end
end

function __fish_venv_run_binary_inserted
    set cmd (commandline -opc)

    if test (count $cmd) -gt 2; and test $cmd[2] = '--'
        return 0
    else if test (count $cmd) -gt 1; and test $cmd[2] != '--'
        return 0
    end

    return 1
end

function __fish_venv_run_get_binary_completion
    set cmd (commandline -opc)


    if test (count $cmd) -gt 2; and test $cmd[2] = '--'
        set cmd $cmd[3..]
    else if test (count $cmd) -gt 1; and test $cmd[2] != '--'
        set cmd $cmd[2..]
    end

    begin
        set -lx PATH (path dirname */bin/activat?) $PATH
        complete -C "$cmd "(commandline -ct)
    end
end


complete -f -c venv-run -n "__fish_venv_run_missing_binary" -a "(__fish_venv_run_complete_binaries)"
complete -f -c venv-run -n "__fish_venv_run_binary_inserted" -a "(__fish_venv_run_get_binary_completion)"

