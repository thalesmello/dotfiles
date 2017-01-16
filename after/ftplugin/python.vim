if exists("b:did_after_ftplugin")
  finish
endif
let b:did_after_ftplugin = 1

" Vimux config
vmap <buffer> <silent> <localleader>vs :call VimuxSlimeLineBreak()<CR>`>j^
nmap <buffer> <silent> <localleader><CR> V:call vimux_config#slime()<CR>`>j^

" Enable preview because Jedi doesn't support echodoc
setlocal completeopt+=preview
