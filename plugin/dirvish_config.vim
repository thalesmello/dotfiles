if match(&runtimepath, 'dirvish') == -1
    finish
endif

nnoremap <silent><expr> - empty(expand('%')) ? "\<cmd>Dirvish\<cr>" : "\<cmd>Dirvish %:h\<cr>"

augroup dirvish_config
  autocmd!

  autocmd FileType dirvish silent! nnoremap <buffer> % :<C-U>edit %
  autocmd FileType dirvish silent! unmap <buffer> <c-p>
  autocmd FileType dirvish silent! unmap <buffer> <c-n>
augroup END
