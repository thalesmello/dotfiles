call auto#cmd('surround', [
      \ 'FileType python let b:surround_101 = "f\"\r\""',
      \ 'FileType python let b:surround_113 = "\"\"\"\r\"\"\""',
      \ 'FileType elixir let b:surround_109 = "%{\r}"',
      \ 'FileType markdown let b:surround_113 = "```\r```"'
      \])

nmap <silent> dsf ds)db<Cmd>call repeat#set("dsf", 0)<cr>
nnoremap <silent> csf [(cb<Cmd>call repeat#set("csf", 0)<cr>
