function! tmuxline_config#load_theme()
  let g:_tmuxline_config_pallete = lightline#palette()
  let g:_tmuxline_config_pallete_mode = "normal"
  let g:tmuxline_theme = tmuxline#util#create_theme_from_lightline(
        \ g:_tmuxline_config_pallete[g:_tmuxline_config_pallete_mode])

  let g:tmuxline_theme.win = [g:tmuxline_theme.cwin[0], g:tmuxline_theme.cwin[1], "dim"]
  let g:tmuxline_theme.cwin = [g:tmuxline_theme.cwin[0], g:tmuxline_theme.cwin[1], "nodim, bold"]
  Tmuxline
endfunction
