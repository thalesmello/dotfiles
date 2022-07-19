function! fzf_config#visual_ag(word_boundary)
  let selection = vim_utils#visual_selection()
  if a:word_boundary
    execute 'Ag \b' . selection . '\b'
  else
    execute "Ag " . selection
  endif
endfunction
