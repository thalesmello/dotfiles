command! -bang -nargs=* InteractiveAg                   call skim_config#ag(<q-args>, skim_config#layout(<bang>0))
nnoremap <silent> <c-f> :InteractiveAg<cr>

let g:skim_history_dir = '~/.local/share/skim-history'

