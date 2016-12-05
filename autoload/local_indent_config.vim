let s:LocalIndentState = 0

function! local_indent_config#toggle()
  if s:LocalIndentState
    LocalIndentGuide -hl
  else
    LocalIndentGuide +hl
  endif

  let s:LocalIndentState = !s:LocalIndentState
endfunction
