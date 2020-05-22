let g:airline#extensions#tmuxline#enabled = 0
let g:tmuxline_powerline_separators = 0
let window_icon = "#{?window_zoomed_flag,,}"
let window_icon = window_icon . "#{?window_activity_flag,,}"
let window_icon = window_icon . "#{?window_bell_flag,,}"
let empty_icon = "#{==:" . window_icon . ",}"
let window_icon = "#{?" . empty_icon . ",," . window_icon . " }"
let tab_name_generator = window_icon . "#{?#{==:#W,fish},#{b:pane_current_path}/,#W}"

let g:tmuxline_preset = {
      \ 'a'   : [' #(whoami)', '#S'],
      \ 'win'     : ['#I', tab_name_generator],
      \ 'cwin'    : ['#I', tab_name_generator],
      \ 'x'   : ['#{prefix_highlight}'],
      \ 'z'   : ['#{online_status}', '%R'],
      \ 'options' : {'status-justify' : 'left'}}
