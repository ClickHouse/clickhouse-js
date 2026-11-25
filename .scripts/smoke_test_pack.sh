#!/usr/bin/env bash
#
# Pre-publish smoke test.
#
# Packs an already-built workspace into a tarball, installs that tarball into a
# throwaway app (install-from-artifact only, exactly as a downstream consumer
# would), and runs ESM + CJS checks against it. This catches packaging problems
# - missing files, broken exports, unexpected transitive deps - before the
# package is published to npm, rather than after.
#
# Usage: .scripts/smoke_test_pack.sh [workspace]
#   workspace defaults to @clickhouse/client.
#
# Run from the repository root, after `npm run build` (or a per-workspace build).
set -euo pipefail

WORKSPACE="${1:-@clickhouse/client}"
REPO="$(pwd)"
SMOKE_DIR="$REPO/tests/e2e/smoke"

APP="$(mktemp -d)/smoke-app"
mkdir -p "$APP"
# Clean up the throwaway app even if a check fails.
trap 'rm -rf "$(dirname "$APP")"' EXIT

TARBALL="$(npm pack -w "$WORKSPACE" --pack-destination "$APP" --json \
  | node -e "console.log(JSON.parse(require('fs').readFileSync(0))[0].filename)")"
echo "Packed $WORKSPACE -> $TARBALL"

cp "$SMOKE_DIR/check.mjs" "$SMOKE_DIR/check.cjs" "$APP/"
cd "$APP"
npm init -y >/dev/null
npm install "./$TARBALL"

echo "--- installed @clickhouse packages ---"
ls node_modules/@clickhouse/

echo "--- ESM check ---"
node check.mjs
echo "--- CJS check ---"
node check.cjs

cd "$REPO"
echo "Smoke test passed for $WORKSPACE."
