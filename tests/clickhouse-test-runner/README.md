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

## Backends

The runner can execute queries two ways, selected by the `TEST_RUNNER_BACKEND`
environment variable:

- **`passthrough`** (default) — set `default_format = TabSeparated` and stream
  ClickHouse's own output bytes straight to stdout. ClickHouse does all the
  formatting; this exercises `@clickhouse/client`'s transport, session and
  settings handling. Comparison is the upstream `.reference` diff.

- **`rowbinary`** — for each result-returning statement that has no explicit
  `FORMAT` clause, request `RowBinaryWithNamesAndTypes`, decode it with the
  published [`@clickhouse/rowbinary`](https://www.npmjs.com/package/@clickhouse/rowbinary)
  package's dynamic header→reader path, and re-render the rows as `TabSeparated` so the
  same `.reference` diff still applies. This makes the upstream SQL suite a
  breadth test of the RowBinary parser: ClickHouse is the byte oracle, the
  `.reference` is the value oracle. DDL / `INSERT` / `SET` / explicit-`FORMAT`
  statements fall through to passthrough. A decode or render error fails the
  statement (it is never silently swallowed), so a test only "passes" if the
  parser actually reproduced the server's output.

Because the `rowbinary` backend can only validate tests whose decoded types it
can render back to `TabSeparated`, it runs a dedicated, smaller allowlist
(`rowbinary-allowlist.txt`) rather than the full `upstream-allowlist.txt`. Point
`UPSTREAM_TEST_LIST` at it:

```bash
UPSTREAM_CLICKHOUSE_DIR=/path/to/ClickHouse \
  TEST_RUNNER_BACKEND=rowbinary \
  UPSTREAM_TEST_LIST=tests/clickhouse-test-runner/rowbinary-allowlist.txt \
  tests/clickhouse-test-runner/scripts/run-upstream-tests.sh --no-stateful
```

The `rowbinary` backend depends on the published `@clickhouse/rowbinary` package
(installed by the normal `npm install`), so it validates the same parser build
that ships to users. The skill's in-repo source is covered separately by its own
suite (`.github/workflows/tests-skill-rowbinary-parser.yml`).

## Build

This package is a workspace of the root `clickhouse-js` repository, so it
installs alongside (and is linked against) the local `@clickhouse/client` and
`@clickhouse/client-common` packages. Install + build everything from the
repo root:

```bash
cd /path/to/clickhouse-js
npm install
npm run build
```

The build emits `tests/clickhouse-test-runner/dist/main.js`, which is the
entry point used by the `bin/clickhouse` shim. Building from the root also
compiles `@clickhouse/client` and `@clickhouse/client-common` so the harness
exercises the local checkout instead of the last published version on npm.

## Wrapper executable

`bin/clickhouse` is a small Bash script that:

- Handles the `extract-from-config --key …` shortcut directly in shell, since
  the upstream Python runner spawns this synchronously during setup and only
  ever asks for `listen_host` (we always answer `127.0.0.1`).
- Forwards every other invocation to `node dist/main.js` with the original
  arguments.

`bin/clickhouse-client` is a symlink to `bin/clickhouse` so that the upstream
runner's `clickhouse-client` invocations resolve to the same shim. Both names
must be on `PATH` because `tests/clickhouse-test` calls
`clickhouse extract-from-config` during setup but uses `clickhouse-client` to
actually run queries.

To make the official runner use this shim, prepend `bin/` to `PATH` **only in
the shell session that runs the tests** so you don't shadow a real
`clickhouse-client` binary you may have installed system-wide:

```bash
export PATH="/path/to/clickhouse-js/tests/clickhouse-test-runner/bin:$PATH"
```

## Environment variables

| Variable                    | Default                                                            | Description                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEST_RUNNER_BACKEND`       | `passthrough`                                                      | Which backend executes queries: `passthrough` (stream ClickHouse's own `TabSeparated`) or `rowbinary` (decode `RowBinaryWithNamesAndTypes` via `@clickhouse/rowbinary` and re-render). See [Backends](#backends). |
| `CLICKHOUSE_CLIENT_CLI_LOG` | `tests/clickhouse-test-runner/.upstream/clickhouse-client-cli.log` | Path to a log file used to record every shim invocation. Useful for troubleshooting.                                                                                                                              |
| `UPSTREAM_CLICKHOUSE_DIR`   | `tests/clickhouse-test-runner/.upstream/ClickHouse`                | Path to a checkout of `ClickHouse/ClickHouse` containing the upstream test suite.                                                                                                                                 |
| `UPSTREAM_TEST_LIST`        | `tests/clickhouse-test-runner/upstream-allowlist.txt`              | Path to a file listing the upstream tests to run (one test name per line, `#` for comments).                                                                                                                      |
| `SHARD_INDEX`               | `1`                                                                | 1-based index of the shard to run when sharding the allowlist (must be `<= SHARD_TOTAL`).                                                                                                                         |
| `SHARD_TOTAL`               | `1`                                                                | Total number of shards. When `> 1`, only tests at positions where `i % SHARD_TOTAL == SHARD_INDEX - 1` are run (round-robin selection).                                                                           |

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

### Extending the allowlist

The file `upstream-allowlist.txt` contains the curated list of upstream tests known to pass through this harness. The file format is one test name per line; lines starting with `#` and blank lines are ignored.

**Rule of thumb:** Only add tests that pass reliably. Remove or comment out tests that begin to flake.

### CI

The workflow `.github/workflows/upstream-sql-tests.yml` runs this harness in CI:

- Triggered on **workflow_dispatch**, **nightly at 05:00 UTC**, and on **pushes/PRs** that touch `tests/clickhouse-test-runner/**` or the workflow file itself.
- The `workflow_dispatch` input `upstream_ref` can be used to pin a specific upstream commit or branch (defaults to `master`).
- The matrix runs every combination of `{clickhouse: head | latest} × {shard: 1..N}`. Sharding is round-robin across the allowlist (see `SHARD_INDEX` / `SHARD_TOTAL` above) so each shard takes roughly one minute. If the allowlist grows enough that per-shard runtime climbs back above ~1 minute, bump both the `shard` matrix values and the `SHARD_TOTAL` env value in the workflow together.

## Local development

This package is a workspace of the root `clickhouse-js` repository. Install
dependencies once from the repo root (`npm install`) so that
`@clickhouse/client` and `@clickhouse/client-common` are linked from the
local checkout. The following scripts can then be run from this directory:

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
