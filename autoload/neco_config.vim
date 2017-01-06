function! neco_config#complete(findstart, base)
  if a:findstart
	let str = necovim#get_complete_position(getline('.'))
	echom str
    return str
  else
	let candidates = necovim#gather_candidates(getline('.'), a:base)
	let candidates = map(candidates, 'v:val.word')
	let candidates = filter(candidates, 'v:val =~ "^" . a:base')
	echom string(candidates)
    return candidates
  endif
endfunction

