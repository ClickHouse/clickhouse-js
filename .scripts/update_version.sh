#!/bin/bash

set -euo pipefail

version=${1:-}
if [ -z "$version" ]; then
  echo "Usage: $0 <version> [package-name...]"
  echo
  echo "  package-name  one or more of:"
  echo "                  @clickhouse/client"
  echo "                  @clickhouse/client-web"
  echo "                  @clickhouse/client-common"
  echo "                When omitted, every package is updated (kept in sync)."
  exit 1
fi
shift

# Map the published npm package names to their source directories.
declare -A pkg_dirs=(
  ["@clickhouse/client"]="packages/client-node"
  ["@clickhouse/client-web"]="packages/client-web"
  ["@clickhouse/client-common"]="packages/client-common"
)

if [ "$#" -eq 0 ]; then
  # Default: keep every package (and the internal workspaces) in sync.
  echo "Setting the version to: $version (all packages)"

  for package in packages/client-common packages/client-node packages/client-web; do
    if [ -f "$package/package.json" ]; then
      echo "Updating version in $package/src/version.ts"
      echo "export default \"$version\";" > "$package/src/version.ts"
    fi
  done

  npm --workspaces version --no-git-tag-version "$version"
else
  # Targeted update: only bump the explicitly requested packages. This is used
  # to release a single package (for example, the deprecated
  # @clickhouse/client-common) without bumping the others.
  echo "Setting the version to: $version for: $*"

  for name in "$@"; do
    dir="${pkg_dirs[$name]:-}"
    if [ -z "$dir" ]; then
      echo "Unknown package: $name" >&2
      echo "Expected one of: ${!pkg_dirs[*]}" >&2
      exit 1
    fi
    echo "Updating version in $dir/src/version.ts"
    echo "export default \"$version\";" > "$dir/src/version.ts"
    npm --workspace "$name" version --no-git-tag-version "$version"
  done
fi
