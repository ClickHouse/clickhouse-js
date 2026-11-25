#!/bin/bash

# Create and push an annotated release git tag, skipping if it already exists
# on origin. Single-package releases use a package-scoped tag (e.g.
# `client-web-1.2.3`) so they do not collide with the shared release tag.

set -euo pipefail

tag=${1:-}
if [ -z "$tag" ]; then
  echo "Usage: $0 <tag>" >&2
  exit 1
fi

if git ls-remote --exit-code --tags origin "refs/tags/${tag}" >/dev/null 2>&1; then
  echo "Tag ${tag} already exists on origin; skipping."
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git tag -a "${tag}" -m "Release ${tag}"
git push origin "refs/tags/${tag}"
