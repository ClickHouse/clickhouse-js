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

## ⚠️ `session_id` and concurrency

ClickHouse **rejects concurrent queries within the same session** — if two
requests arrive at the server at the same time sharing the same `session_id`,
the second one gets an error like
`"Session is locked by a concurrent client"`. This has two practical
implications:

1. **Do not set `session_id` on a global / module-static client** that handles
   concurrent requests (e.g., an Express app's shared client). Every
   in-flight request would share the same session and collide under load.
2. **If you do set `session_id` on a client**, restrict its concurrency:
   set `max_open_connections: 1` so at most one request is in flight at a
   time, turning the pool into a serial queue. This is fine for a
   dedicated per-workflow client but wrong for a shared application client.

The right pattern for application code: create a **short-lived client** (or
use per-request `session_id`) scoped to a single logical workflow, not to
the entire process.

## Per-client `session_id`

Appropriate when **one client handles exactly one sequential workflow** (a
script, a background job, a single user's session that you've already
serialized).

```ts
import { createClient } from '@clickhouse/client'
import * as crypto from 'node:crypto'

const client = createClient({
  session_id: crypto.randomUUID(),
  max_open_connections: 1, // prevent concurrent-session errors
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
- **Setting `session_id` on a shared application client.** Under concurrent
  load, two in-flight requests will share the same session and one will fail
  with `"Session is locked by a concurrent client"`. Use per-request
  `session_id` or a dedicated short-lived client instead.
- **Reusing the same `session_id` across unrelated workflows.** A second
  session-using consumer will trip over your temporary tables and `SET`
  values. Generate a fresh UUID per logical session.
- **Leaving session state pinned for the lifetime of the process.** If
  long-lived clients accumulate `SET` / temp-table state, consider creating
  a short-lived sub-client with its own `session_id` for the unit of work.
- **Skipping `wait_end_of_query: 1` on `SET`** — race conditions between
  `SET` and the next query can show up under load.
