let g:vista_icon_indent = ["╰─▸ ", "├─▸ "]

let g:vista#renderer#enable_icon = 1
let g:vista_default_executive = 'ctags'

" Set the executive for some filetypes explicitly. Use the explicit executive
" instead of the default one for these filetypes when using `:Vista` without
" specifying the executive.
let g:vista_default_executive = "coc"

nmap <leader>co <cmd>Vista!!<cr>

augroup vista_group
  autocmd!

  autocmd FileType python nnoremap <buffer><silent> gO <cmd>Vista!!<cr>
augroup end
