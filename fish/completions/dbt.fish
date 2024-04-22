function __fish_dbt_complete_models
    set file ./target/manifest.json

    echo $file
    if test -f "$file"; and type -q jq
        jq '.nodes[].name' -r < "$file"
    end
end

complete -f -c dbt -o m -l model -a "(__fish_dbt_complete_models)"
