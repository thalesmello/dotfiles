function ua
  # Verify all paths are valid
  for file_path in $argv
    if not test -e "$file_path"
      echo "Path does not exist: $file_path" >&2
      return 1
    end
  end

  # Expand arguments into full paths
  # realpath will output one path per line, which is automatically split by Fish
  set -l absolute_paths (realpath $argv)

  # Open Universal Actions
  /usr/bin/osascript -l JavaScript -e 'function run(argv) { Application("com.runningwithcrayons.Alfred").action(argv) }' $absolute_paths
end
