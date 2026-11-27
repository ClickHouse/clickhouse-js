#!/usr/bin/env bash
# Runs the allowlisted upstream ClickHouse SQL tests through @clickhouse/client.
#
# Usage: scripts/run-upstream-tests.sh [<extra tests/clickhouse-test arguments>...]
#
# See ../README.md for the environment variables.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

UPSTREAM_CLICKHOUSE_DIR="${UPSTREAM_CLICKHOUSE_DIR:-${RUNNER_DIR}/.upstream/ClickHouse}"
CLICKHOUSE_CLIENT_CLI_LOG="${CLICKHOUSE_CLIENT_CLI_LOG:-${RUNNER_DIR}/.upstream/clickhouse-client-cli.log}"
TEST_RUNNER_BACKEND="${TEST_RUNNER_BACKEND:-passthrough}"
case "${TEST_RUNNER_BACKEND}" in
  passthrough) default_list="${RUNNER_DIR}/upstream-allowlist.txt" ;;
  rowbinary) default_list="${RUNNER_DIR}/rowbinary-allowlist.txt" ;;
  json) default_list="${RUNNER_DIR}/json-allowlist.txt" ;;
  native) default_list="${RUNNER_DIR}/native-allowlist.txt" ;;
  *)
    echo "Error: unknown TEST_RUNNER_BACKEND '${TEST_RUNNER_BACKEND}' (expected passthrough, rowbinary, json or native)." >&2
    exit 1
    ;;
esac
UPSTREAM_TEST_LIST="${UPSTREAM_TEST_LIST:-${default_list}}"
SHARD_INDEX="${SHARD_INDEX:-1}"
SHARD_TOTAL="${SHARD_TOTAL:-1}"

if [[ ! -f "${UPSTREAM_CLICKHOUSE_DIR}/tests/clickhouse-test" ]]; then
  echo "Error: ${UPSTREAM_CLICKHOUSE_DIR}/tests/clickhouse-test not found." >&2
  echo "Run scripts/fetch-upstream.sh, or set UPSTREAM_CLICKHOUSE_DIR to a checkout of ClickHouse/ClickHouse." >&2
  exit 1
fi
if [[ ! -f "${RUNNER_DIR}/dist/main.js" ]]; then
  echo "Error: ${RUNNER_DIR}/dist/main.js not found. Run 'npm install && npm run build' in the repository root." >&2
  exit 1
fi

# The server and the tests must be of the same release: the `.reference`
# files of another release do not match the output of the server.
upstream_ref="$(cat "${UPSTREAM_CLICKHOUSE_DIR}/.upstream-ref" 2> /dev/null || echo unknown)"
# With --secure, the shim connects to CLICKHOUSE_PORT_HTTPS over TLS, so get
# the version there too. The probe sends no credentials, and a test server
# often has a self-signed certificate, so curl does not verify it.
server_host="${CLICKHOUSE_HOST:-localhost}"
server_url="http"'://'"${server_host}:${CLICKHOUSE_PORT_HTTP:-8123}/"
curl_tls=()
for arg in "$@"; do
  if [[ "${arg}" == "--secure" ]]; then
    server_url="https://${server_host}:${CLICKHOUSE_PORT_HTTPS:-8443}/"
    curl_tls=(--insecure)
  fi
done
if ! server_version="$(curl -fsS --noproxy '*' ${curl_tls[@]+"${curl_tls[@]}"} --data-binary 'SELECT version()' "${server_url}")"; then
  echo "Error: cannot get the server version from ${server_url}. Start the server first." >&2
  exit 1
fi
if [[ "${upstream_ref}" != "v${server_version}-stable" && "${upstream_ref}" != "v${server_version}-lts" &&
  "${ALLOW_VERSION_MISMATCH:-0}" != "1" ]]; then
  echo "Error: the server is ${server_version}, but the upstream tests are ${upstream_ref}." >&2
  echo "Start the pinned server (see README.md) and run scripts/fetch-upstream.sh," >&2
  echo "or set ALLOW_VERSION_MISMATCH=1 to run anyway." >&2
  exit 1
fi
echo "Server ${server_version}, upstream tests ${upstream_ref}, backend ${TEST_RUNNER_BACKEND}" >&2

# Read the allowlist: one test name per line; '#' starts a comment.
#
# With KNOWN_FAILURES, read the known failures instead: the comment lines
# `# <test>  # [<id>]` of the groups in KNOWN_FAILURES (comma-separated IDs,
# or `all`). Use it to check whether a fix makes the tests of a group pass.
tests=()
if [[ -n "${KNOWN_FAILURES:-}" ]]; then
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ "${line}" =~ ^#[[:space:]]*([A-Za-z0-9_.-]+)[[:space:]]+#[[:space:]]*\[([a-z0-9-]+)\] ]]; then
      if [[ "${KNOWN_FAILURES}" == "all" || ",${KNOWN_FAILURES}," == *",${BASH_REMATCH[2]},"* ]]; then
        tests+=("${BASH_REMATCH[1]}")
      fi
    fi
  done < "${UPSTREAM_TEST_LIST}"
  echo "Selected ${#tests[@]} known failure(s) of ${KNOWN_FAILURES} from ${UPSTREAM_TEST_LIST}" >&2
else
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "${line}" ]] && continue
    tests+=("${line}")
  done < "${UPSTREAM_TEST_LIST}"
  echo "Selected ${#tests[@]} test(s) from ${UPSTREAM_TEST_LIST}" >&2
fi

# Upstream renames and removes tests. A name that selects no test file runs
# nothing and fails nothing, so report it.
missing=()
for t in "${tests[@]}"; do
  q="${UPSTREAM_CLICKHOUSE_DIR}/tests/queries/0_stateless/${t}"
  if [[ ! -e "${q}.sql" && ! -e "${q}.sql.j2" ]]; then
    missing+=("${t}")
  fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  msg="${#missing[@]} allowlisted test(s) are not in the upstream checkout (${upstream_ref}): ${missing[*]}"
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo "::warning::${msg}"; else echo "Warning: ${msg}" >&2; fi
fi

# Round-robin sharding: keep the tests at positions i where
# i % SHARD_TOTAL == SHARD_INDEX - 1. Each shard is then a representative
# sample of the list, so the run times of the shards stay close.
if ! [[ "${SHARD_TOTAL}" =~ ^[1-9][0-9]*$ && "${SHARD_INDEX}" =~ ^[1-9][0-9]*$ ]] || ((SHARD_INDEX > SHARD_TOTAL)); then
  echo "Error: SHARD_INDEX and SHARD_TOTAL must be positive integers with SHARD_INDEX <= SHARD_TOTAL (got: ${SHARD_INDEX}/${SHARD_TOTAL})." >&2
  exit 1
fi
if ((SHARD_TOTAL > 1)); then
  sharded=()
  for i in "${!tests[@]}"; do
    if ((i % SHARD_TOTAL == SHARD_INDEX - 1)); then
      sharded+=("${tests[$i]}")
    fi
  done
  tests=("${sharded[@]}")
  echo "Shard ${SHARD_INDEX}/${SHARD_TOTAL}: ${#tests[@]} test(s)" >&2
fi

# tests/clickhouse-test runs ALL tests when it gets no test names.
if [[ ${#tests[@]} -eq 0 ]]; then
  echo "Error: no tests selected from ${UPSTREAM_TEST_LIST}. Refusing to run the full upstream suite." >&2
  exit 1
fi

# tests/clickhouse-test calls `clickhouse` and `clickhouse-client`; both
# names start the shim. Put them first in PATH for the runner only.
mkdir -p "$(dirname "${CLICKHOUSE_CLIENT_CLI_LOG}")"
export PATH="${RUNNER_DIR}/bin:${PATH}"
export CLICKHOUSE_CLIENT_CLI_LOG TEST_RUNNER_BACKEND

# shellcheck source=selectors.sh
source "${SCRIPT_DIR}/selectors.sh"
build_selectors "${tests[@]}"

cd "${UPSTREAM_CLICKHOUSE_DIR}"
# --no-random-settings, --no-random-merge-tree-settings: by default the
# runner adds random settings to each test, so a test can pass in one run and
# fail in the next. The other client harnesses turn them off too.
# --dont_retry_failures: by default, tests/clickhouse-test runs a failed test
# again when its output contains one of its MESSAGES_TO_RETRY (for example
# "No such file or directory" or "Connection reset by peer"), and reports the
# test as OK when it passes then. A flaky test would then look stable and
# could get into the allowlist. With this flag, each failure fails the run.
# --no-long (native backend): its allowlist leaves out the long tests, and
# the flag keeps a long test that matches a selector from running.
backend_flags=()
if [[ "${TEST_RUNNER_BACKEND}" == "native" ]]; then
  backend_flags+=(--no-long)
fi
exec python3 tests/clickhouse-test --no-stateful --no-random-settings \
  --no-random-merge-tree-settings --dont_retry_failures \
  ${backend_flags[@]+"${backend_flags[@]}"} "$@" -- "${selectors[@]}"
