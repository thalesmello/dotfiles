call auto#defer("plug#load('ultisnips')")

let g:ulti_expand_res = 0
let g:ulti_jump_forwards_res = 0
let g:UltiSnipsEditSplit           = "vertical"
xnoremap <silent> <tab> :call UltiSnips#SaveLastVisualSelection()<CR>gvs
inoremap <silent> <c-l> <c-r>=ultisnips_config#jump_or_expand_snippet()<cr>
imap <silent> <Tab> <c-r>=ultisnips_config#expand_snippet()<cr>
let g:UltiSnipsExpandTrigger       = "<c-x><c-x><tab>"
let g:UltiSnipsJumpBackwardTrigger = "<c-h>"
let g:UltiSnipsJumpForwardTrigger  = "<c-l>"
let g:UltiSnipsSnippetsDir         = '~/.snips'
let g:UltiSnipsSnippetDirectories  = ["UltiSnips", $HOME . "/.snips"]
imap <c-j> <nop>
inoremap <c-x><c-k> <c-x><c-k>
nmap <leader>esp :UltiSnipsEdit<cr>

call auto#cmd('set_snippets_filetype', 'BufRead *.snippets setlocal filetype=snippets')

