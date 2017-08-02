let g:ulti_expand_res = 0
let g:ulti_jump_forwards_res = 0
let g:UltiSnipsEditSplit           = "vertical"
xnoremap <silent> <tab> :call UltiSnips#SaveLastVisualSelection()<CR>gvs
let g:UltiSnipsRemoveSelectModeMappings = 0
imap <silent> <Tab> <c-r>=ultisnips_config#expand_snippet()<cr>
let g:UltiSnipsExpandTrigger		= "<Plug>(ultisnips_expand)"
let g:UltiSnipsJumpBackwardTrigger = "<c-h>"
let g:UltiSnipsJumpForwardTrigger  = "<c-l>"
let g:UltiSnipsSnippetsDir         = '~/.snips'
let g:UltiSnipsSnippetDirectories  = ["UltiSnips", $HOME . "/.snips"]
imap <c-j> <nop>
inoremap <c-x><c-k> <c-x><c-k>
nmap <leader>esp :UltiSnipsEdit<cr>

call auto#cmd('set_snippets_filetype', 'BufRead *.snippets setlocal filetype=snippets')

