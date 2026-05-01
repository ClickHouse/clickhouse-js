#!/bin/bash

# Computes a deterministic content hash of an `npm pack` tarball.
#
# The hash is computed over the unpacked tarball contents with the
# `version` field of `package/package.json` and the version of any
# `@clickhouse/client-common` entry under `dependencies` normalized to
# a fixed placeholder. This way two packs that differ only in their
# (head) version produce the same hash, while any meaningful change to
# the packaged sources, README, LICENSE, package.json metadata, etc.
# results in a different hash.
#
# Usage: pkg_content_hash.sh <tarball.tgz>

set -euo pipefail

tarball=${1:-}
if [ -z "$tarball" ] || [ ! -f "$tarball" ]; then
  echo "Usage: $0 <tarball.tgz>" >&2
  exit 1
fi

abs_tarball=$(cd "$(dirname "$tarball")" && pwd)/$(basename "$tarball")

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

tar -xzf "$abs_tarball" -C "$tmpdir"

pkg_json="$tmpdir/package/package.json"
if [ ! -f "$pkg_json" ]; then
  echo "tarball does not contain package/package.json" >&2
  exit 1
fi

# Normalize version-dependent fields so that the hash is stable across
# different head versions of the same logical package contents.
normalized=$(jq '
  .version = "0.0.0-content-hash"
  | if (.dependencies // {}) | has("@clickhouse/client-common")
    then .dependencies["@clickhouse/client-common"] = "0.0.0-content-hash"
    else .
    end
' "$pkg_json")
printf '%s\n' "$normalized" > "$pkg_json"

# Hash all packaged files in a deterministic order.
(
  cd "$tmpdir/package"
  find . -type f -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 sha256sum
) | sha256sum | awk '{print $1}'
