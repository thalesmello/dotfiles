#!/bin/bash

set -e

DIR="$(dirname $(dirname $(realpath $0)))"

for filename in "$DIR"/bettertouchtool/*.bttpreset; do
    echo "Running custom command..."
    echo yq -P "'"'(.. | select(tag == "!!seq")) |= sort_by(.BTTAppBundleIdentifier, .BTTTriggerParentUUID, .BTTTriggerClass, .BTTOrder) | sort_keys(..)'"'" -o json -i "'$filename'"
    yq -P '(.. | select(tag == "!!seq")) |= sort_by(.BTTAppBundleIdentifier, .BTTTriggerParentUUID, .BTTTriggerClass, .BTTOrder) | sort_keys(..)' -o json -i "$filename"
done
