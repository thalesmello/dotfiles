function! denite_config#visual_ag()
  let path = s:get_project_path()
  let selection = vim_utils#visual_selection()
  call denite_config#ag(selection)
endfunction

function! denite_config#ag(pattern)
  let path = s:get_project_path()
  call denite#start([{'name': 'grep', 'args': [path, '', a:pattern]}])
endfunction

function! denite_config#smart_ctrlp()
  let path = s:get_project_path()
  call denite#start([{'name': 'file_rec', 'args': [path]}])
endfunction

function! denite_config#smart_interactive_ag()
  let path = s:get_project_path()
  call denite#start([{'name': 'grep', 'args': [path, '', '!']}])
endfunction

function! s:get_project_path()
  if $HOME ==# getcwd()
    return projectroot#guess()
  elseif s:start_with(expand('%:p'), getcwd())
    return ''
  else
    return projectroot#guess()
  endif
endfunction

function! s:start_with(base, part)
  if len(a:base) < len(a:part)
    return 0
  endif

  let base_start = a:base[0:len(a:part) - 1]
  return base_start ==# a:part
endfunction
