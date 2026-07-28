# Completions for stowman

# Resolve the dotfiles directory, honoring --dotdir given on the command line,
# then STOWMAN_DOTDIR, then the built-in default.
function __stowman_dotdir
  set -l tokens (commandline -opc)
  set -l i 1
  while test $i -le (count $tokens)
    switch $tokens[$i]
      case '--dotdir=*'
        echo (string replace -- '--dotdir=' '' $tokens[$i])
        return
      case '--dotdir'
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
    echo $HOME/src/dotfiles
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

# Global options: --dotdir and --homedir expand to directories
complete -c stowman -l dotdir -r -f -a "(__fish_complete_directories)" -d "Override the dotfiles directory"
complete -c stowman -l homedir -r -f -a "(__fish_complete_directories)" -d "Override the target home directory"

# `reload` takes a module name or "all"
complete -c stowman -n "__fish_seen_subcommand_from reload" -f -a "all" -d "All packages"
complete -c stowman -n "__fish_seen_subcommand_from reload" -f -a "(__stowman_modules)" -d "module"

# Count the positional arguments already given after the subcommand,
# skipping global options (--dotdir/--homedir) and their values.
function __stowman_arg_index
  set -l tokens (commandline -opc)
  set -l count 0
  set -l seen_cmd 0
  set -l i 2 # skip the command name itself
  while test $i -le (count $tokens)
    switch $tokens[$i]
      case '--dotdir=*' '--homedir=*'
        # inline value, nothing to skip
      case '--dotdir' '--homedir'
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
