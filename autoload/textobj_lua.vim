function! textobj_lua#select(mode)
  if !exists('g:loaded_matchit')
    echoerr 'textobj_lua: Plugin requires matchit'
    return 0
  endif

  return textobj_lua#select_{a:mode}()
endfunction

function! textobj_lua#select_a()
  call search('\<function\>', 'b')
  let begin = getpos('.')
  normal %e
  let end = getpos('.')
  return ['v', begin, end]
endfunction

function! textobj_lua#select_i()
  call search('\<function\>', 'b')
  normal! %W
  let begin = getpos('.')
  call search('\<function\>', 'b')
  normal %gE
  let end = getpos('.')
  if begin[1] == end[1]
    return ['v', begin, end]
  else
    return ['V', begin, end]
  endif
endfunction
