call auto#cmd('flagship_config', [
      \ 'User Flags call Hoist("buffer", -1, "WebDevIconsGetFileTypeSymbol")',
      \ 'User Flags call Hoist("window", "StatuslineAleMessages")',
      \ 'User Flags call Hoist("buffer", "StatuslineFugitiveBranch")',
      \ 'User Flags call Hoist("window", "CocStatus")',
      \ 'User Flags call Hoist("window", "%{get(b:,\"coc_current_function\",\"\")}")'
      \ ])

function! CocStatus()
	  return coc#status()
endfunction

let g:flagship_skip = 'FugitiveStatusline\|flagship#filename'
