#!/bin/bash

set -euo pipefail

version=${1:-}
if [ -z "$version" ]; then
  echo "Usage: $0 <version>"
  exit 1
fi

echo "Setting the version to: $version"

for package in packages/client-node packages/client-web; do
  if [ -f "$package/package.json" ]; then
    echo "Updating client-common version in $package/package.json"
    json=$(cat "$package/package.json")
    echo "$json" | jq --arg version "$version" '.dependencies["@clickhouse/client-common"] = $version' > "$package/package.json"
  fi
done

npm --workspaces version "$version"
