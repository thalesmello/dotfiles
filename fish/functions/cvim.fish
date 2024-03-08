complete --command cvim -e
complete --command cvim --no-files --keep-order --arguments '(__cvim_completion)'

# complete --command cvim  --no-files --keep-order --arguments '(__ag_completion_smart)'

function __cvim_completion
    set cmd (string replace \r "" (string split -m1 -f2 ' ' (commandline -c)))

    set results (nvim --headless -c 'doautocmd VimEnter *' -c "lua= vim.fn.join(vim.fn.getcompletion([=[$cmd]=], 'cmdline'), '\n')" -c 'qa!' 2>&1)

    for result in $results
        echo (string trim $result)
    end
end

function cvim
    vim -c 'doautocmd VimEnter *' "$argv"
end
