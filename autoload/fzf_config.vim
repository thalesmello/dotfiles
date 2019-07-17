function! fzf_config#visual_ag()
  let selection = vim_utils#visual_selection()
  execute "Ag " . selection
endfunction
