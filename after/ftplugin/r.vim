if exists("b:did_after_ftplugin")
  finish
endif
let b:did_after_ftplugin = 1

vmap <buffer> <localleader><CR> <localleader>sd
nmap <buffer> <localleader><CR> <localleader>d
nmap <buffer> <CR> <localleader>d
let b:delimitMate_matchpairs = "(:),[:],{:}"

augroup r_vim_settings
  autocmd!
  autocmd VimLeave * if exists("g:SendCmdToR") && string(g:SendCmdToR) != "function('SendCmdToR_fake')" | call RQuit("nosave") | endif
augroup END
