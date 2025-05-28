function macpref-compare
    argparse \
    -x 'before,snapshot' \
    -x 'after,snapshot' \
    'before=' 'after=' 'snapshot=' -- $argv

    if test -n "$_flag_snapshot"
        mkdir -p "$_flag_snapshot"
        cp -r ~/Library/Preferences/ "$_flag_snapshot"
    else if test -z $argv[1]
        diff -ur "$_flag_before" "$_flag_after"
    else
        set file (string replace -r "^$_flag_after" '' $argv[1])

        if test $file = $argv[1]
            set file (string replace -r "^$_flag_before" '' $argv[1])
        end

        if test $file = $argv[1]
            echo "Error: $argv[1] is not a file in --before or --after" 1>&2
            return 1
        end

        set file_before (path resolve "$_flag_before/$file")
        set file_after (path resolve "$_flag_after/$file")

        diff -u (plist "$file_before" | psub) (plist "$file_after" | psub)
    end
end

complete -c macpref-compare -F -l before
complete -c macpref-compare -F -l after
complete -c macpref-compare -F -l snapshot
