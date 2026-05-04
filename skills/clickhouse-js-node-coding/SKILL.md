---
name: clickhouse-js-node-coding
description: >
  Write idiomatic application code with the ClickHouse Node.js client
  (`@clickhouse/client`). Use this skill whenever a user is *building* against
  the Node.js client — configuring the client, pinging, inserting rows in JSON
  or raw formats, selecting and parsing results, binding query parameters,
  managing sessions and temporary tables, working with data types like
  `Date`/`DateTime`/`Decimal`/`Time`/`Time64`/`Dynamic`/`Variant`/`JSON`, or
  customizing JSON parsing. Trigger on phrases like "how do I insert…", "how
  do I select…", "what format should I use…", "how do I parameterize…", "how
  do I configure the client…". Do NOT use for browser/Web client code, for
  performance/streaming/Parquet questions (see clickhouse-js-node-performance),
  or for diagnosing errors and unexpected behavior (see
  clickhouse-js-node-troubleshooting).
---

# ClickHouse Node.js Client — Coding

Reference: https://clickhouse.com/docs/integrations/javascript

> **⚠️ Node.js runtime only.** This skill covers the `@clickhouse/client`
> package running in a **Node.js runtime** exclusively — including **Next.js
> Node runtime** API routes, React Server Components, Server Actions, and
> standard Node.js processes. Do **not** apply this skill to browser client
> components, Web Workers, **Next.js Edge runtime**, Cloudflare Workers, or
> any usage of `@clickhouse/client-web`. For browser/edge environments, the
> correct package is `@clickhouse/client-web`.

---

## How to Use This Skill

1. **Match the user's intent** to a row in the Task Index below and read the
   corresponding reference file before writing code.
2. **Always import from `@clickhouse/client`** (never `@clickhouse/client-web`)
   and create a single client with `createClient({ url })`. Close it with
   `await client.close()` during graceful shutdown.
3. **Prefer `JSONEachRow` for typical row inserts/selects** unless the user
   has already chosen another format or is streaming raw bytes (CSV / TSV /
   Parquet — those belong to the performance skill).
4. **Always use `query_params` for user-supplied values** — never template-
   literal-interpolate them into SQL. See `reference/query-parameters.md`.
5. **Pick the right method for the job:**
   - `client.insert()` — write rows.
   - `client.query()` + `resultSet.json()` / `.text()` / `.stream()` — read
     rows that return data.
   - `client.command()` — DDL and other statements that don't return rows
     (`CREATE`, `DROP`, `TRUNCATE`, `ALTER`, `SET` in a session, etc.).
   - `client.exec()` — when you need the raw response stream of an arbitrary
     statement (rare in coding scenarios).
   - `client.ping()` — health check; returns `{ success, error? }`, never
     throws on connection failure.
6. **Note version constraints** when relevant. Examples:
   - `pathname` config option: client `>= 1.0.0`.
   - `BigInt` values in `query_params`: client `>= 1.15.0`.
   - `TupleParam` and JS `Map` in `query_params`: client `>= 1.9.0`.
   - Configurable `json.parse` / `json.stringify`: client `>= 1.14.0`.
   - `Time` / `Time64` data types: ClickHouse server `>= 25.6`.
   - `Dynamic` / `Variant` / new `JSON` types: ClickHouse server `>= 24.1` /
     `24.5` / `24.8` (no longer experimental since `25.3`).
7. **Show a runnable snippet**, not pseudo-code. The examples in
   [`examples/node/coding/`](https://github.com/ClickHouse/clickhouse-js/tree/main/examples/node/coding)
   are all self-contained and runnable against the repo's `docker-compose up`
   setup — pattern your snippet after them.

---

## Task Index

Identify the user's task and read the matching reference file.

| Task                                                     | Triggers / symptoms                                                                                        | Reference file                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Configure / connect the client**                       | Building a `createClient` call, URL parameters, `clickhouse_settings`, default format, custom HTTP headers | `reference/client-configuration.md` |
| **Ping the server**                                      | Health checks, readiness probes, "is ClickHouse up?"                                                       | `reference/ping.md`                 |
| **Choose an insert format**                              | "Which format should I use to insert?", JSON vs raw, `JSONEachRow` vs `JSON` vs `JSONObjectEachRow`        | `reference/insert-formats.md`       |
| **Insert into a subset of columns / different database** | `insert({ columns })`, excluding columns, ephemeral columns, cross-DB inserts                              | `reference/insert-columns.md`       |
| **Insert values, expressions, dates, decimals**          | `INSERT … VALUES` with SQL functions, `Date`/`DateTime` from JS, `Decimal` precision, `INSERT … SELECT`    | `reference/insert-values.md`        |
| **Async inserts (server-side batching)**                 | `async_insert=1`, fire-and-forget vs wait-for-ack                                                          | `reference/async-insert.md`         |
| **Select and parse results**                             | `JSONEachRow` reads, `JSON` with metadata, picking a select format                                         | `reference/select-formats.md`       |
| **Parameterize queries**                                 | Binding values, special characters / escaping, "SQL injection?", `{name: Type}` syntax                     | `reference/query-parameters.md`     |
| **Sessions & temporary tables**                          | `session_id`, `CREATE TEMPORARY TABLE`, per-session `SET` commands                                         | `reference/sessions.md`             |
| **Modern data types**                                    | `Dynamic`, `Variant`, `JSON` (object), `Time`, `Time64`                                                    | `reference/data-types.md`           |
| **Custom JSON parse/stringify**                          | Plug in `JSONBig` / `safe-stable-stringify` / a `BigInt`-aware serializer                                  | `reference/custom-json.md`          |

---

## Conventions used in answers

- Always show `import { createClient } from '@clickhouse/client'` (Node, never
  Web). For things that require a runtime API, prefer `node:` built-ins
  (e.g., `import * as crypto from 'node:crypto'`).
- Always `await client.close()` at the end of self-contained snippets; in
  long-running services, close on graceful shutdown.
- Prefer top-level `await` in snippets to match the style of
  `examples/node/coding/*.ts`.
- For inserts, prefer `format: 'JSONEachRow'` and `values: [...]` unless the
  user's scenario requires otherwise.
- For selects, prefer `await (await client.query({...})).json<RowType>()` for
  small / medium result sets; defer to the performance skill for streaming.
- When showing parameter binding, use ClickHouse's native `{name: Type}`
  syntax — never `$1`, `?`, or `:name`.
- For DDL inside a cluster or behind a load balancer, set
  `clickhouse_settings: { wait_end_of_query: 1 }` on the `command()` call so
  the server only acknowledges after the change is applied. See
  https://clickhouse.com/docs/en/interfaces/http/#response-buffering.

---

## Out of scope (delegate to another skill)

- **Streaming, Parquet, file streams, server-side bulk moves, progress
  streaming, async-insert throughput tuning** → `clickhouse-js-node-performance`.
- **TLS, RBAC / read-only users, deeper SQL-injection guidance** →
  `clickhouse-js-node-security`.
- **`CREATE TABLE` patterns, deployment-shaped connection strings,
  replication / sharding choices** → `clickhouse-js-node-schema-and-deployments`.
- **Errors, hangs, type mismatches, proxy pathname surprises, log silence,
  socket hang-ups, `ECONNRESET`** → `clickhouse-js-node-troubleshooting`.
- **Browser, Web Worker, Next.js Edge, Cloudflare Workers** → use the
  Web-client coding skill (`@clickhouse/client-web`).

---

## Still Stuck?

- [`examples/node/coding/`](https://github.com/ClickHouse/clickhouse-js/tree/main/examples/node/coding) — the runnable corpus this skill is built on.
- [ClickHouse JS client docs](https://clickhouse.com/docs/integrations/javascript)
- [ClickHouse supported formats](https://clickhouse.com/docs/interfaces/formats)
- [ClickHouse data types](https://clickhouse.com/docs/sql-reference/data-types)
