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

2. When adding new log messages with suggestions for users, make sure to create a unique documentation page under the `docs/` directory (use `docs/howto/` for task-style guides; see `docs/socket_hang_up_econnreset.md` as a reference) with a detailed explanation of the issue and how to resolve it. Then, include a link to that documentation page in the log message. For example:

   ```ts
   if (some_condition) {
     log_writer.warn({
       message:
         'Example log message with suggestions for users. For more information, see https://github.com/ClickHouse/clickhouse-js/blob/main/docs/socket_hang_up_econnreset.md',
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
     streaming, server-side bulk moves. Mostly Node-only; `examples/web/performance/` exists for the
     few perf scenarios that work in the browser (e.g. streaming `JSONEachRow`).
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

## Skills

The repository ships AI-agent skills from the repo-root [`skills/`](skills) directory (currently
`clickhouse-js-node-coding/` and `clickhouse-js-node-troubleshooting/`). Each skill has a `SKILL.md`
(with `name` + `description` frontmatter), a `reference/` folder, and `evals/evals.json`.

- Keep skills at the repo root: the `client-node` package's `prepack` script copies `skills/` into
  `@clickhouse/client` so it lands under `node_modules/@clickhouse/client/skills/` after install.
  Each shipped skill must also be listed in the `agents.skills` array of
  [`packages/client-node/package.json`](packages/client-node/package.json) so downstream tooling can
  discover it. The [`Skills E2E`](.github/workflows/e2e-skills.yml) workflow
  (`tests/e2e/skills/check.js`) asserts that the packaged tarball contains the declared skills.
- Each skill is sourced from the matching `examples/node/<folder>/` corpus. When you add or change
  examples in a folder that backs a skill, update the corresponding `reference/*.md` and consider
  extending `evals/evals.json`.
- For repo-local agent setup (Node version, installs, `docker compose up`, test/lint commands), use
  the on-demand [`.claude/skills/setup/SKILL.md`](.claude/skills/setup/SKILL.md) skill rather than
  re-introducing a `copilot-setup-steps.yml` workflow (intentionally removed).

## Embedded docs

The [`docs/`](docs) directory holds long-form troubleshooting / how-to pages that log messages and
skill references can link to (e.g. `docs/socket_hang_up_econnreset.md`, `docs/howto/`). Prefer
adding new pages here over linking out to external docs from log messages.

## Upstream SQL test harness

The [`tests/clickhouse-test-runner`](tests/clickhouse-test-runner) harness is a Node.js port of `clickhouse-client` that allows the official ClickHouse Python test runner (`tests/clickhouse-test`) to drive a subset of the upstream SQL test suite against `@clickhouse/client`.

- Refer to [`tests/clickhouse-test-runner/README.md`](tests/clickhouse-test-runner/README.md) for build, usage, and environment-variable documentation. The curated list of passing tests is maintained in [`upstream-allowlist.txt`](tests/clickhouse-test-runner/upstream-allowlist.txt).
- When the harness's behavior changes—such as new wrapper flags, new short-circuited keys in `bin/clickhouse`, or new entries in the `SERVER_SETTINGS`/`CLIENT_ONLY_SETTINGS` allowlists in [`src/settings.ts`](tests/clickhouse-test-runner/src/settings.ts)—review the README and [`.github/workflows/upstream-sql-tests.yml`](.github/workflows/upstream-sql-tests.yml) to ensure they stay synchronized with the implementation.

## When reviewing code changes

For every pull request review, make sure to provide an evaluation of the following aspects:

### Security implications

1. This repository is a client library for ClickHouse, which is a database management system. When reviewing code changes, it is important to consider the security implications of the changes. For example, if the code changes involve handling user input or interacting with external systems, it is important to ensure that the code is secure and does not introduce vulnerabilities such as SQL injection or cross-site scripting (XSS).

2. Additionally, when reviewing code changes, it is important to consider the potential impact on data privacy and compliance with relevant regulations such as GDPR or CCPA. For example, if the code changes involve handling personally identifiable information (PII), it is important to ensure that the code is designed to protect user privacy and comply with relevant regulations.

### API quality and stability

1. When reviewing code changes, it is important to consider the impact on the API quality and stability. For example, if the code changes involve modifying the library's public API surface (such as exported functions, classes, or types) or adding new public APIs, it is important to ensure that the changes are well-documented and do not break existing functionality for users of the library.

2. When introducing new features or making changes to the API, make sure the PR description includes a concise, human-readable CHANGELOG entry (followed by an example usage if applicable) so it can be folded into `CHANGELOG.md` at release time. This matches the PR template checklist item ("A human-readable description of the changes was provided to include in CHANGELOG").

3. Additionally, make sure that the official documentation is in sync with the changes.
