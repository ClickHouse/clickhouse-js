# Recommendations for AI agents — upstream SQL test harness

Guidance for the [`clickhouse-test-runner`](.) harness. See the [repo-root `AGENTS.md`](../../AGENTS.md) for cross-cutting guidance, and [`README.md`](README.md) for how the harness works and how to run it.

This harness runs the ClickHouse core SQL tests (`tests/queries/0_stateless`) through `@clickhouse/client`. It has the same design as the harnesses of `clickhouse-cs`, `clickhouse-connect` and `clickhouse-cpp`.

## The goal

The goal is to find bugs in the client. To pass more tests is not the goal. A failed test is information. Do not hide it.

## Rules

1. **Find the cause of a failure before you do anything with the test.** A test fails for one of three causes:
   - **The client**: `@clickhouse/client` (the HTTP transport, sessions, settings, query parameters, error parsing) or, for the `rowbinary` backend, `@clickhouse/rowbinary`. This is what the harness is for.
   - **The shim** (the program in this directory). It does not do what `clickhouse-client` does.
   - **The environment.** The test cannot pass through any client on this server (see [Environment causes](#environment-causes)).
2. **The default for a client bug is a fix in the client**, in a PR of its own, with a regression test in the package (read the `AGENTS.md` of the package first) and a changelog entry. In the same PR, enable the tests of its known-failure group and update the counts. Keep changes to harness logic in a separate PR. A PR that changes only a client does not start the harness workflow: add the `tests:run-core-sql` label (see the README, CI).
3. **The default for a shim bug is a fix in the shim.** Make the shim copy `clickhouse-client` more exactly. Do not change the shim to hide a client bug, for example by another read method, a type-name workaround, or a correction of a wrong value. The shim must use the client as a user does: `createClient`, `query`, `command`, `exec` and `insert` of the public API.
4. **Remove a test from an allowlist only when it cannot pass for an environment cause.** Write the reason in the commit message.
5. **A test that fails because of a client bug or a shim gap stays visible.** Do not delete it. Put it in the allowlist of its backend as a known failure, `# <test>  # [<id>]`, in the group of its cause. Each group has a header that describes the cause. The header of a client group also gives a small reproduction (public API only) and an `Issue:` line. Make a new group when no group fits. See the README for the format and for how to run one group (`KNOWN_FAILURES=<id>`).
6. **Do not list a test that cannot pass for an environment cause.**

## How to find the cause

Do these steps in this order. Build once from the repository root (`npm install && npm run build`).

1. **Run the test through the harness**, with both backends:

   ```bash
   UPSTREAM_TEST_LIST=<(echo <test>) CLICKHOUSE_CLIENT_CLI_LOG=/tmp/cli.log \
     tests/clickhouse-test-runner/scripts/run-upstream-tests.sh
   UPSTREAM_TEST_LIST=<(echo <test>) TEST_RUNNER_BACKEND=rowbinary \
     tests/clickhouse-test-runner/scripts/run-upstream-tests.sh
   ```

   A test that passes with `passthrough` and fails with `rowbinary` points to `@clickhouse/rowbinary` or to the TSV writer of the shim ([`src/tsv-serialize.ts`](src/tsv-serialize.ts)), not to the transport.

2. **Run the test through the real `clickhouse-client`** in the server container, on the same server:

   ```bash
   UPSTREAM_TEST_LIST=<(echo <test>) tests/clickhouse-test-runner/scripts/run-with-real-client.sh
   ```

   If it also fails here, the cause is the environment. If it passes here, the cause is the client or the shim. Note that the real client uses the native protocol: a test can fail over HTTP for a cause of the HTTP interface itself (see below).

3. **Find the statement that fails.** The log of `CLICKHOUSE_CLIENT_CLI_LOG` shows each statement and the error. Read the diff in the output of the runner, and the `.stdout` and `.stderr` files next to the test.
4. **Compare the shim with the server on that one statement.** Run it through the shim (`tests/clickhouse-test-runner/bin/clickhouse-client --query "<SQL>"`) and through `curl` with `FORMAT TSV`. Then make the statement smaller until it is as small as possible.
5. **Decide between the client and the shim with a small program** that uses only the public API of `@clickhouse/client` (`createClient`, `query`, `command`, `ResultSet.text()` or `.json()`). If the program also gives a wrong value or an error, the bug is in the client. If the program gives the correct value, the bug is in the shim.

### Environment causes

Find the cause on the server of CI: the stock image of the pinned version with `CLICKHOUSE_SKIP_USER_SETUP=1` and `--hostname` (see the README, "Run the tests locally"). A server with other users or another configuration, such as the one of the repository's `docker-compose.yml`, gives other failures.

A test cannot pass through any client on the CI server when it needs one of these:

- A cluster, shards or replicas (`CLUSTER_DOESNT_EXIST`, `test_shard_localhost`).
- ZooKeeper or Keeper (`NO_ZOOKEEPER`, `Replicated*` engines).
- External services: S3, Azure, HDFS, Kafka, MySQL, PostgreSQL, MongoDB, URL sources.
- Server configuration of the upstream CI: named collections, dictionaries, storage policies, disks, users and grants, macros (`NAMED_COLLECTION_DOESNT_EXIST`, `NO_ELEMENTS_IN_CONFIG`, `UNKNOWN_POLICY`, `UNKNOWN_DISK`).
- Features that the server build or platform does not have (`SUPPORT_IS_DISABLED`).
- Stateful datasets (`--no-stateful`) or long tests (`--no-long`).
- Behavior of the HTTP interface itself. For example, an HTTP request fails when the current database of the session was dropped: the client names that database in each request.
- Features of `clickhouse-client` itself that are not part of a driver: `INTO OUTFILE`, `FROM INFILE`, client-side parsing of `INSERT` data, the progress and profile-event output, and client-only settings.
- Tests that conflict with other tests of the set: a fixed table UUID, or server state that a test leaves behind (failpoints, row policies). Such a test passes alone on a fresh server and fails in a full run.
- Memory limits of the server, when the test also fails through the real `clickhouse-client`.
- Load from parallel tests. Some `EXPLAIN PIPELINE` and `EXPLAIN ANALYZE` outputs change when many tests run at the same time.
- The host name of the server (see `--hostname` in the README).
- A test that fails now and then also through the real `clickhouse-client`, when it runs alone. Run it ten times or more alone, through the shim and through the real client, before you decide this.

These are **not** environment causes. Find the bug:

- A value that is different from the server's value.
- A decode error, or an exception from inside `@clickhouse/client` or `@clickhouse/rowbinary`, for a statement that the server accepts.
- A wrong error code or error type in a client error (the test hint compares them).
- A query text that the client changed, or a setting that the client sends with each request, when a test sees it.

## Conditions for the allowlist

- Add a test only when it passes.
- Run new tests three times, also with a higher `-j` than CI (CI uses `-j 4`), on a **fresh** server (`docker rm -fv clickhouse-upstream-tests`, then the `docker run` of the README). A test that passes only after other tests ran must not go in.
- Do not run two sweeps at the same time on one server. The memory pressure causes `MEMORY_LIMIT_EXCEEDED` failures that are not real.
- CI does not run failed tests again (`--dont_retry_failures`). A test must pass without retries before you add it.
- When a test in an allowlist starts to fail sometimes, find the cause first (rule 1). Remove it only when the cause is in the environment or in the test itself, and write the reason.
- `rowbinary-allowlist.txt` is a subset of `upstream-allowlist.txt`: a test that fails with `passthrough` cannot pass with `rowbinary`.

## Bump the server version

The server version and the upstream tests are pinned together in [`clickhouse-version`](clickhouse-version). A new ClickHouse release changes nothing in CI until a PR bumps the pin, so other PRs do not fail because of a release. Bump the pin in a PR of its own, and make that PR pass before it merges:

1. Select the version: a full version with a server image tag and a `v<version>-stable` or `v<version>-lts` tag upstream, normally the version of the `latest` image.
2. Try it: start a manual run with the `clickhouse_version` input, or run the allowlists locally on that version (`fetch-upstream.sh <version>`, and a fresh server of that version).
3. For each allowlisted test that now fails, find the cause (rule 1). A release changes the tests and the server output, so many tests can fail at the same time with no change in the client. Run the same test through the real client (`run-with-real-client.sh`) on the same server.
4. Run the known failures (`KNOWN_FAILURES=all`), with both backends. Enable the tests that pass now.
5. Fix the names of allowlisted tests that the run reports as not in the checkout (upstream renamed or removed them).
6. You can also try the new tests of the release (see "Grow the allowlist" in the README).
7. Change `clickhouse-version`, run `fetch-upstream.sh`, and commit the `src/error-codes.ts` that it generates.

## Keep the documents in sync

When you change the behavior of the shim (flags, statement handling, output formats, settings, backends), update [`README.md`](README.md), this file and [`.github/workflows/upstream-sql-tests.yml`](../../.github/workflows/upstream-sql-tests.yml) in the same change. The `SERVER_SETTINGS`/`CLIENT_ONLY_SETTINGS` allowlists in [`src/settings.ts`](src/settings.ts) are copied from the Java port and may need a resync as ClickHouse adds or reclassifies settings.
