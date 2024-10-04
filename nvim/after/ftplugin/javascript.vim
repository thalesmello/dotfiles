if exists("b:did_after_ftplugin")
  finish
endif
let b:did_after_ftplugin = 1

setlocal formatoptions-=c formatoptions-=r formatoptions-=o
set foldmethod=syntax
