# Completions for GNU stow.
#
# The main value-add over the man-page-generated completion is completing
# package (module) names from the stow directory. The stow dir is resolved by
# parsing -d/--dir from the command line, then falling back to --dir declared
# in a .stowrc in the current directory, then to the current directory itself.

# Resolve the stow directory the same way stow does when picking packages.
function __stow_dir
  set -l tokens (commandline -opc)
  set -l i 1
  while test $i -le (count $tokens)
    switch $tokens[$i]
      case '--dir=*'
        echo (string replace -- '--dir=' '' $tokens[$i])
        return
      case '-d' '--dir'
        set -l next (math $i + 1)
        if test $next -le (count $tokens)
          echo $tokens[$next]
          return
        end
    end
    set i (math $i + 1)
  end

  # Fall back to --dir declared in a .stowrc (one option per line).
  if test -f .stowrc
    for line in (cat .stowrc)
      set -l opt (string trim -- $line)
      switch $opt
        case '--dir=*'
          echo (string replace -- '--dir=' '' $opt)
          return
        case '-d *' '--dir *'
          echo (string split -f2 ' ' $opt)
          return
      end
    end
  end

  echo .
end

# List package names (top-level directories) inside the stow directory.
function __stow_packages
  set -l dir (eval echo (__stow_dir))
  test -d "$dir"; or return
  for d in $dir/*/
    echo (string trim -r -c / (basename $d))
  end
end

# Options.
complete -c stow -s n -l no -l simulate -d "Do not perform any operations, just simulate"
complete -c stow -s d -l dir -r -a "(__fish_complete_directories)" -d "Set the stow directory"
complete -c stow -s t -l target -r -a "(__fish_complete_directories)" -d "Set the target directory"
complete -c stow -s v -l verbose -d "Increase verbosity"
complete -c stow -s S -l stow -d "Stow the packages (default)"
complete -c stow -s D -l delete -d "Unstow the packages"
complete -c stow -s R -l restow -d "Restow (unstow then stow again)"
complete -c stow -l adopt -d "Import existing files into the package"
complete -c stow -l no-folding -d "Disable folding of newly stowed directories"
complete -c stow -l ignore -x -d "Ignore files matching this Perl regex"
complete -c stow -l defer -x -d "Do not stow files matching this Perl regex"
complete -c stow -l override -x -d "Force stowing files matching this Perl regex"
complete -c stow -l dotfiles -d "Enable special handling for dotfiles (dot-)"
complete -c stow -s V -l version -d "Show Stow version and exit"
complete -c stow -s h -l help -d "Show help and exit"

# Package names: positional arguments come from the stow directory.
complete -c stow -f -a "(__stow_packages)" -d "package"
