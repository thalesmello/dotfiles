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


function! StatuslineAleMessages(...)
  if match(&runtimepath, 'ale/') == -1
      return ''
  endif

  let counts = ale#statusline#Count(bufnr(''))

  if counts.total == 0
	return ''
  endif

  let errors = counts.error + counts.style_error
  let warnings = counts.total - errors

  let messages = []

  if warnings > 0
	call add(messages, warnings." warn")
  endif

  if errors > 0
	call add(messages, errors." err")
  endif

  return join(messages, ", ")
endfunction

function! CocStatus()
	  return coc#status()
endfunction

function! CocCurrentFunction()
  return get(b:,"coc_current_function", "")
endfunction
