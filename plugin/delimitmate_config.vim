imap <expr> <c-x><c-l> delimitmate_config#completion("\<c-l>")

let g:delimitMate_expand_space = 1
let g:delimitMate_expand_cr = 1
let g:delimitMate_nesting_quotes = ['"','`', "'"]

if has('vim_starting')
  imap <CR> <C-G>u<Plug>delimitMateCR
endif

autocmd User MultipleCursorsPre DelimitMateOff
autocmd User MultipleCursorsPost DelimitMateOn
