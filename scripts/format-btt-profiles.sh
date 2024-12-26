#!/bin/bash

set -e

DIR="$(dirname $(dirname $(realpath $0)))"

for filename in "$DIR"/bettertouchtool/*.bttpreset; do
    echo "Running custom command..."
    echo yq -P "'"'.BTTPresetContent |= sort_by(.BTTAppBundleIdentifier) | (.. | select(kind == "!!seq")) |= sort_by(.BTTOrder // 1000) | .BTTPresetContent[].BTTTriggers |= sort_by(.BTTTriggerClass) | sort_keys(..)'"'" -o json -i "'$filename'"
    yq -P '.BTTPresetContent |= sort_by(.BTTAppBundleIdentifier) | (.. | select(kind == "!!seq")) |= sort_by(.BTTOrder // 1000) | .BTTPresetContent[].BTTTriggers |= sort_by(.BTTTriggerClass) | sort_keys(..)' -o json -i "$filename"
done
