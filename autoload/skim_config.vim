function! skim_config#ag(dir, ...)
  let dir = empty(a:dir) ? '.' : a:dir
  return s:skim(s:skim_vim_wrap({
  \ 'source': "none",
  \ 'sink*':    function('s:ag_handler'),
  \ 'options': "-m -i -c \"ag --nogroup --column --color ".get(g:, 'ag_opts', '')." '{}' " . dir . ' " '.
  \            '--ansi --prompt "Ag> " --bind alt-a:select-all,alt-d:deselect-all,alt-b:scroll-left,alt-f:scroll-right '
  \            }), a:000)
endfunction

function! s:ag_handler(lines)
  if len(a:lines) < 2
    return
  endif

  let cmd = get(get(g:, 'skim_action', s:default_action), a:lines[0], 'e')
  let list = map(a:lines[1:], 's:ag_to_qf(v:val)')

  let first = list[0]
  try
    call s:open(cmd, first.filename)
    execute first.lnum
    execute 'normal!' first.col.'|zz'
  catch
  endtry

  if len(list) > 1
    call setqflist(list)
    copen
    wincmd p
  endif
endfunction

let s:default_action = {
  \ 'ctrl-t': 'tab split',
  \ 'ctrl-x': 'split',
  \ 'ctrl-v': 'vsplit' }

function! s:skim_vim_wrap(opts)
  return extend(copy(a:opts), {
  \ 'options': get(a:opts, 'options', '').' --expect='.join(keys(get(g:, 'skim_action', s:default_action)), ','),
  \ 'sink*':   get(a:opts, 'sink*', function('s:common_sink'))})
endfunction

function! s:escape(path)
  return escape(a:path, ' $%#''"\')
endfunction

function! s:common_sink(lines) abort
  if len(a:lines) < 2
    return
  endif
  let key = remove(a:lines, 0)
  let cmd = get(get(g:, 'skim_action', s:default_action), key, 'e')
  if len(a:lines) > 1
    augroup skim_swap
      autocmd SwapExists * let v:swapchoice='o'
            \| call s:warn('skim: E325: swap file exists: '.expand('<afile>'))
    augroup END
  endif
  try
    let empty = empty(expand('%')) && line('$') == 1 && empty(getline(1)) && !&modified
    let autochdir = &autochdir
    set noautochdir
    for item in a:lines
      if empty
        execute 'e' s:escape(item)
        let empty = 0
      else
        call s:open(cmd, item)
      endif
      if exists('#BufEnter') && isdirectory(item)
        doautocmd BufEnter
      endif
    endfor
  finally
    let &autochdir = autochdir
    silent! autocmd! skim_swap
  endtry
endfunction

function! skim_config#layout(...)
  return (a:0 && a:1) ? {} : copy(get(g:, 'skim_layout', s:skim_default_layout))
endfunction

function! s:skim(opts, extra)
  let extra  = empty(a:extra) ? skim_config#layout() : a:extra[0]
  let eopts  = has_key(extra, 'options') ? remove(extra, 'options') : ''
  let merged = extend(copy(a:opts), extra)
  let merged.options = join(filter([s:defaults(), get(merged, 'options', ''), eopts], '!empty(v:val)'))
  return skim#run(merged)
endfunction

function! s:defaults()
  let rules = copy(get(g:, 'skim_colors', {}))
  let colors = join(map(items(filter(map(rules, 'call("s:get_color", v:val)'), '!empty(v:val)')), 'join(v:val, ":")'), ',')
  return empty(colors) ? '' : ('--color='.colors)
endfunction

function! s:ag_to_qf(line)
  let parts = split(a:line, ':')
  return {'filename': &acd ? fnamemodify(parts[0], ':p') : parts[0], 'lnum': parts[1], 'col': parts[2],
        \ 'text': join(parts[3:], ':')}
endfunction

function! s:open(cmd, target)
  if stridx('edit', a:cmd) == 0 && fnamemodify(a:target, ':p') ==# expand('%:p')
    return
  endif
  execute a:cmd s:escape(a:target)
endfunction

let s:skim_default_layout = {'down': '~40%'}

