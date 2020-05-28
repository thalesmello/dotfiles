if match(&runtimepath, 'dirvish') == -1
    finish
endif

nnoremap <silent> - <cmd>Dirvish %:h<cr>

augroup dirvish_config
  autocmd!

  autocmd FileType dirvish nnoremap <buffer> % :<C-U>edit %
augroup END
