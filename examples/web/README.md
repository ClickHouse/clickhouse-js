# `@clickhouse/client-web` examples

Examples for the Web client. They may only use Web-platform APIs (e.g.
`globalThis.crypto.randomUUID()` instead of Node's `crypto` module) and must
not depend on Node-only modules.

Each subfolder is a self-contained corpus for one use case, suitable for
backing a focused AI agent skill:

- [`coding/`](coding/) — day-to-day API usage: connect, configure, ping, basic
  insert/select, parameter binding, sessions, data types, custom JSON handling.
- [`troubleshooting/`](troubleshooting/) — abort/cancel, long-running query
  progress, server error surfaces, and number-precision pitfalls.
- [`security/`](security/) — RBAC (roles and read-only users) and
  SQL-injection-safe parameter binding.
- [`schema-and-deployments/`](schema-and-deployments/) — `CREATE TABLE` for
  single-node, on-prem cluster, and ClickHouse Cloud, plus column-shape
  features and deployment-shaped connection strings.

There is no `performance/` folder for the Web client because every performance
example depends on Node-only APIs (Node streams, `node:fs`, Parquet file I/O).
For those scenarios, see [`examples/node/performance/`](../node/performance/).

Some examples appear in more than one folder on purpose so each skill remains
self-contained — see the
[full list and editing rules](../README.md#editing-duplicated-examples) and the
[top-level `examples/README.md`](../README.md) for the complete table of
examples and instructions on how to run them.
