command! ToggleLocalIndent call local_indent_config#toggle()
nnoremap <silent> <leader>ig :ToggleLocalIndent<cr>
highlight LocalIndentGuide guifg=#4E4E4E guibg=black gui=inverse ctermfg=5 ctermbg=0 cterm=inverse
