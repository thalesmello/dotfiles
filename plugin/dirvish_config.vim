if match(&runtimepath, 'dirvish') == -1
    finish
endif

nnoremap <silent> - <cmd>Dirvish %<cr>
