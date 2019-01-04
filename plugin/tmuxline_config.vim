let g:airline#extensions#tmuxline#enabled = 0
let s:computer_emoji = '💻'
let tab_name_generator = "#(
       \ echo '#F' |
       \ sed 's/[^Z!##]//g' |
       \ sed 's/Z//g' |
       \ sed 's/!//g' |
       \ sed 's/##//g' |
       \ sed -E 's/$/ /g' |
       \ sed -E 's/^ $//g'
       \ )#{?#{==:#W,fish},#{b:pane_current_path},#W}/"

let g:tmuxline_preset = {
      \ 'a'   : [s:computer_emoji . '  #(whoami)', '#S'],
      \ 'win'     : ['#I', tab_name_generator],
      \ 'cwin'    : ['#I', tab_name_generator],
      \ 'x'   : ['#{prefix_highlight}'],
      \ 'z'   : ['#{cpu_icon}#{cpu_percentage}', '#{online_status}', '#{battery_icon} #{battery_percentage}', '%R'],
      \ 'options' : {'status-justify' : 'left'}}

