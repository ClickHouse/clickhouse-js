#!/usr/bin/env bash
set -euo pipefail

# Resolve the runner directory (parent of scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Read environment variables with defaults
UPSTREAM_CLICKHOUSE_DIR="${UPSTREAM_CLICKHOUSE_DIR:-${RUNNER_DIR}/.upstream/ClickHouse}"
CLICKHOUSE_CLIENT_CLI_IMPL="${CLICKHOUSE_CLIENT_CLI_IMPL:-}"
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
if [[ -n "${CLICKHOUSE_CLIENT_CLI_IMPL}" ]]; then
  export CLICKHOUSE_CLIENT_CLI_IMPL
fi

# Run the upstream test runner
cd "${UPSTREAM_CLICKHOUSE_DIR}"
exec python3 tests/clickhouse-test "${tests[@]}" "$@"
