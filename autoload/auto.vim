function! auto#cmd(name, command)
  let name = substitute(a:name, " ", "_", "g")
  if type(a:command) == type([])
    let commands = a:command
  else
    let commands = [a:command]
  end

  execute "augroup auto_" . name
    autocmd!

    for command in commands
      execute "autocmd" command
    endfor
  augroup end
endfunction

function! auto#load_deferred()
  augroup DeferBoot
    autocmd!
  augroup END

  doautocmd User Defer
endfunction

function! auto#setup_defer()
  augroup DeferBoot
    autocmd!

    if has('vim_starting')
      autocmd CursorHold,CursorHoldI * call auto#load_deferred()
    endif
  augroup END
endfunction

function! auto#defer(function)
  call auto#cmd(a:function, "User Defer call " . a:function)
endfunction

function! auto#defer_cmd(cmd)
  call auto#cmd(a:cmd, "User Defer " . a:cmd)
endfunction
