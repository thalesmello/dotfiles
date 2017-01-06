command! -range VisualCommand <line1>,<line2>call vim_utils#visual_command()
vnoremap <leader>\| :VisualCommand<CR>
