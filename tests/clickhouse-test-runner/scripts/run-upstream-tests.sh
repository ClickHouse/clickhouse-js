#!/usr/bin/env bash
set -euo pipefail

# Resolve the runner directory (parent of scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Read environment variables with defaults
UPSTREAM_CLICKHOUSE_DIR="${UPSTREAM_CLICKHOUSE_DIR:-${RUNNER_DIR}/.upstream/ClickHouse}"
CLICKHOUSE_CLIENT_CLI_LOG="${CLICKHOUSE_CLIENT_CLI_LOG:-${RUNNER_DIR}/.upstream/clickhouse-client-cli.log}"
UPSTREAM_TEST_LIST="${UPSTREAM_TEST_LIST:-${RUNNER_DIR}/upstream-allowlist.txt}"

# Build the runner if needed
if [[ ! -f "${RUNNER_DIR}/dist/main.js" ]]; then
  echo "Building clickhouse-test-runner..." >&2
  (cd "$RUNNER_DIR" && npm install && npm run build)
fi

# Verify upstream ClickHouse directory
if [[ ! -x "${UPSTREAM_CLICKHOUSE_DIR}/tests/clickhouse-test" ]]; then
  echo "Error: ${UPSTREAM_CLICKHOUSE_DIR}/tests/clickhouse-test not found or not executable." >&2
  echo "Set UPSTREAM_CLICKHOUSE_DIR to point to a checkout of ClickHouse/ClickHouse." >&2
  exit 1
fi

# Read allowlist into array, skipping comments and blank lines.
# Leading/trailing whitespace is trimmed so test names are passed cleanly
# to tests/clickhouse-test even if the allowlist file is hand-edited.
tests=()
while IFS= read -r line || [[ -n "$line" ]]; do
  # Trim leading whitespace
  line="${line#"${line%%[![:space:]]*}"}"
  # Trim trailing whitespace
  line="${line%"${line##*[![:space:]]}"}"
  # Skip blank lines and comments
  [[ -z "${line}" ]] && continue
  [[ "${line}" == \#* ]] && continue
  tests+=("${line}")
done < "${UPSTREAM_TEST_LIST}"

echo "Selected ${#tests[@]} test(s) from ${UPSTREAM_TEST_LIST}" >&2

# Optional sharding: pick a round-robin subset of the allowlist when
# SHARD_TOTAL > 1. Tests at positions where (index % SHARD_TOTAL) ==
# (SHARD_INDEX - 1) are kept (1-based SHARD_INDEX). Round-robin selection
# keeps each shard a representative sample of the full allowlist regardless
# of how the allowlist is ordered, so per-shard runtimes stay roughly even.
SHARD_INDEX="${SHARD_INDEX:-1}"
SHARD_TOTAL="${SHARD_TOTAL:-1}"
if ! [[ "${SHARD_TOTAL}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Error: SHARD_TOTAL must be a positive integer (got: '${SHARD_TOTAL}')." >&2
  exit 1
fi
if ! [[ "${SHARD_INDEX}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Error: SHARD_INDEX must be a positive integer (got: '${SHARD_INDEX}')." >&2
  exit 1
fi
if (( SHARD_INDEX > SHARD_TOTAL )); then
  echo "Error: SHARD_INDEX (${SHARD_INDEX}) must be <= SHARD_TOTAL (${SHARD_TOTAL})." >&2
  exit 1
fi
if (( SHARD_TOTAL > 1 )); then
  sharded=()
  for i in "${!tests[@]}"; do
    if (( i % SHARD_TOTAL == SHARD_INDEX - 1 )); then
      sharded+=("${tests[$i]}")
    fi
  done
  echo "Sharding: keeping ${#sharded[@]} test(s) for shard ${SHARD_INDEX}/${SHARD_TOTAL}" >&2
  tests=("${sharded[@]}")
fi

if [[ ${#tests[@]} -eq 0 ]]; then
  if [[ "${ALLOW_EMPTY_UPSTREAM_ALLOWLIST:-0}" != "1" ]]; then
    echo "Error: no tests were selected from ${UPSTREAM_TEST_LIST}." >&2
    echo "Refusing to run tests/clickhouse-test without explicit test names because an empty allowlist can run a large upstream suite." >&2
    echo "If this is intentional, rerun with ALLOW_EMPTY_UPSTREAM_ALLOWLIST=1." >&2
    exit 1
  fi
  echo "Warning: no tests were selected from ${UPSTREAM_TEST_LIST}; continuing because ALLOW_EMPTY_UPSTREAM_ALLOWLIST=1." >&2
fi

# Ensure log file directory exists
mkdir -p "$(dirname "${CLICKHOUSE_CLIENT_CLI_LOG}")"

# Export environment for the wrapper
export PATH="${RUNNER_DIR}/bin:${PATH}"
export CLICKHOUSE_CLIENT_CLI_LOG

# Run the upstream test runner
cd "${UPSTREAM_CLICKHOUSE_DIR}"
exec python3 tests/clickhouse-test "${tests[@]}" "$@"
