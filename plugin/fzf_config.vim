nnoremap <silent><c-p> :<c-u>call fzf_config#smart_ctrlp()<cr>
vnoremap <silent><c-p> :<c-u>call fzf_config#smart_ctrlp()<cr>

" let g:fzf_history_dir = '~/.local/share/fzf-history'

nnoremap <silent> <leader>a :<c-u>Ag <c-r><c-w><cr>
vnoremap <silent> <leader>a :<c-u>call fzf_config#visual_ag()<cr>
nnoremap <silent> <leader>li :BLines<cr>
nnoremap <silent> <leader>hp :Helptags<cr>
nnoremap <silent> <leader>cm :Commands<cr>
nnoremap <silent> <leader>hi :History:<cr>
nnoremap <silent> <leader>ft :Filetypes<cr>

