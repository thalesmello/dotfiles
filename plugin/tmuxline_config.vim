let g:airline#extensions#tmuxline#enabled = 0
let s:computer_emoji = '💻'
let g:tmuxline_preset = {
      \'a'       : [s:computer_emoji . '  #(whoami)', '#S'],
      \'win'     : ['#I', '#W'],
      \'cwin'    : ['#I', '#W'],
      \'x'       : ['#{prefix_highlight}'],
      \'z'       : ['#{cpu_icon}#{cpu_percentage}', '#{online_status}', '#{battery_icon} #{battery_percentage}', '%R'],
      \'options' : {'status-justify' : 'left'}}

