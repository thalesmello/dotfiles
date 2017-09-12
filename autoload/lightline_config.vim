function! lightline_config#load()
  let g:lightline = {
        \ 'colorscheme': 'gruvbox',
        \ 'active': {
        \   'left': [['mode', 'paste'], ['filename'], ['ctrlpmark'], ['fugitive']],
        \   'right': [['ale', 'lineinfo', 'percent', 'lineindicator'], ['fileformat', 'fileencoding', 'filetype']]
        \ },
        \ 'component_function': {
        \   'fugitive': 'lightline_config#fugitive',
        \   'filename': 'lightline_config#filename',
        \   'fileformat': 'lightline_config#fileformat',
        \   'filetype': 'lightline_config#filetype',
        \   'fileencoding': 'lightline_config#fileencoding',
        \   'mode': 'lightline_config#mode',
        \   'ctrlpmark': 'lightline_config#ctrlpmark',
        \   'lineindicator': 'lightline_config#line_indicator'
        \ },
        \ 'component_type': {
        \   'ale': 'error'
        \ },
        \ 'component_expand': {
        \   'ale': 'ALEGetStatusLine'
        \ },
        \ 'separator': { 'left': '', 'right': '' },
        \ 'subseparator': { 'left': '', 'right': '' }
        \ }

    call auto#cmd('ale_statusline', 'User ALELint call lightline#update()')
endfunction

function! lightline_config#modified()
  return &ft =~ 'help' ? '' : &modified ? '+' : &modifiable ? '' : '-'
endfunction

function! lightline_config#readonly()
  return &ft !~? 'help' && &readonly ? '' : ''
endfunction

function! lightline_config#line_indicator()
  return LineNoIndicator()
endfunction

function! lightline_config#filename()
  let fname = pathshorten(expand('%'))
  return fname == 'ControlP' && has_key(g:lightline, 'ctrlp_item') ? g:lightline.ctrlp_item :
        \ fname == '__Tagbar__' ? g:lightline.fname :
        \ fname =~ '__Gundo\|NERD_tree' ? '' :
        \ &ft == 'vimfiler' ? vimfiler#get_status_string() :
        \ &ft == 'unite' ? unite#get_status_string() :
        \ &ft == 'vimshell' ? vimshell#get_status_string() :
        \ ('' != lightline_config#readonly() ? lightline_config#readonly() . ' ' : '') .
        \ ('' != fname ? fname : '[No Name]') .
        \ ('' != lightline_config#modified() ? ' ' . lightline_config#modified() : '')
endfunction

function! lightline_config#fugitive()
  try
    if expand('%:t') !~? 'Tagbar\|Gundo\|NERD' && &ft !~? 'vimfiler' && exists('*fugitive#head') && winwidth(0) > 80
      let mark = ''  " edit here for cool mark
      let branch = fugitive#head()
      return branch !=# '' ? mark.branch : ''
    endif
  catch
  endtry
  return ''
endfunction

function! lightline_config#fileformat()
  return winwidth(0) > 70 ? (&fileformat . ' ' . WebDevIconsGetFileFormatSymbol()) : ''
endfunction

function! lightline_config#filetype()
  return winwidth(0) > 70 ? (strlen(&filetype) ? WebDevIconsGetFileTypeSymbol() : '') : ''
endfunction

function! lightline_config#fileencoding()
  return winwidth(0) > 70 ? (&fenc !=# '' ? &fenc : &enc) : ''
endfunction

function! lightline_config#mode()
  let fname = expand('%:t')
  return fname == '__Tagbar__' ? 'Tagbar' :
        \ fname == 'ControlP' ? 'CtrlP' :
        \ fname == '__Gundo__' ? 'Gundo' :
        \ fname == '__Gundo_Preview__' ? 'Gundo Preview' :
        \ fname =~ 'NERD_tree' ? 'NERDTree' :
        \ &ft == 'unite' ? 'Unite' :
        \ &ft == 'vimfiler' ? 'VimFiler' :
        \ &ft == 'vimshell' ? 'VimShell' :
        \ winwidth(0) > 60 ? lightline#mode() : ''
endfunction

function! lightline_config#ctrlpmark()
  if expand('%:t') =~ 'ControlP' && has_key(g:lightline, 'ctrlp_item')
    call lightline#link('iR'[g:lightline.ctrlp_regex])
    return lightline#concatenate([g:lightline.ctrlp_prev, g:lightline.ctrlp_item
          \ , g:lightline.ctrlp_next], 0)
  else
    return ''
  endif
endfunction

let g:ctrlp_status_func = {
  \ 'main': 'CtrlPStatusFunc_1',
  \ 'prog': 'CtrlPStatusFunc_2',
  \ }

function! CtrlPStatusFunc_1(focus, byfname, regex, prev, item, next, marked)
  let g:lightline.ctrlp_regex = a:regex
  let g:lightline.ctrlp_prev = a:prev
  let g:lightline.ctrlp_item = a:item
  let g:lightline.ctrlp_next = a:next
  return lightline#statusline(0)
endfunction

function! CtrlPStatusFunc_2(str)
  return lightline#statusline(0)
endfunction

let g:tagbar_status_func = 'TagbarStatusFunc'

function! TagbarStatusFunc(current, sort, fname, ...) abort
    let g:lightline.fname = a:fname
  return lightline#statusline(0)
endfunction

let g:unite_force_overwrite_statusline = 0
let g:vimfiler_force_overwrite_statusline = 0
let g:vimshell_force_overwrite_statusline = 0
