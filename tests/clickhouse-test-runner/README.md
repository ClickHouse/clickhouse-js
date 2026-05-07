# clickhouse-test-runner

This package is a Node.js port of the Java
[`tests/clickhouse-client`](https://github.com/ClickHouse/clickhouse-java/tree/main/tests/clickhouse-client)
harness from the [`ClickHouse/clickhouse-java`](https://github.com/ClickHouse/clickhouse-java)
repository. The goal is to drive the upstream ClickHouse SQL test files
(`tests/queries/0_stateless/*`) against `@clickhouse/client` via a thin
`clickhouse-client` shim, so that the official test runner script
(`tests/clickhouse-test`) can exercise this Node.js client end-to-end.

The shim is built (`npm run build`) into `dist/main.js` and exposed as the
`clickhouse-js-test-runner` bin entry. A small launcher script in `bin/`
(added in a later step) will be placed first on `PATH` so the official
`tests/clickhouse-test` script picks up this binary instead of the real
`clickhouse-client`.

> **Note:** Do **not** clone the entire `ClickHouse/ClickHouse` repository
> for these tests. Download the specific test files individually (e.g. via
> the GitHub raw URLs) or fetch the relevant subset as a zip.

## Environment variables

| Variable                     | Default                          | Description                                                         |
| ---------------------------- | -------------------------------- | ------------------------------------------------------------------- |
| `CLICKHOUSE_CLIENT_CLI_IMPL` | `client`                         | Backend implementation. Supported values: `client`, `http`.         |
| `CLICKHOUSE_CLIENT_CLI_LOG`  | `/tmp/clickhouse-client-cli.log` | Path to a log file used for troubleshooting the shim's invocations. |

## Usage (planned)

```bash
PATH="$(pwd)/tests/clickhouse-test-runner/bin:$PATH" \
  tests/clickhouse-test 01428_hash_set_nan_key
```

## Status

- [x] Step 1: package scaffolding and pure utility modules (settings,
      argument parsing, query splitting, log helpers, `extract-from-config`
      shim).
- [ ] Step 2: implement the client/http backends and the `main.ts`
      entry point.
- [ ] Step 3: add the `bin/` launcher and document how to run the
      upstream tests.
