complete --command vc -e
complete --command vc --no-files --keep-order --arguments '(__vc_completion)'

# complete --command vc  --no-files --keep-order --arguments '(__ag_completion_smart)'

function __vc_completion
    set cmd (string replace \r "" (string split -m1 -f2 ' ' (commandline -c)))

    set results (nvim --headless -c 'doautocmd VimEnter *' -c "lua= vim.fn.join(vim.fn.getcompletion([=[$cmd]=], 'cmdline'), '\n')" -c 'qa!' 2>&1)

    for result in $results
        echo (string trim $result)
    end
end

function vc
    echo $argv
end
