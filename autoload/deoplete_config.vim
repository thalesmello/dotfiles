
function! deoplete_config#multiple_cursors_switch(before)
  if !exists('g:loaded_deoplete')
    return
  endif

  if a:before
    let s:old_disable_deoplete = g:deoplete#disable_auto_complete
    let g:deoplete#disable_auto_complete = 1
  else
    let g:deoplete#disable_auto_complete = s:old_disable_deoplete
  endif
endfunction

function! deoplete_config#arrow_navigation(direction)
  let pumNavigation = { 'Down': "\<C-N>", 'Up': "\<C-P>" }
  let arrowNavigation = { 'Down': "\<Down>", 'Up': "\<Up>" }

  if pumvisible()
    return pumNavigation[a:direction]
  endif

  return arrowNavigation[a:direction]
endfunction
