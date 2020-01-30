nnoremap <silent><c-p> :<c-u>Clap files .<cr>
vnoremap <silent><c-p> :<c-u>Clap files .<cr>
nnoremap <silent> <leader>a viw:<c-u>call clap_config#visual_grep()<cr>
vnoremap <silent> <leader>a :<c-u>call clap_config#visual_grep()<cr>
nnoremap <silent> <leader>li :<c-u>Clap bLines<cr>
nnoremap <silent> <leader>hp :<c-u>Clap helptags<cr>
nnoremap <silent> <leader>cm :<c-u>Clap commands<cr>
nnoremap <silent> <leader>hi :<c-u>Clap command_history<cr>
nnoremap <silent> <leader>ft :<c-u>Clap filetypes<cr>

nnoremap <silent> <c-f> :<c-u>call clap_config#from_last_input("grep")<cr>

