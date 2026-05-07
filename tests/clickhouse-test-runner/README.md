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

| Variable                     | Default                          | Description                                                                                       |
| ---------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `CLICKHOUSE_CLIENT_CLI_IMPL` | `client`                         | Backend: `client` (uses `@clickhouse/client`) or `http` (uses Node `fetch` to talk to HTTP 8123). |
| `CLICKHOUSE_CLIENT_CLI_LOG`  | `/tmp/clickhouse-client-cli.log` | Path to a log file used to record every shim invocation. Useful for troubleshooting.              |

## Examples

```bash
# Do NOT clone the full ClickHouse repo (too large). Download a zip instead, or
# fetch only the test files you need from
# https://github.com/ClickHouse/ClickHouse/tree/master/tests/queries

cd ClickHouse-master
CLICKHOUSE_CLIENT_CLI_LOG=./test-run.log \
  PATH="$PATH:/path/to/clickhouse-js/tests/clickhouse-test-runner/bin/" \
  tests/clickhouse-test 01428_hash_set_nan_key

# Use the raw HTTP backend instead:
CLICKHOUSE_CLIENT_CLI_IMPL=http CLICKHOUSE_CLIENT_CLI_LOG=./test-run.log \
  PATH="$PATH:/path/to/clickhouse-js/tests/clickhouse-test-runner/bin/" \
  tests/clickhouse-test 01428_hash_set_nan_key
```

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
