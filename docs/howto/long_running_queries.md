# Long-running queries and timeouts

## The problem

When executing a long-running query (e.g. `INSERT FROM SELECT`) that does not send or receive data over HTTP, the client sends the statement and then waits for a response. If a load balancer sits between the client and ClickHouse server and has an idle connection timeout shorter than the query execution time, the LB will close the connection before the query finishes. This happens even when the LB is stateful and correctly understands that the connection is in use — it simply considers it idle because no data is flowing for a longer time.

## How to diagnose

The clearest symptom is a **"socket hang up"** error thrown by the client even though the query succeeded. To confirm:

1. Note the `query_id` from the failed request (or generate one yourself — see Approach 2 below).
2. Check `system.query_log`:

```sql
SELECT type, query_duration_ms
FROM system.query_log
WHERE query_id = '<your-query-id>'
ORDER BY event_time DESC
LIMIT 5
```

3. If you see a `QueryFinish` row with `query_duration_ms` less than your `request_timeout`, the query completed successfully — the LB dropped the connection before the full response (with empty body) arrived.

---

## Approach 1 — Keep the connection alive with progress headers (recommended)

Ask ClickHouse to periodically send query progress in HTTP response headers. This creates network activity that prevents the LB from treating the connection as idle.

Example curl request to test with a long-running query (adjust the query as needed):

```sh
curl -v "http://localhost:8123/?wait_end_of_query=1&send_progress_in_http_headers=1&http_headers_progress_interval_ms=500&max_block_size=1&query=select+count(sleepEachRow(0.1))from+numbers(50)+FORMAT+JSONEachRow"
```

**Relevant settings:**

- `send_progress_in_http_headers` — enables progress headers (boolean, pass as `1`)
- `http_headers_progress_interval_ms` — how often to send them (UInt64, pass as a string)

**Step 1.** Estimate the maximum query execution time. Set `request_timeout` to a value safely above that estimate.

**Step 2.** Find out your LB's idle connection timeout (e.g. 120s). Set `http_headers_progress_interval_ms` to a value a few seconds below it (e.g. `'110000'`).

**Step 3.** Configure the client:

```ts
import { createClient } from '@clickhouse/client'

const client = createClient({
  // Allow up to 400s for the query to complete (adjust to your estimate).
  request_timeout: 400_000,
  clickhouse_settings: {
    // Enable periodic progress headers.
    send_progress_in_http_headers: 1,
    // Send headers every 110s — just under the assumed 120s LB idle timeout.
    // Must be a string because UInt64 can exceed Number.MAX_SAFE_INTEGER.
    http_headers_progress_interval_ms: '110000',
  },
})
```

**Step 4.** Execute the query normally:

```ts
await client.command({
  query: `INSERT INTO my_table SELECT * FROM source_table`,
})
```

The client will now receive periodic header frames from ClickHouse, keeping the LB idle timer reset.

**Trade-off:** The client keeps the HTTP connection open for the full duration of the query. A transient network blip during that window will still raise an error.

---

## Approach 2 — Fire-and-forget with server-side polling (more resilient)

HTTP mutations sent to ClickHouse are **not cancelled on the server** when the client drops the connection. You can deliberately abort the outgoing request early — once you know the server has received it — and then poll `system.query_log` until the query finishes.

This reduces the window of exposure to network errors from "the entire query duration" down to "a short handshake phase".

**Step 1.** Generate a `query_id` on the client side so you can track the query later:

```ts
import * as crypto from 'crypto'
const queryId = crypto.randomUUID()
```

**Step 2.** Start the long-running command but **do not await it yet**. Attach an `AbortController` so you can drop the HTTP connection without cancelling the server-side query:

```ts
const abortController = new AbortController()

const commandPromise = client
  .command({
    query: `INSERT INTO my_table SELECT * FROM source_table`,
    query_id: queryId,
    abort_signal: abortController.signal,
  })
  .catch((err) => {
    if (err instanceof Error && err.message.includes('abort')) {
      // Expected — we aborted the request intentionally.
    } else {
      throw err
    }
  })
```

**Step 3.** Poll `system.query_log` until the query appears (meaning the server has registered it):

```ts
async function checkQueryExists(client, queryId) {
  const rs = await client.query({
    query: `
      SELECT COUNT(*) > 0 AS exists
      FROM system.query_log
      WHERE query_id = '${queryId}'
    `,
    format: 'JSONEachRow',
  })
  const [row] = await rs.json()
  return row?.exists !== 0
}
```

**Step 4.** Once the query is confirmed to exist on the server, abort the HTTP request:

```ts
abortController.abort()
await commandPromise // resolves immediately after abort
```

If the query never appears after a reasonable number of polls, treat it as a failure and handle accordingly.

**Step 5.** Poll until the query finishes:

```ts
async function checkCompletedQuery(client, queryId) {
  const rs = await client.query({
    query: `
      SELECT type
      FROM system.query_log
      WHERE query_id = '${queryId}' AND type != 'QueryStart'
      LIMIT 1
    `,
    format: 'JSONEachRow',
  })
  const [row] = await rs.json()
  return row?.type === 'QueryFinish'
}
```

A `type` of `QueryFinish` means success. `ExceptionWhileProcessing` or `ExceptionBeforeStart` mean the query failed — handle those cases as needed. If you exhaust your polling budget without seeing a terminal state, you can wait longer or cancel the query via `system.kills` — see `examples/cancel_query.ts`.

**Trade-off:** Slightly more complex to implement and requires read access to `system.query_log`. The polling interval introduces a small lag before you learn the query is done.

---

## Choosing between the two approaches

|                                    | Approach 1 (progress headers) | Approach 2 (fire-and-forget + polling)           |
| ---------------------------------- | ----------------------------- | ------------------------------------------------ |
| Implementation complexity          | Low                           | Medium                                           |
| Resilience to network errors       | Lower (connection held open)  | Higher (connection dropped early)                |
| Requires `system.query_log` access | No                            | Yes                                              |
| Works for any query type           | Yes                           | Only suited for mutations / `INSERT FROM SELECT` |

Use **Approach 1** when your infrastructure is reliable and you want a simple drop-in fix.
Use **Approach 2** when you need stronger guarantees against transient network failures or when the query may run for many minutes.

---

## Full example

See [`examples/long_running_queries_timeouts.ts`](../../examples/long_running_queries_timeouts.ts) for runnable code covering both approaches.
