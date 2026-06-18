#!/bin/bash

# Compute the "head" pre-release version for a package from its package.json
# base version, e.g. `1.2.3-head.<short-sha>.<run-attempt>`. Each per-package
# head job computes its own version independently; within a single workflow run
# the short SHA and run attempt are identical, so the suffix stays consistent.

set -euo pipefail

pkg_json=${1:-}
if [ -z "$pkg_json" ]; then
  echo "Usage: $0 <path-to-package.json>" >&2
  exit 1
fi

base_version=$(node -p "require('./${pkg_json}').version")
echo "${base_version}-head.${GITHUB_SHA::7}.${GITHUB_RUN_ATTEMPT}"
