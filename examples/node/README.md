# `@clickhouse/client` examples (Node.js)

Examples for the Node.js client. They may freely use Node-only APIs (file
streams, TLS, `http`, `node:*` built-ins, etc.).

Each subfolder is a self-contained corpus for one use case, suitable for
backing a focused AI agent skill:

- [`coding/`](coding/) — day-to-day API usage: connect, configure, ping, basic
  insert/select, parameter binding, sessions, data types, custom JSON handling.
- [`performance/`](performance/) — async inserts, streaming with backpressure,
  file/Parquet streams, progress streaming, and `INSERT FROM SELECT`. Node-only.
- [`troubleshooting/`](troubleshooting/) — abort/cancel, timeouts, long-running
  query progress, server error surfaces, and number-precision pitfalls.
- [`security/`](security/) — TLS (basic and mutual), RBAC (roles and read-only
  users), and SQL-injection-safe parameter binding.
- [`schema-and-deployments/`](schema-and-deployments/) — `CREATE TABLE` for
  single-node, on-prem cluster, and ClickHouse Cloud, plus column-shape
  features and deployment-shaped connection strings.

Some examples appear in more than one folder on purpose so each skill remains
self-contained — see the
[full list and editing rules](../README.md#editing-duplicated-examples) and the
[top-level `examples/README.md`](../README.md) for the complete table of
examples and instructions on how to run them.

Shared fixture data lives in [`resources/`](resources/) and is referenced from
example files via paths relative to the parent `examples/` directory (the
Vitest setup `chdir`s there before running).
