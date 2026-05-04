# Sessions and Temporary Tables

> **Applies to:** all versions. `session_id` is a server-level concept; the
> client just forwards it on every request that names it.

Backing examples:
[`examples/node/coding/session_id_and_temporary_tables.ts`](https://github.com/ClickHouse/clickhouse-js/blob/main/examples/node/coding/session_id_and_temporary_tables.ts),
[`examples/node/coding/session_level_commands.ts`](https://github.com/ClickHouse/clickhouse-js/blob/main/examples/node/coding/session_level_commands.ts).

## When you need a session

Use a `session_id` whenever multiple calls must share **server-side state**:

- `CREATE TEMPORARY TABLE` (the table only exists within its session).
- `SET <setting> = <value>` to apply for subsequent queries on the same
  session.
- Any other server feature scoped per session (e.g., session-scoped
  variables in newer ClickHouse versions).

## Per-client `session_id`

The simplest setup — one client, one session.

```ts
import { createClient } from '@clickhouse/client'
import * as crypto from 'node:crypto'

const client = createClient({
  session_id: crypto.randomUUID(),
})

await client.command({
  query: 'CREATE TEMPORARY TABLE temporary_example (i Int32)',
})

await client.insert({
  table: 'temporary_example',
  values: [{ i: 42 }, { i: 144 }],
  format: 'JSONEachRow',
})

const rs = await client.query({
  query: 'SELECT * FROM temporary_example',
  format: 'JSONEachRow',
})
console.info(await rs.json())
await client.close()
```

## Session-level `SET` commands

`SET` only persists within a session. With `session_id` defined on the
client, every subsequent call inherits the change.

```ts
const client = createClient({ session_id: crypto.randomUUID() })

await client.command({
  query: 'SET output_format_json_quote_64bit_integers = 0',
  clickhouse_settings: { wait_end_of_query: 1 }, // ack before next call
})

const rs1 = await client.query({
  query: 'SELECT toInt64(42)',
  format: 'JSONEachRow',
})
// → 64-bit integers come back as numbers in this query

await client.command({
  query: 'SET output_format_json_quote_64bit_integers = 1',
  clickhouse_settings: { wait_end_of_query: 1 },
})

const rs2 = await client.query({
  query: 'SELECT toInt64(144)',
  format: 'JSONEachRow',
})
// → 64-bit integers come back as strings again
```

> **`wait_end_of_query: 1` matters here.** Without it, a `SET` on one
> connection in the pool may not yet be applied when the next query lands
> on the same socket.

## Per-request `session_id`

You can also pass `session_id` on a single `query()` / `insert()` /
`command()` call to override (or set) it for that one request.

## ⚠️ Sessions and load balancers / ClickHouse Cloud

Sessions are bound to a **specific ClickHouse node**. If a load balancer in
front of ClickHouse routes consecutive requests to different nodes, the
temporary table / `SET` won't be visible — you'll get
`UNKNOWN_TABLE` / surprising results.

Mitigations:

- Talk to a single node directly.
- For ClickHouse Cloud, use [replica-aware
  routing](https://clickhouse.com/docs/manage/replica-aware-routing).
- Avoid sessions for cross-node workflows; persist intermediate state in a
  regular (non-temporary) table instead.

## Common pitfalls

- **Forgetting `session_id` and being surprised that
  `CREATE TEMPORARY TABLE` "disappears."** Without a session, every request
  may land on a different connection / server context.
- **Reusing the same `session_id` across unrelated workflows.** A second
  session-using consumer will trip over your temporary tables and `SET`
  values. Generate a fresh UUID per logical session.
- **Leaving session state pinned for the lifetime of the process.** If
  long-lived clients accumulate `SET` / temp-table state, consider creating
  a short-lived sub-client with its own `session_id` for the unit of work.
- **Skipping `wait_end_of_query: 1` on `SET`** — race conditions between
  `SET` and the next query can show up under load.
