let g:deoplete#omni#input_patterns = {}
let g:deoplete#omni#input_patterns.ruby = ['[^. *\t]\.\w*', '[a-zA-Z_]\w*::']
let g:deoplete#omni#input_patterns.vimwiki = '\[\[.*'

let g:deoplete#enable_at_startup = 1
let g:deoplete#file#enable_buffer_path = 1

call auto#cmd('preview_window', 'InsertLeave * if empty(&buftype) | pclose! | endif')

inoremap <silent> <up> <c-r>=deoplete_config#arrow_navigation('Up')<CR>
inoremap <silent> <Down> <c-r>=deoplete_config#arrow_navigation('Down')<CR>
inoremap <expr><C-l> deoplete#refresh()

imap <expr> <c-x><c-p> deoplete_config#repeated_completion("\<c-p>")
imap <expr> <c-x><c-n> deoplete_config#repeated_completion("\<c-n>")
