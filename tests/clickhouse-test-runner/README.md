# clickhouse-test-runner

This harness runs the ClickHouse core SQL tests
([`tests/queries/0_stateless`](https://github.com/ClickHouse/ClickHouse/tree/master/tests/queries/0_stateless))
through [`@clickhouse/client`](../../packages/client-node) and
[`@clickhouse/client-native`](../../packages/client-native).

The upstream test runner
([`tests/clickhouse-test`](https://github.com/ClickHouse/ClickHouse/blob/master/tests/clickhouse-test))
runs each `.sql` test through `clickhouse-client` and compares the output with
the `.reference` file of the test. This harness is a small Node.js program (the
"shim") that imitates `clickhouse-client`. The runner can drive it without
changes: it has the same flags, the same stdin and `--query` behavior, and the
`extract-from-config` shortcut. Each statement goes to the server through the
public API of `@clickhouse/client`, or of `@clickhouse/client-native` for the
`native` backend.

The harness has the same design as the harnesses of
[clickhouse-cs](https://github.com/ClickHouse/clickhouse-cs/tree/main/tests/clickhouse-test-runner),
[clickhouse-connect](https://github.com/ClickHouse/clickhouse-connect/tree/main/tests/clickhouse-test-runner)
and [clickhouse-cpp](https://github.com/ClickHouse/clickhouse-cpp/tree/master/tests/clickhouse-test-runner):
the server version and the tests are pinned together, the tests run on the
stock server image without random settings, and a test that fails because of a
client bug or a shim gap stays in the allowlist as a known failure. See
[`AGENTS.md`](AGENTS.md) for the rules.

## Backends

All statements go to ClickHouse. The backend selects how the shim reads the
result back. Set it with `TEST_RUNNER_BACKEND`:

- **`passthrough`** (default): the shim sets `default_format = TabSeparated` and
  copies the bytes of the server to stdout. ClickHouse writes the text. This
  tests the transport, the sessions, the settings and the errors of
  `@clickhouse/client`, but the client decodes no value.
- **`rowbinary`**: for each statement that returns rows and has no `FORMAT`
  clause, the shim requests `RowBinaryWithNamesAndTypes`, decodes it with the
  published [`@clickhouse/rowbinary`](https://www.npmjs.com/package/@clickhouse/rowbinary)
  package (the dynamic header-to-reader path), and writes the rows as
  `TabSeparated` ([`src/tsv-serialize.ts`](src/tsv-serialize.ts)). Thus a test
  passes only when the decoder reads every value correctly. Other statements
  run as with `passthrough`. A decode or write error fails the statement.
- **`json`**: for each statement that returns rows and has no `FORMAT` clause,
  the shim calls `client.query({ format: 'JSONCompactEachRowWithNamesAndTypes' })`
  and `ResultSet.json()`, the read path that most users use, and writes the
  rows as `TabSeparated` ([`src/json-serialize.ts`](src/json-serialize.ts)).
  Thus a test passes only when `ResultSet.json()` gives each value as the
  server sent it. Dynamic and Variant values have no type in JSON: the writer
  writes them from the JS value. Other statements run as with `passthrough`.
- **`native`**: the shim connects over TCP with `@clickhouse/client-native` and
  uses one connection, which is the session, for the whole SQL script. It sets
  `default_format = TabSeparated` as `passthrough` does, but the client decodes
  the Native blocks and writes the text itself. Thus a test passes only when
  the native protocol, the Native decoder and the text writer of the client
  give the output of the server.

Each backend has its own allowlist: `upstream-allowlist.txt` for
`passthrough`, `rowbinary-allowlist.txt` for `rowbinary`,
`json-allowlist.txt` for `json` and `native-allowlist.txt` for `native`.
`run-upstream-tests.sh` selects the list of the backend. The `rowbinary`
backend uses the published `@clickhouse/rowbinary` package (installed by the
normal `npm install`). The source of that package has its own tests
(`.github/workflows/tests-skill-rowbinary.yml`).

## Run the tests locally

You need Node.js (see the root `package.json`), Python 3 with `jinja2`, git,
curl and Docker. Run the commands from the repository root.

1. Install and build, so that the shim uses the client of this checkout:

   ```bash
   npm install
   npm run build
   pip install jinja2
   ```

   `jinja2` renders the `.sql.j2` tests. Without it, the runner skips them.

2. Start the pinned ClickHouse server. The version is in
   [`clickhouse-version`](clickhouse-version):

   ```bash
   docker run -d --name clickhouse-upstream-tests --hostname "$(hostname)" \
     -p 8123:8123 -p 9000:9000 \
     -e CLICKHOUSE_SKIP_USER_SETUP=1 --ulimit nofile=262144:262144 \
     "clickhouse/clickhouse-server:$(tests/clickhouse-test-runner/scripts/pinned-version.sh)"
   ```

   This is the server of CI. `CLICKHOUSE_SKIP_USER_SETUP=1` keeps the default
   user of the image, which has the access management and named collection
   control that some tests need. `--hostname` gives the server the host name
   of your machine: `tests/clickhouse-test` replaces its own host name with
   `localhost` in the output, and some `.reference` files have `localhost` for
   `hostName()`. Do not use the server of the repository's
   `docker-compose.yml`: it has another version and its own `config.xml` and
   `users.xml`. If ports 8123 and 9000 are in use, map other ports and set
   `CLICKHOUSE_PORT_HTTP` and `CLICKHOUSE_PORT_TCP` for the next steps.

3. Get the upstream tests of the same version:

   ```bash
   tests/clickhouse-test-runner/scripts/fetch-upstream.sh
   ```

   The script checks out the release tag of the pinned version (for example
   `v26.10.4.207-stable`) into `tests/clickhouse-test-runner/.upstream/ClickHouse`,
   sparse and shallow. The `.reference` files of that tag were made by the
   same server build. To try another version, give it as the argument
   (`fetch-upstream.sh 26.11.1.10`) and start the server of that version. An
   LTS release has only a `-lts` tag: when the `-stable` tag does not exist,
   the script uses the `-lts` tag. Another argument is a ref, for example
   `master`. Then the tests are not of a release, and the run needs
   `ALLOW_VERSION_MISMATCH=1`.

4. Run the allowlisted tests:

   ```bash
   tests/clickhouse-test-runner/scripts/run-upstream-tests.sh -j 8
   TEST_RUNNER_BACKEND=rowbinary tests/clickhouse-test-runner/scripts/run-upstream-tests.sh -j 8
   TEST_RUNNER_BACKEND=native tests/clickhouse-test-runner/scripts/run-upstream-tests.sh -j 8
   ```

The script stops when the server and the tests are of different versions,
because then the `.reference` files do not match. It puts [`bin`](bin) first
in `PATH` for the runner only, and starts `tests/clickhouse-test` with
`--no-stateful --no-random-settings --no-random-merge-tree-settings
--dont_retry_failures`, and `--no-long` for the `native` backend. Other
arguments go to the runner after these. For
example, to run one test that is not in the allowlist:

```bash
UPSTREAM_TEST_LIST=<(echo 01277_toUnixTimestamp64) tests/clickhouse-test-runner/scripts/run-upstream-tests.sh
```

The runner prints the diff of each failed test. It keeps the output of a
failed test next to the test, in
`tests/clickhouse-test-runner/.upstream/ClickHouse/tests/queries/0_stateless/`:
`<test>.stdout` and `<test>.stderr`, with the process ID before the extension
for a test that ran in parallel.

To compare with the real `clickhouse-client`, run the same tests through it,
in the server container:

```bash
UPSTREAM_TEST_LIST=<(echo 01277_toUnixTimestamp64) \
  tests/clickhouse-test-runner/scripts/run-with-real-client.sh
```

A test that passes there and fails through the shim shows a bug in
`@clickhouse/client` or in the shim. `run-with-real-client.sh` reads the
running tests of the list only. It does not read `KNOWN_FAILURES` or
`SHARD_*`, and it does not compare the versions.

### Environment variables

| Variable                                              | Default                                                            | Description                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEST_RUNNER_BACKEND`                                 | `passthrough`                                                      | `passthrough`, `rowbinary`, `json` or `native` (see [Backends](#backends)). It also selects the default `UPSTREAM_TEST_LIST`.                   |
| `UPSTREAM_CLICKHOUSE_DIR`                             | `tests/clickhouse-test-runner/.upstream/ClickHouse`                | The checkout of `ClickHouse/ClickHouse`.                                                                                                        |
| `UPSTREAM_TEST_LIST`                                  | the allowlist of the backend (see [Backends](#backends))           | The file with the tests to run.                                                                                                                 |
| `SHARD_INDEX`, `SHARD_TOTAL`                          | `1`, `1`                                                           | Run only shard `SHARD_INDEX` of `SHARD_TOTAL` round-robin shards of the list.                                                                   |
| `KNOWN_FAILURES`                                      | (none)                                                             | Run the known failures of these groups instead (comma-separated IDs, or `all`).                                                                 |
| `CLICKHOUSE_CLIENT_CLI_LOG`                           | `tests/clickhouse-test-runner/.upstream/clickhouse-client-cli.log` | A file. Each invocation of the shim adds its arguments, statements and errors to it.                                                            |
| `CLICKHOUSE_HOST`                                     | `localhost`                                                        | The server host. The runner gives it to the shim as `--host`.                                                                                   |
| `CLICKHOUSE_PORT_TCP`, `CLICKHOUSE_PORT_HTTP`         | `9000`, `8123`                                                     | The ports of the server. The runner gives `--port=$CLICKHOUSE_PORT_TCP` (the native port); the HTTP backends use `CLICKHOUSE_PORT_HTTP` for it. |
| `CLICKHOUSE_PORT_TCP_SECURE`, `CLICKHOUSE_PORT_HTTPS` | `9440`, `8443`                                                     | The same mapping for `--secure`.                                                                                                                |
| `ALLOW_VERSION_MISMATCH`                              | `0`                                                                | `1` runs the tests also when the server and the upstream tests are of different versions.                                                       |
| `UPSTREAM_REPO_URL`                                   | the ClickHouse repository on GitHub                                | The repository that `fetch-upstream.sh` fetches the tests from.                                                                                 |
| `CLICKHOUSE_CONTAINER`                                | `clickhouse-upstream-tests`                                        | `run-with-real-client.sh` only: the server container whose `clickhouse-client` runs the tests.                                                  |

## The allowlist

[`upstream-allowlist.txt`](upstream-allowlist.txt) (`passthrough`),
[`rowbinary-allowlist.txt`](rowbinary-allowlist.txt) (`rowbinary`),
[`json-allowlist.txt`](json-allowlist.txt) (`json`) and
[`native-allowlist.txt`](native-allowlist.txt) (`native`) list the
tests that pass reliably, one test name per line. The name is the file name
without `.sql` or `.sql.j2`. `#` starts a comment. The script gives the runner
anchored regular expressions, so each name selects exactly one test. (The
runner itself matches each name as a substring, so `00396_uuid` would also
select `00396_uuid_v7`.) The harness does not try `.sh` tests.

A file has two kinds of lines:

| Line                                                | Meaning                                                                                                                                                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00001_select_1`                                    | The test runs.                                                                                                                                                                                        |
| `# 00990_request_splitting  # [error-without-type]` | A **known failure**: the test does not run, because of a bug in the client or a gap in the shim. The ID in brackets names the group. The header of the group, lower in the file, describes the cause. |

The known failures are at the end of the file, in groups. Each group starts
with a header:

```text
#-----------------------------------------------------------------------------
# [<id>] <client|shim|?>: <one-line description>
#   <the cause>
#   Reproduction:
#     <a small program that uses only the public @clickhouse/client API>
#   Issue: <the issue, or "not filed yet">
#   Tests: <the number of tests in the group>
# <test>  # [<id>]
```

`client` is a bug in `@clickhouse/client`, `@clickhouse/rowbinary` or
`@clickhouse/datatype-parser`, and only
these groups have the `Reproduction:` and `Issue:` lines. `shim` is a gap in
the shim. `?` is the `[untriaged]` group: tests that pass through the real
`clickhouse-client` and fail through the shim for a cause that is not known
yet. An ID has only lowercase letters, digits and `-`. A test that fails with
`passthrough` is not in `rowbinary-allowlist.txt` or `json-allowlist.txt`: its
group is in `upstream-allowlist.txt`.

To run the known failures of one or more groups, for example to check a fix:

```bash
KNOWN_FAILURES=error-type-from-message tests/clickhouse-test-runner/scripts/run-upstream-tests.sh
KNOWN_FAILURES=all TEST_RUNNER_BACKEND=rowbinary tests/clickhouse-test-runner/scripts/run-upstream-tests.sh
```

When the tests of a group pass, remove the `# ` at the start and the
`# [<id>]` at the end of their lines. When all tests of a group pass, remove
the group header. Then update the counts: `Running:` and `Known failures:` at
the top of the file, and `Tests:` of each group that changed.

### Grow the allowlist

1. Run the candidate tests through the harness. To try all `.sql` tests:

   ```bash
   ls tests/clickhouse-test-runner/.upstream/ClickHouse/tests/queries/0_stateless \
     | sed -nE 's/\.sql(\.j2)?$//p' | sort -u > /tmp/candidates.txt
   UPSTREAM_TEST_LIST=/tmp/candidates.txt \
     tests/clickhouse-test-runner/scripts/run-upstream-tests.sh -j 8 --no-long --timeout 120 \
       --max-failures-chain 1000000 | tee /tmp/run.log
   ```

   Do not run two sweeps at the same time on one server: the memory pressure
   on the server causes `MEMORY_LIMIT_EXCEEDED` failures that are not real.
   `--max-failures-chain` turns off a limit of the runner: by default it stops
   after 20 failures in a row, which a list of failing tests reaches at once.
   Do not rebuild the shim while a sweep runs: each test starts `dist/main.js`
   again.

2. Keep only the tests that report `[ OK ]`:

   ```bash
   sed -nE 's/^.*\] ([^ :]+): +\[ OK \].*/\1/p' /tmp/run.log | sort -u
   ```

3. Run the failed tests through the real `clickhouse-client`
   (`run-with-real-client.sh`). A test that fails there too has an
   environment cause: do not list it. Find the cause of each other test
   ([`AGENTS.md`](AGENTS.md)) and put it in its group.

4. Run the new tests again, two or more times, with a higher `-j` than CI
   (CI uses `-j 4`), on a fresh server (`docker rm -fv
clickhouse-upstream-tests`, then the `docker run` of step 2 of "Run the
   tests locally"). For example, a test that reads `system.query_log` can
   depend on the queries of other tests.

5. Run the `passthrough` tests that pass with `TEST_RUNNER_BACKEND=rowbinary`
   and `TEST_RUNNER_BACKEND=json` too, and do the same steps for
   `rowbinary-allowlist.txt` and `json-allowlist.txt`.

6. Add the new names in sorted order, above the known failures, and update the
   counts at the top.

## Build

This package is a workspace of the root `clickhouse-js` repository, so it
installs alongside (and is linked against) the local `@clickhouse/client` and
`@clickhouse/client-common` packages. Install and build everything from the
repository root (`npm install && npm run build`). The build writes
`tests/clickhouse-test-runner/dist/main.js`, which `bin/clickhouse` starts.

## Wrapper executable

`bin/clickhouse` is a small Bash script that:

- Handles the `extract-from-config --key …` shortcut directly in shell, since
  the upstream Python runner spawns this synchronously during setup and only
  ever asks for `listen_host` (we always answer `127.0.0.1`).
- Forwards every other invocation to `node dist/main.js` with the original
  arguments.

`bin/clickhouse-client` is a symlink to `bin/clickhouse` so that the upstream
runner's `clickhouse-client` invocations resolve to the same shim.
`run-upstream-tests.sh` puts `bin/` first in `PATH` for the runner only, so the
shim does not hide a real `clickhouse-client` on your machine.

## CI

[`upstream-sql-tests.yml`](../../.github/workflows/upstream-sql-tests.yml)
runs the three allowlists nightly, manually, and on pushes to `main` and PRs
that change this directory or the workflow. A change of only the `.md` files
of this directory does not start a run.

To run it on another PR, for example a change in a client, add the
`tests:run-core-sql` label
([`upstream-sql-tests-label.yml`](../../.github/workflows/upstream-sql-tests-label.yml)).
The run tests the PR as it is when the label is added, and removes the label
when it ends: to test a later push, add the label again. The token of a PR
from a fork cannot remove the label, so remove it by hand before you add it
again.

- The matrix is `{passthrough, rowbinary, json, native} × 10` round-robin
  shards of the allowlist of the backend, at `-j 4`.
- Changes to `packages/client-native` or `packages/client-common` also start
  the workflow.
- A new push to a PR cancels the older run of that PR. Nightly, manual and
  push runs do not cancel each other.
- Each job starts the stock server image of the pinned version with
  `CLICKHOUSE_SKIP_USER_SETUP=1` and the host name of the runner, as in step 2
  of "Run the tests locally".
- Each failed test fails its job. The script turns off the runner's retries
  (`--dont_retry_failures`). A failed job uploads an artifact with the output
  of the runner and its diffs, the `.stdout` and `.stderr` files of the failed
  tests, and the log of the shim (`CLICKHOUSE_CLIENT_CLI_LOG`).
- The server version and the upstream tests are pinned together in
  [`clickhouse-version`](clickhouse-version). A new ClickHouse release changes
  nothing in CI, so a PR never fails because of a release that it does not
  touch. A bump is a PR of its own; the steps are in
  [`AGENTS.md`](AGENTS.md#bump-the-server-version). The `clickhouse_version`
  input of a manual run tries another version without a commit.
- When an allowlisted test is not in the checkout (upstream renamed or removed
  it), the run shows a warning with the names.
- If a shard takes much more than 10 minutes, increase the number of shards:
  change the `shard` list and `SHARD_TOTAL` together.

## Local development

From this directory, after `npm install` in the repository root:

- `npm run build` — compile TypeScript to `dist/`.
- `npm run typecheck` — run `tsc --noEmit`.
- `npm run lint` — run ESLint with `--max-warnings=0`.
- `npm test` — run the Vitest unit suite (`__tests__/**/*.test.ts`).

## How the shim imitates clickhouse-client

The shim sends nothing that `clickhouse-client` does not send, because some
tests read their own queries from `system.query_log`. Only the flags and
behaviors that `tests/clickhouse-test` uses are implemented; the `shim` groups
of the allowlists list the known gaps. The statement splitter and the test
hints are ported from the harness of clickhouse-connect.

- **Port.** `--port` is the native TCP port of `clickhouse-client`.
  `clickhouse-test` passes `--port=$CLICKHOUSE_PORT_TCP`. The `native` backend
  uses it as given (default `9000`, or `9440` with `--secure`). The HTTP
  backends map it to `CLICKHOUSE_PORT_HTTP` (default `8123`; `9440` maps to
  `CLICKHOUSE_PORT_HTTPS`, default `8443`), and use any other port as an HTTP
  port.
- **Session.** Over HTTP, the shim sends a `session_id`, and after `USE` it
  makes a client with the new database in the same session. Over the native
  protocol, the TCP connection is the session, so the shim keeps it after
  `USE`: the server already switched its database.
- **Statements** ([`src/split.ts`](src/split.ts)). The `-- Tags:` header is not
  part of a statement. A statement ends at a top-level `;` and goes to the
  server with its `;`. A comment on the same line after the `;` belongs to the
  statement. The inline data of `INSERT ... FORMAT <name>` (other than
  `Values`) ends at an empty line. Every statement runs, with or without
  `--multiquery` (`-n`).
- **Test hints** ([`src/test-hint.ts`](src/test-hint.ts)).
  `-- { serverError X }`, `-- { clientError X }` and `-- { error X }` make the
  error the expected result. `X` is a list of codes or names;
  [`src/error-codes.ts`](src/error-codes.ts) maps the names to codes, as
  `clickhouse-client` does. The error must have one of these codes. The shim
  also checks that `ClickHouseError.type` is the name of the code, because a
  user reads it. An error hint in a leading comment is ignored. Over HTTP the
  server finds all errors, so a server error can satisfy a `clientError` hint.
  `-- { echo }`, `-- { echoOn }` and `-- { echoOff }` count in any comment and
  print the statements before their results, except a statement with a syntax
  error that the server finds before it analyzes the query. The first result
  that does not match its hint stops the shim. `-- { retry ... }` is not
  supported.
- **Session** ([`src/backends/shared.ts`](src/backends/shared.ts)). Each
  invocation has one `session_id`, so `SET`, `USE` and temporary tables last
  for the whole invocation. The client sends its `database` with each request,
  and that database replaces the current database of the session, so after a
  `USE` the shim makes a client with the new database (on the same session).
- **Settings and parameters.** The server settings of the command line go
  with each request, as `clickhouse-client` sends them; a `SET` of the same
  setting in the test removes it, because the session then has the value.
  `--param_<name>=<value>` gives a query parameter to each statement that has
  a `{<name>:<type>}` placeholder.
- **Output.** The shim sends the format of the backend as `default_format`
  (`query()` of the `json` backend does the same) and does not change the
  query text. A statement with a `FORMAT` clause, also with a quoted name
  (``FORMAT `Null` ``), gets that format.
- **Errors.** An unexpected error stops the shim. It writes the error to
  stderr and exits with the code 1.

[`scripts/gen-error-codes.sh`](scripts/gen-error-codes.sh) generates
`src/error-codes.ts` from `src/Common/ErrorCodes.cpp` of the upstream checkout.
`fetch-upstream.sh` runs it; commit the file when it changes.

The `SERVER_SETTINGS` and `CLIENT_ONLY_SETTINGS` allowlists in
[`src/settings.ts`](src/settings.ts) are copied from the Java port and may
need a resync as ClickHouse adds or reclassifies settings.
