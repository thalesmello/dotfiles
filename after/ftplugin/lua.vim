if exists("b:did_after_ftplugin")
  finish
endif
let b:did_after_ftplugin = 1

setlocal foldmethod=marker

let b:textobj_function_select = function('textobj_lua#select')
