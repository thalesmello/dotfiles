call auto#cmd('flagship_config', [
      \ 'User Flags call Hoist("buffer", -1, "WebDevIconsGetFileTypeSymbol")',
      \ 'User Flags call Hoist("buffer", "StatuslineFugitiveBranch")',
      \ 'User Flags call Hoist("window", "CocStatus")',
      \ 'User Flags call Hoist("window", "CocCurrentFunction")'
      \ ])

let g:flagship_skip = 'FugitiveStatusline\|flagship#filename'
