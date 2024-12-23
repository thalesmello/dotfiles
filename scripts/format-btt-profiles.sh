#!/bin/bash

set -e

DIR="$(dirname $(dirname $(realpath $0)))"

for filename in "$DIR"/bettertouchtool/*.bttpreset; do
    echo "Running custom command..."
    echo yq -P "'"'(.. | sort_keys(.) | select(tag == "!!seq")) |= sort_by(.BTTOrder // 1000)'"'" -o json -i "'$filename'"
    yq -P '(.. | sort_keys(.) | select(tag == "!!seq")) |= sort_by(.BTTOrder // 1000)' -o json -i "$filename"
done
