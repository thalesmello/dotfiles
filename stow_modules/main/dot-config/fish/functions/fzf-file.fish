function fzf-file --description 'Pick a file with fzf, respecting gitignore when possible'
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1
    git ls-files --cached --others --exclude-standard | fzf
  else
    fzf
  end
end
