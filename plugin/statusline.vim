function! StatuslineFugitiveBranch(...)
  if winwidth(0) < 80
    return ''
  endif

  if exists('*FugitiveHead')
    let branch = FugitiveHead()
    return branch !=# '' ? ''.branch : ''
  endif

  return ''
endfunction

function! CocStatus()
	  return coc#status()
endfunction

function! CocCurrentFunction()
  return get(b:,'coc_current_function', '')
endfunction
