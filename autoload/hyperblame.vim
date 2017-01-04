function! hyperblame#open()
  let file = expand('%')
  let line = line('.')
  let type = &filetype
  tabnew
  execute "-1r! git hyper-blame -i 050270c -i f0a0054 -i 94b1d49 -i 328db36" file
  execute line
  execute "setfiletype" type
endfunction
