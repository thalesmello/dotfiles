# Completions for stowman

# Directory of the stowman script itself (resolving symlinks), used to locate
# the default stow dir and its sibling repos.
function __stowman_script_dir
  set -l p (command -v stowman)
  test -n "$p"; or return
  set -l real (realpath "$p" 2>/dev/null; or echo "$p")
  dirname "$real"
end

# Extra directories to always offer for --dir: this repo's stow_modules and
# the sibling meta-dotfiles/stow_modules, resolved relative to the script.
function __stowman_extra_dotdirs
  set -l base (__stowman_script_dir)
  test -n "$base"; or return
  set -l repo (builtin cd "$base/.." 2>/dev/null; and pwd)
  and printf '%s\n' "$repo/stow_modules"
  set -l parent (builtin cd "$base/../.." 2>/dev/null; and pwd)
  and printf '%s\n' "$parent/meta-dotfiles/stow_modules"
end

# Directory completions plus the always-included stow_modules directories.
function __stowman_dotdir_candidates
  __fish_complete_directories
  __stowman_extra_dotdirs
end

# Resolve the dotfiles directory, honoring --dir given on the command line,
# then STOWMAN_DOTDIR, then the built-in default.
function __stowman_dotdir
  set -l tokens (commandline -opc)
  set -l i 1
  while test $i -le (count $tokens)
    switch $tokens[$i]
      case '--dir=*'
        echo (string replace -- '--dir=' '' $tokens[$i])
        return
      case '--dir'
        set -l next (math $i + 1)
        if test $next -le (count $tokens)
          echo $tokens[$next]
          return
        end
    end
    set i (math $i + 1)
  end

  if set -q STOWMAN_DOTDIR
    echo $STOWMAN_DOTDIR
  else
    set -l base (__stowman_script_dir)
    if test -n "$base"
      builtin cd "$base/.." 2>/dev/null; and echo (pwd)/stow_modules
    else
      echo $HOME/src/dotfiles/stow_modules
    end
  end
end

# List module names (top-level directories) inside the dotfiles directory.
function __stowman_modules
  set -l dir (eval echo (__stowman_dotdir))
  test -d "$dir"; or return
  for d in $dir/*/
    echo (string trim -r -c / (basename $d))
  end
end

# Subcommands
complete -c stowman -n "__fish_is_first_token" -f -a "init" -d "Initialize a new config from a repo"
complete -c stowman -n "__fish_is_first_token" -f -a "add" -d "Add a file/folder to a package"
complete -c stowman -n "__fish_is_first_token" -f -a "reload" -d "Apply changes to a package or all packages"
complete -c stowman -n "__fish_is_first_token" -f -a "push" -d "Push changes to the repository"
complete -c stowman -n "__fish_is_first_token" -f -a "pull" -d "Pull changes from the repository"
complete -c stowman -n "__fish_is_first_token" -f -a "list" -d "List stowed files and folders"
complete -c stowman -n "__fish_is_first_token" -f -a "help" -d "Show help"

# Global options: --dir and --homedir expand to directories
complete -c stowman -l dir -r -f -a "(__stowman_dotdir_candidates)" -d "Override the stow directory"
complete -c stowman -l homedir -r -f -a "(__fish_complete_directories)" -d "Override the target home directory"

# `reload` takes a module name or "all"
complete -c stowman -n "__fish_seen_subcommand_from reload" -f -a "all" -d "All packages"
complete -c stowman -n "__fish_seen_subcommand_from reload" -f -a "(__stowman_modules)" -d "module"

# Count the positional arguments already given after the subcommand,
# skipping global options (--dir/--homedir) and their values.
function __stowman_arg_index
  set -l tokens (commandline -opc)
  set -l count 0
  set -l seen_cmd 0
  set -l i 2 # skip the command name itself
  while test $i -le (count $tokens)
    switch $tokens[$i]
      case '--dir=*' '--homedir=*'
        # inline value, nothing to skip
      case '--dir' '--homedir'
        set i (math $i + 1) # skip the option's value
      case '*'
        if test $seen_cmd -eq 0
          set seen_cmd 1 # this is the subcommand
        else
          set count (math $count + 1)
        end
    end
    set i (math $i + 1)
  end
  echo $count
end

# `add <src> <pkg>`: first arg is a path, second is a module name
complete -c stowman -n "__fish_seen_subcommand_from add; and test (__stowman_arg_index) -eq 0" -F -d "source path"
complete -c stowman -n "__fish_seen_subcommand_from add; and test (__stowman_arg_index) -eq 1" -f -a "(__stowman_modules)" -d "module"
