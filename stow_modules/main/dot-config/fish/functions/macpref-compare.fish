function macpref-compare --description "Snapshot and diff macOS defaults preferences"
    defaults-diff $argv
end

complete -c macpref-compare -F -l before
complete -c macpref-compare -F -l after
complete -c macpref-compare -F -l snapshot
complete -c macpref-compare -s d -l domain
