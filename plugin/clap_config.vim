nnoremap <silent><c-p> :<c-u>Clap files .<cr>
vnoremap <silent><c-p> :<c-u>Clap files .<cr>
nnoremap <silent> <leader>a :<c-u>Clap grep . ++query=<cword><CR>
vnoremap <silent> <leader>a :<c-u>Clap grep . ++query=@visual<CR>
nnoremap <silent> <leader>li :<c-u>Clap bLines<cr>
nnoremap <silent> <leader>hp :<c-u>Clap helptags<cr>
nnoremap <silent> <leader>cm :<c-u>Clap commands<cr>
nnoremap <silent> <leader>hi :<c-u>Clap command_history<cr>
nnoremap <silent> <leader>ft :<c-u>Clap filetypes<cr>

nnoremap <silent> <c-f> :<c-u>call clap_config#from_last_input("grep")<cr>

augroup ClapAutoCloseOnFocusOut
	autocmd!
	autocmd User ClapOnEnter call clap_config#on_clap_enter()
augroup end
