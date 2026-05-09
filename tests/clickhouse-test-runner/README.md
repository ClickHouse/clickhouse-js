# clickhouse-test-runner

## What this is

This package is a Node.js port of the Java
[`tests/clickhouse-client`](https://github.com/ClickHouse/clickhouse-java/tree/main/tests/clickhouse-client)
harness from [`ClickHouse/clickhouse-java`](https://github.com/ClickHouse/clickhouse-java).
It wraps [`@clickhouse/client`](../../packages/client-node) in a tiny CLI that
mimics the upstream `clickhouse-client` binary (same flags, same
`extract-from-config` shortcut, same stdin/`--query` behavior) so that the
official ClickHouse Python test runner
([`tests/clickhouse-test`](https://github.com/ClickHouse/ClickHouse/tree/master/tests))
can drive a subset of the real ClickHouse SQL test suite against this Node.js
client. It lets us see exactly which upstream SQL tests pass or fail when run
through `@clickhouse/client`, without having to reimplement the test runner
itself.

## Build

```bash
cd tests/clickhouse-test-runner
npm install
npm run build
```

The build emits `dist/main.js`, which is the entry point used by the
`bin/clickhouse` shim.

## Wrapper executable

`bin/clickhouse` is a small Bash script that:

- Handles the `extract-from-config --key …` shortcut directly in shell, since
  the upstream Python runner spawns this synchronously during setup and only
  ever asks for `listen_host` (we always answer `127.0.0.1`).
- Forwards every other invocation to `node dist/main.js` with the original
  arguments.

To make the official runner use this shim, prepend `bin/` to `PATH` **only in
the shell session that runs the tests** so you don't shadow a real
`clickhouse-client` binary you may have installed system-wide:

```bash
export PATH="/path/to/clickhouse-js/tests/clickhouse-test-runner/bin:$PATH"
```

## Environment variables

| Variable                     | Default                                                      | Description                                                                                       |
| ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `CLICKHOUSE_CLIENT_CLI_IMPL` | `client`                                                     | Backend: `client` (uses `@clickhouse/client`) or `http` (uses Node `fetch` to talk to HTTP 8123). |
| `CLICKHOUSE_CLIENT_CLI_LOG`  | `tests/clickhouse-test-runner/.upstream/clickhouse-client-cli.log` | Path to a log file used to record every shim invocation. Useful for troubleshooting.              |
| `UPSTREAM_CLICKHOUSE_DIR`    | `tests/clickhouse-test-runner/.upstream/ClickHouse`          | Path to a checkout of `ClickHouse/ClickHouse` containing the upstream test suite.                |
| `UPSTREAM_TEST_LIST`         | `tests/clickhouse-test-runner/upstream-allowlist.txt`        | Path to a file listing the upstream tests to run (one test name per line, `#` for comments).     |

## Running against the upstream test suite

To avoid a full multi-GB clone of `ClickHouse/ClickHouse`, use a sparse + shallow clone:

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/ClickHouse/ClickHouse.git
cd ClickHouse
git sparse-checkout set tests/clickhouse-test tests/queries tests/config tests/ci
```

Then run the helper script from the `clickhouse-js` repository:

```bash
cd /path/to/clickhouse-js
UPSTREAM_CLICKHOUSE_DIR=/path/to/ClickHouse \
  tests/clickhouse-test-runner/scripts/run-upstream-tests.sh
```

The helper script reads the tests listed in `upstream-allowlist.txt` and runs them through the wrapper. It honors the environment variables documented in the [Environment variables](#environment-variables) table above, including `UPSTREAM_CLICKHOUSE_DIR` and `UPSTREAM_TEST_LIST`.

Extra positional arguments are forwarded to `tests/clickhouse-test`. For example, to skip the stateful tests:

```bash
UPSTREAM_CLICKHOUSE_DIR=/path/to/ClickHouse \
  tests/clickhouse-test-runner/scripts/run-upstream-tests.sh --no-stateful
```

To toggle the backend implementation, set `CLICKHOUSE_CLIENT_CLI_IMPL`:

```bash
CLICKHOUSE_CLIENT_CLI_IMPL=http \
  tests/clickhouse-test-runner/scripts/run-upstream-tests.sh
```

### Extending the allowlist

The file `upstream-allowlist.txt` contains the curated list of upstream tests known to pass through this harness. The file format is one test name per line; lines starting with `#` and blank lines are ignored.

**Rule of thumb:** Only add tests that pass on both the `client` and `http` backends. Remove or comment out tests that begin to flake.

### CI

The workflow `.github/workflows/upstream-sql-tests.yml` runs this harness in CI:

- Triggered on **workflow_dispatch**, **nightly at 05:00 UTC**, and on **pushes/PRs** that touch `tests/clickhouse-test-runner/**` or the workflow file itself.
- The `workflow_dispatch` input `upstream_ref` can be used to pin a specific upstream commit or branch (defaults to `master`).

## Local development

From this directory:

- `npm run build` — compile TypeScript to `dist/`.
- `npm run typecheck` — run `tsc --noEmit`.
- `npm run lint` — run ESLint with `--max-warnings=0`.
- `npm test` — run the Vitest unit suite (`__tests__/**/*.test.ts`).

## Status

This is a developer-facing harness. It is **not** an exhaustive
`clickhouse-client` replacement; only the flags and behaviors that
`tests/clickhouse-test` actually exercises are implemented. The
`SERVER_SETTINGS` and `CLIENT_ONLY_SETTINGS` allowlists in
[`src/settings.ts`](src/settings.ts) are copied from the Java port and may
need to be periodically resynced as ClickHouse adds or reclassifies settings.
