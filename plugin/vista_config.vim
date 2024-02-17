let g:vista_icon_indent = ["╰─▸ ", "├─▸ "]

let g:vista#renderer#enable_icon = 1
let g:vista_default_executive = 'ctags'

nmap <leader>co <cmd>Vista!!<cr>

augroup vista_group
  autocmd!

  autocmd FileType python nnoremap <buffer><silent> gO <cmd>Vista!!<cr>
augroup end
