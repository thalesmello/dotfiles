#!/opt/homebrew/bin/fish

set all_wins (aerospace list-windows --all --format '%{window-id}==|||==%{app-name}==|||==%{window-title}==|||==%{monitor-id}==|||==%{workspace}')

function __aerospace_move_win_startup -a winpattern -a target_ws
  set winlines (string match -e -r "$winpattern" $all_wins)

  for winline in $winlines
    echo $winline | read -d "==|||==" -l win_id win_app win_title win_mon win_ws

    aerospace move-node-to-workspace --window-id $win_id $target_ws
  end

end


if test "$USER_BTT_CONTEXT" = "meta"
  __aerospace_move_win_startup 'Thales \(Personal\)' '7'
end
