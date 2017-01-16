command! -bang -nargs=* InteractiveAg                   call skim_config#ag(<q-args>, skim_config#layout(<bang>0))
nnoremap <silent> <c-f> :InteractiveAg<cr>

