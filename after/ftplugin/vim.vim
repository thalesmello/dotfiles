if exists("b:did_after_ftplugin")
  finish
endif
let b:did_after_ftplugin = 1

setlocal foldlevel=0
setlocal foldmethod=marker
setlocal omnifunc=neco_config#complete

if !empty(&buftype)
  inoremap <silent><buffer> <TAB> <c-x><c-o>

  nnoremap <buffer> <esc> :q<cr>
endif

