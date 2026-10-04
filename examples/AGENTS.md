# Recommendations for AI agents — `examples/`

Guidance for the example corpus. See the [repo-root `AGENTS.md`](../AGENTS.md) for cross-cutting guidance.

The [`examples`](.) directory is being refactored to be AI-agent-friendly. The goals of the refactor are:

1. Examples should be runnable right away, with no manual edits required to get them working against a
   local ClickHouse instance (use `docker-compose up` from the repo root for the default setup).
2. Examples are organized by client flavor and tailored to the corresponding runtime:
   - [`examples/node`](node) — examples for the Node.js client (`@clickhouse/client`). These
     may freely use Node.js-only APIs (file streams, TLS, `http`, `node:*` built-ins, etc.) and import
     Node built-ins using the `node:` prefix (e.g., `node:fs`, `node:path`, `node:stream`).
   - [`examples/web`](web) — examples for the Web client (`@clickhouse/client-web`). These
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
   are listed in [`examples/README.md`](README.md#editing-duplicated-examples).
