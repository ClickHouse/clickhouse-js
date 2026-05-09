# Recommendations for AI agents

> **Audience:** This file contains guidance for AI agents contributing to the `ClickHouse/clickhouse-js` repository itself. It is **not** intended for downstream projects that depend on `@clickhouse/client` or `@clickhouse/client-web`

1. When adding log messages, make sure to use eager log level checks to avoid unnecessary calculations for log messages that will not be emitted. For example:

   ```ts
   if (log_level <= ClickHouseLogLevel.WARN) {
     log_writer.warn({
       message: 'Example log message',
     })
   }
   ```

2. When adding new log messages with suggestions for users, make sure to create a unique documentation page in the `docs` directory with a detailed explanation of the issue and how to resolve it. Then, include a link to that documentation page in the log message. For example:

   ```ts
   if (some_condition) {
     log_writer.warn({
       message:
         'Example log message with suggestions for users. For more information, see https://github.com/ClickHouse/clickhouse-js/blob/main/docs/example-log-message.md',
     })
   }
   ```

## Examples

The repository contains an [`examples`](examples) directory that is being refactored to be AI-agent-friendly.
The goals of the refactor are:

1. Examples should be runnable right away, with no manual edits required to get them working against a
   local ClickHouse instance (use `docker-compose up` from the repo root for the default setup).
2. Examples are organized by client flavor and tailored to the corresponding runtime:
   - [`examples/node`](examples/node) — examples for the Node.js client (`@clickhouse/client`). These
     may freely use Node.js-only APIs (file streams, TLS, `http`, `node:*` built-ins, etc.) and import
     Node built-ins using the `node:` prefix (e.g., `node:fs`, `node:path`, `node:stream`).
   - [`examples/web`](examples/web) — examples for the Web client (`@clickhouse/client-web`). These
     must only use Web-platform APIs (e.g., `globalThis.crypto.randomUUID()` instead of Node's
     `crypto` module) and must not depend on Node.js-only modules.
3. `examples/node` and `examples/web` are independent npm packages, each with its own `package.json`,
   `tsconfig.json`, and ESLint config. Keep dependencies and configuration scoped to the relevant
   subpackage.
4. General-purpose scenarios (configuration, ping, inserts, selects, parameters, sessions, etc.) should
   exist in both subdirectories where applicable, with the only differences being the `import`
   statement and any platform-specific adjustments. Examples that rely on Node.js-only APIs live only
   under `examples/node`.
5. Within each subpackage, examples are split into intent-driven **use-case folders** so each folder
   can back a focused AI agent skill:
   - `coding/` — day-to-day client API usage (configure, ping, basic insert/select, parameter
     binding, sessions, data types, custom JSON).
   - `performance/` — async inserts, streaming with backpressure, file/Parquet streams, progress
     streaming, server-side bulk moves. Node-only (no `performance/` folder under `examples/web`).
   - `troubleshooting/` — cancellation, timeouts, long-running query progress, server error surfaces,
     number-precision pitfalls.
   - `security/` — TLS, RBAC, SQL-injection-safe parameter binding.
   - `schema-and-deployments/` — `CREATE TABLE` examples for each deployment shape and
     deployment-shaped connection strings.
6. A small number of examples are **intentionally duplicated** across folders so each folder is a
   self-contained skill corpus. Each duplicated example has one _primary_ location; the secondary
   copies are excluded from the Vitest runner via the per-package `vitest.config.ts`. When you edit
   a duplicated example, update **all** copies. The current duplicates and their primary locations
   are listed in [`examples/README.md`](examples/README.md#editing-duplicated-examples).

## Upstream SQL test harness

The [`tests/clickhouse-test-runner`](tests/clickhouse-test-runner) harness is a Node.js port of `clickhouse-client` that allows the official ClickHouse Python test runner (`tests/clickhouse-test`) to drive a subset of the upstream SQL test suite against `@clickhouse/client`.

### What the harness does

- Wraps `@clickhouse/client` in a tiny CLI (`bin/clickhouse` → `dist/main.js`) that mimics enough of the upstream `clickhouse-client` binary (same flags, `extract-from-config` shortcut, stdin/`--query` behavior) for the Python `tests/clickhouse-test` runner to drive it without modification.
- Two backend implementations selectable via `CLICKHOUSE_CLIENT_CLI_IMPL`: `client` (uses `@clickhouse/client`) and `http` (raw `fetch` to port 8123). The CI matrix runs both against ClickHouse `latest` and `head` so that we cover both code paths and detect server regressions.
- Reads the curated test list from [`upstream-allowlist.txt`](tests/clickhouse-test-runner/upstream-allowlist.txt) (one test name per line, `#` for comments) and forwards them as positional arguments to `tests/clickhouse-test`.
- The `SERVER_SETTINGS`/`CLIENT_ONLY_SETTINGS` allowlists in [`src/settings.ts`](tests/clickhouse-test-runner/src/settings.ts) are copied from the Java port and may need periodic resync as ClickHouse adds or reclassifies settings.

See [`tests/clickhouse-test-runner/README.md`](tests/clickhouse-test-runner/README.md) for build, usage, and environment-variable documentation. When harness behavior changes (new wrapper flags, new short-circuited keys in `bin/clickhouse`, new entries in the settings allowlists), review the README and [`.github/workflows/upstream-sql-tests.yml`](.github/workflows/upstream-sql-tests.yml) to keep them in sync with the implementation.

### Strategy for growing the allowlist

The allowlist is grown in **batches of ~100 candidate tests at a time**, in upstream filename order, following this loop:

1. **Pre-filter the candidate batch.** Skip non-SQL tests (`.sh`, `.py`, `.j2`) and tests tagged for unsupported infrastructure (`shard`, `distributed`, `replicated`, `zookeeper`, `kafka`, `s3`, `mysql`, `tls`, etc.). These will never pass through this harness as it stands today.
2. **Run each candidate against both backends** (`CLICKHOUSE_CLIENT_CLI_IMPL=client` and `=http`) using the harness, with `--no-stateful --no-long`. **Only keep tests that report `[ OK ]` on both backends**; drop failures and skips.
3. **Validate against the CI matrix before committing**, not just one local server version. The CI workflow runs `{client, http} × {ClickHouse latest, head}` — a test that passes locally on `head` may fail on `latest` (or vice versa) and break CI.
4. **Beware substring/prefix expansion.** `tests/clickhouse-test` treats positional arguments as **substring/prefix matches** rather than exact names, so an allowlist entry like `00396_uuid` will silently pull in `00396_uuid_v7`, `00712_prewhere_with_alias` will pull in `00712_prewhere_with_alias_bug_2`, etc. When adding an entry whose name is a prefix of any other test in `0_stateless`, prefer the longest unambiguous form, or accept that the siblings come along and verify they all pass on both backends.
5. **Prune flakes promptly.** If a previously-passing test starts to flake on the nightly run, remove it (or its prefix-expanded siblings) from the allowlist rather than retrying — the allowlist exists to be a stable green signal, not a TODO list.

## When reviewing code changes

For every pull request review, make sure to provide an evaluation of the following aspects:

### Security implications

1. This repository is a client library for ClickHouse, which is a database management system. When reviewing code changes, it is important to consider the security implications of the changes. For example, if the code changes involve handling user input or interacting with external systems, it is important to ensure that the code is secure and does not introduce vulnerabilities such as SQL injection or cross-site scripting (XSS).

2. Additionally, when reviewing code changes, it is important to consider the potential impact on data privacy and compliance with relevant regulations such as GDPR or CCPA. For example, if the code changes involve handling personally identifiable information (PII), it is important to ensure that the code is designed to protect user privacy and comply with relevant regulations.

### API quality and stability

1. When reviewing code changes, it is important to consider the impact on the API quality and stability. For example, if the code changes involve modifying the library's public API surface (such as exported functions, classes, or types) or adding new public APIs, it is important to ensure that the changes are well-documented and do not break existing functionality for users of the library.

2. When introducing new features or making changes to the API make sure to update the CHANGELOG.md file with a concise description of the changes followed with an example usage if applicable.

3. Additionally, make sure that the official documentation is in sync with the changes.
