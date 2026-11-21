# Recommendations for AI agents — upstream SQL test harness

Guidance for the [`clickhouse-test-runner`](.) harness. See the [repo-root `AGENTS.md`](../../AGENTS.md) for cross-cutting guidance.

This harness is a Node.js port of `clickhouse-client` that lets the official ClickHouse Python test runner (`tests/clickhouse-test`) run upstream SQL tests through `@clickhouse/client` and `@clickhouse/client-native`.

## What the harness does

- The CLI (`bin/clickhouse` → `dist/main.js`) accepts the upstream flags, the `extract-from-config` shortcut, and SQL via stdin or `--query`.
- The runner is an npm workspace. Install and build from the repository root (`npm install && npm run build`) to test both clients from the local checkout.
- CI runs against ClickHouse `latest`. The jobs divide their allowlists into round-robin shards with `SHARD_INDEX` and `SHARD_TOTAL`. If the shards take more than about one minute each, adjust both the `shard` matrix values and `SHARD_TOTAL`.
- The runner forwards the names from its allowlist to `tests/clickhouse-test`. The default is [`upstream-allowlist.txt`](upstream-allowlist.txt). The other CI jobs use [`rowbinary-allowlist.txt`](rowbinary-allowlist.txt) and [`native-allowlist.txt`](native-allowlist.txt). Each line contains one name or a comment that starts with `#`.
- The upstream suite is pinned by `UPSTREAM_REF` in the workflow to the release tag matching the `latest` server image. When `latest` moves to a new release, reference outputs drift and many tests fail at once with no client change (this happened on 2026-10-25, 26.9 → 26.10). Before suspecting the client, compare the server version in a green and a red run; then bump the pin, try it with the `upstream_ref` dispatch input, and A/B the remaining failures against the `release` branch to rule out a client regression.
- The `SERVER_SETTINGS`/`CLIENT_ONLY_SETTINGS` allowlists in [`src/settings.ts`](src/settings.ts) are copied from the Java port and may need periodic resync as ClickHouse adds or reclassifies settings.

See [`README.md`](README.md) for build, usage, and environment-variable documentation. When harness behavior changes (new wrapper flags, new short-circuited keys in `bin/clickhouse`, new entries in the settings allowlists), review the README and [`.github/workflows/upstream-sql-tests.yml`](../../.github/workflows/upstream-sql-tests.yml) to keep them in sync with the implementation.

## Strategy for growing the allowlist

The allowlist is grown in **batches of ~100 candidate tests at a time**, in upstream filename order, following this loop:

1. **Pre-filter the candidate batch.** Skip non-SQL tests (`.sh`, `.py`, `.j2`) and tests tagged for unsupported infrastructure (`shard`, `distributed`, `replicated`, `zookeeper`, `kafka`, `s3`, `mysql`, `tls`, etc.). These will never pass through this harness as it stands today.
2. **Run each candidate through the harness** with `--no-stateful --no-long`. **Only keep tests that report `[ OK ]`**; drop failures and skips.
3. **Use the same server version and runner options as CI.** See the [README](README.md#ci) for each backend.
4. **Beware substring/prefix expansion.** `tests/clickhouse-test` treats positional arguments as **substring/prefix matches** rather than exact names, so an allowlist entry like `00396_uuid` will silently pull in `00396_uuid_v7`, `00712_prewhere_with_alias` will pull in `00712_prewhere_with_alias_bug_2`, etc. When adding an entry whose name is a prefix of any other test in `0_stateless`, prefer the longest unambiguous form, or accept that the siblings come along and verify they all pass.
5. **Prune flakes promptly.** If a previously-passing test starts to flake on the nightly run, remove it (or its prefix-expanded siblings) from the allowlist rather than retrying — the allowlist exists to be a stable green signal, not a TODO list.
