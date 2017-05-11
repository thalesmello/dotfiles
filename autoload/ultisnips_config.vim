function! ultisnips_config#expand_snippet()
  call UltiSnips#ExpandSnippet()

  if g:ulti_expand_res
    return ''
  end

  call UltiSnips#JumpForwards()
  if g:ulti_jump_forwards_res
    return ''
  endif

  return "\<tab>"
endfunction

function! ultisnips_config#jump_or_expand_snippet()
  call UltiSnips#JumpForwards()
  if !g:ulti_jump_forwards_res
    call UltiSnips#ExpandSnippet()
  endif

  return ''
endfunction

