function! fzf_config#visual_ag()
  let selection = vim_utils#visual_selection()
  execute "Ag " . selection
endfunction

function! fzf_config#smart_ctrlp()
  if expand('%:p') =~ getcwd()
    Files
  else
    execute 'Files' projectroot#guess()
  endif
endfunction
