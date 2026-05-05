# Ping the Server

> **Applies to:** all versions. `ping()` returns a discriminated
> `PingResult = { success: true } | { success: false, error: Error }` —
> it does **not** throw on connection failures.

Backing examples:
[`examples/node/coding/ping_existing_host.ts`](https://github.com/ClickHouse/clickhouse-js/blob/main/examples/node/coding/ping_existing_host.ts),
[`examples/node/coding/ping_non_existing_host.ts`](https://github.com/ClickHouse/clickhouse-js/blob/main/examples/node/coding/ping_non_existing_host.ts).

## Successful ping

```ts
import { createClient } from '@clickhouse/client'

const client = createClient({
  url: process.env.CLICKHOUSE_URL,
  password: process.env.CLICKHOUSE_PASSWORD,
})

const pingResult = await client.ping()
if (pingResult.success) {
  console.info('ClickHouse is reachable')
} else {
  console.error('Ping failed:', pingResult.error)
}
await client.close()
```

Use `ping()` to:

- Probe ClickHouse at application startup.
- Wake up a ClickHouse Cloud instance that may be idling (a ping is enough to
  bring it out of sleep).
- Implement a `/healthz` / readiness endpoint.

## Failure: host unreachable

`ping()` does **not** throw — it resolves with
`{ success: false, error: Error }`, so you can branch without `try/catch`:

```ts
import type { PingResult } from '@clickhouse/client'
import { createClient } from '@clickhouse/client'

const client = createClient({
  url: 'http://localhost:8100', // non-existing host
  request_timeout: 50, // keep failure fast
})

const pingResult = await client.ping()
if (hasConnectionRefusedError(pingResult)) {
  console.info('Connection refused, as expected')
} else {
  console.error('Ping expected ECONNREFUSED, got:', pingResult)
}
await client.close()

function hasConnectionRefusedError(
  pingResult: PingResult,
): pingResult is PingResult & { error: { code: 'ECONNREFUSED' } } {
  return (
    !pingResult.success &&
    'code' in pingResult.error &&
    pingResult.error.code === 'ECONNREFUSED'
  )
}
```

## Mapping to an HTTP health endpoint

```ts
app.get('/healthz', async (_req, res) => {
  const r = await client.ping()
  if (r.success) {
    res.status(200).json({ ok: true })
  } else {
    res.status(503).json({ ok: false, error: String(r.error) })
  }
})
```

## `ping()` vs `ping({ select: true })`

The default `ping()` hits ClickHouse's `/ping` HTTP endpoint — it verifies
network connectivity but **does not check credentials or query processing**.
A server that is reachable but has a bad password (or a broken query
pipeline) will still return `{ success: true }` from a plain `ping()`.

Pass `{ select: true }` to run a lightweight `SELECT 1` instead:

```ts
const r = await client.ping({ select: true })
// success only if the server is reachable AND auth is correct AND it can run queries
```

|                         | `client.ping()` | `client.ping({ select: true })` |
| ----------------------- | --------------- | ------------------------------- |
| Endpoint                | `/ping` (HTTP)  | `SELECT 1` query                |
| Checks auth             | **No**          | Yes                             |
| Checks query processing | No              | **Yes**                         |
| Overhead                | Minimal         | Slightly higher                 |

**When to use which:**

- **Liveness probe** (is the process alive?) — plain `ping()` is fine.
- **Readiness probe** (can it serve traffic?) — use `ping({ select: true })`
  so the probe fails if credentials are wrong or the query layer is broken.
- **Waking a ClickHouse Cloud idle instance** — plain `ping()` is enough.

## Common pitfalls

- **Do not wrap `ping()` in `try/catch` as your only check.** It resolves on
  failure; the `success` boolean is the source of truth.
- **Lower `request_timeout` if you want pings to fail fast** (the example
  above uses `50` ms). The default is high enough to be unsuitable for
  liveness probes.
- **Plain `ping()` does not check credentials.** If auth is part of what you
  want to verify, use `ping({ select: true })`.
- For ping that times out specifically, see the troubleshooting skill.
