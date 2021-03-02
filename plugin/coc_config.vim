if match(&runtimepath, 'coc.nvim') == -1
    finish
endif

call coc#add_extension(
	  \ 'coc-highlight',
	  \ 'coc-python',
	  \ 'coc-json',
	  \ 'coc-pairs',
	  \ 'coc-yaml',
	  \ 'coc-actions',
	  \ 'coc-vimlsp',
	  \ 'coc-snippets'
	  \)

nmap <silent> [g <Plug>(coc-diagnostic-prev)
nmap <silent> ]g <Plug>(coc-diagnostic-next)

nmap <silent> <leader><c-]> <Plug>(coc-definition)
nmap <silent> K <cmd>call <SID>show_documentation()<CR>
nmap <silent> gr <Plug>(coc-rename)
nmap <silent> gR <Plug>(coc-refactor)
nmap <silent> gI <Plug>(coc-implementation)
nmap <silent> gy <Plug>(coc-type-definition)

function! s:show_documentation()
  if (index(['vim','help'], &filetype) >= 0)
    execute 'h '.expand('<cword>')
  else
    call CocAction('doHover')
  endif
endfunction


xmap <silent> <leader>fm <Plug>(coc-format-selected)
nmap <silent> <leader>fm <Plug>(coc-format-selected)

nmap <silent> <leader>.  <cmd>CocFix<cr>

function! s:cocActionsOpenFromSelected(type) abort
  let oldreg = getreg('a')
  if a:type == 'line'
    silent exe "normal! '[V']y"
  else
    silent exe "normal! `[v`]y"
  endif
  call setreg("a", oldreg)
  execute 'CocCommand actions.open ' . visualmode()
endfunction

xmap <silent> <leader>a :<C-u>execute 'CocCommand actions.open ' . visualmode()<CR>
nmap <silent> <leader>a :<C-u>set operatorfunc=<SID>cocActionsOpenFromSelected<CR>g@
nmap <silent> <leader>A <cmd>CocCommand actions.open<CR>

inoremap <silent><expr> <c-space> coc#refresh()

command! -nargs=0 Format :call CocAction('format')
command! -nargs=? Fold :call CocAction('fold', <f-args>)
command! -nargs=0 OR :call CocAction('runCommand', 'editor.action.organizeImport')

nnoremap <silent> <leader>cd <cmd>CocList diagnostics<cr>
nnoremap <silent> <leader>ce <cmd>CocList extensions<cr>
nnoremap <silent> <leader>cc <cmd>CocList commands<cr>
nnoremap <silent> <leader>cs <cmd>CocList -I symbols<cr>
nnoremap <silent> <leader>cl <cmd>CocList lists<cr>
nmap <silent> <leader>cr <Plug>(coc-references)
nnoremap <silent> <leader>C <cmd>CocListResume<CR>

nnoremap <silent> <leader>]  :<C-u>CocNext<CR>
nnoremap <silent> <leader>[  :<C-u>CocPrev<CR>

nnoremap <leader>? <cmd>call CocActionAsync('showSignatureHelp')<cr>

augroup cocvim_group
  autocmd!
  " Setup formatexpr specified filetype(s).
  " autocmd FileType python,json setl formatexpr=CocAction('formatSelected')

  autocmd FileType python setlocal tagfunc=CocTagFunc
  " Update signature help on jump placeholder.
  autocmd User CocJumpPlaceholder call CocActionAsync('showSignatureHelp')
  " Highlight the symbol and its references when holding the cursor.
  autocmd CursorHold * silent call CocActionAsync('highlight')
  call auto#cmd('set_snippets_filetype', 'BufRead *.snippets setlocal filetype=snippets')
augroup end


nmap <leader>esp <cmd>CocCommand snippets.editSnippets<cr>
xmap <tab> <Plug>(coc-snippets-select)

let g:coc_snippet_next = '<c-l>'
let g:coc_snippet_prev = '<c-h>'

inoremap <silent><expr> <TAB>
      \ pumvisible() ? coc#_select_confirm() :
      \ coc#expandableOrJumpable() ? "\<C-r>=coc#rpc#request('doKeymap', ['snippets-expand-jump',''])\<CR>" :
      \ <SID>check_back_space() ? "\<TAB>" :
      \ coc#refresh()



function! s:check_back_space() abort
  let col = col('.') - 1
  return !col || getline('.')[col - 1]  =~# '\s'
endfunction


if !exists("g:mapped_coc_cr")
  let g:mapped_coc_cr = 1
  inoremap <silent><expr> <Plug>CustomCocCR pumvisible() && complete_info()["selected"] != "-1" ? "\<c-y>" : "\<C-g>u\<CR>\<c-r>=coc#on_enter()\<CR>"
  imap <CR> <Plug>CustomCocCR
endif

function! CocSmartSelectRange(visual)
    let multiple_cursors_active = get(b:, 'coc_cursors_activated', 0)
    if a:visual && multiple_cursors_active
        let response = "\<esc>ngn\<Plug>(coc-cursors-range)gv"
    elseif a:visual && !multiple_cursors_active
        let response = "y/\\V\<C-r>=escape(@\",'/\\')\<CR>\<CR>gv\<Plug>(coc-cursors-range)gv"
    elseif !a:visual && multiple_cursors_active
        let response = "*\<Plug>(coc-cursors-word)"
    else
        let response = "*N\<Plug>(coc-cursors-word)"
    endif

    return response . "\<cmd>nohlsearch\<cr>"
endfunction

nmap <silent><expr> <Plug>CocSmartSelectRange CocSmartSelectRange(0)
xmap <silent><expr> <Plug>VCocSmartSelectRange CocSmartSelectRange(1)

nmap <silent> <C-b> <Plug>CocSmartSelectRange
xmap <silent> <C-b> <Plug>VCocSmartSelectRange

nmap <silent><expr> <c-x> get(b:, 'coc_cursors_activated', 0) ? "\<Plug>(coc-cursors-word)" : "\<C-x>"
xmap <silent><expr> <c-x> get(b:, 'coc_cursors_activated', 0) ? "\<Plug>(coc-cursors-range)" : "\<C-x>"

nmap <leader><c-b> :CocSearch<space>
