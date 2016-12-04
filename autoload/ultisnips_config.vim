
function! ultisnips_config#expand_snippet()
  call UltiSnips#ExpandSnippet()

  if g:ulti_expand_res
    return ""
  elseif pumvisible()
    return "\<c-n>"
  else
    return "\<tab>"
  end
endf

function! ultisnips_config#jump_or_expand_snippet()
  call UltiSnips#JumpForwards()
  if !g:ulti_jump_forwards_res
    call UltiSnips#ExpandSnippet()
  endif

  return ''
endfunction

