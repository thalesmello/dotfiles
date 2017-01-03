function! autocmd#deferboot()
  augroup DeferBoot
    autocmd!
  augroup END

  doautocmd User Defer
endfunction
