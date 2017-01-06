noremap <leader>sb :Autoformat<cr>
let g:formatdef_sqlformat = '"sqlformat -k upper -r --indent_width=4 -"'
let g:formatdef_rubocop = '"rubocop --auto-correct " . expand("%") . " -o /dev/null || cat " . expand("%")'
let g:formatdef_standardjs = '"standard-format -"'
let g:formatters_sql = ['sqlformat']
let g:formatters_ruby = ['rubocop']
