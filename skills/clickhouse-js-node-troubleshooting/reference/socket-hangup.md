# Timeouts / Socket Hang-Up / ECONNRESET

**Symptom:** `Error: Timeout error.`, `socket hang up`, or `ECONNRESET` errors, often intermittent.

**Possible causes:** Reusing a socket closed by the server or load balancer, unconsumed streams, delayed event-loop timers, or other network failures.

**Quick triage:**

- Errors on every request → check stream handling and connectivity (Steps 1–2 and 6)
- Errors only after idle periods → Keep-Alive timeout mismatch (Step 3)
- Errors on long-running queries (INSERT FROM SELECT, etc.) → load balancer idle timeout (Step 4)
- Other failures → check connectivity and event-loop delays (Step 6)
- Still failing after these checks → disable Keep-Alive as a last resort (Step 5)

## Step 1 — Enable WARN-level logging to find dangling streams

> **Requires:** `>= 0.2.0` (logging support with `log.level` config option). In `>= 1.18.1`, the default log level changed from `OFF` to `WARN`, so this step may already be active. In `>= 1.18.2`, the client auto-emits a WARN log with Keep-Alive troubleshooting hints when an `ECONNRESET` is detected. In `>= 1.12.0`, a warning is logged when a socket is closed without fully consuming the stream.

```js
import { createClient, ClickHouseLogLevel } from "@clickhouse/client";

const client = createClient({
  log: { level: ClickHouseLogLevel.WARN },
});
```

Look for log lines about unconsumed or dangling streams. A **dangling stream** is a query response stream that was never fully consumed or explicitly closed with `ResultSet.close()`. It holds a connection until it is consumed, closed, or times out. This can exhaust the connection pool and lead to connection errors.

If the response stalls, socket inactivity can produce `Timeout error.` after `request_timeout`. At WARN level, look for `socket was closed or ended before the response was fully read`. This signals that the response stream was not fully consumed before the connection ended.

**Common dangling stream patterns:**

```js
// ❌ Wrong — result stream never consumed; socket is left open
const resultSet = await client.query({ query: "SELECT ..." });
// result is abandoned without calling .json(), .text(), .stream(), or .close()

// ❌ Wrong — stream created but not fully piped/iterated
const resultSet = await client.query({
  query: "SELECT ...",
  format: "JSONEachRow",
});
const stream = resultSet.stream();
// stream is never iterated and resultSet is never closed

// ✓ Correct — consume via .json()
const resultSet = await client.query({ query: "SELECT ..." });
const data = await resultSet.json();

// ✓ Correct — consume via async iteration
const resultSet = await client.query({
  query: "SELECT ...",
  format: "JSONEachRow",
});
for await (const rows of resultSet.stream()) {
  // process rows
}

// ✓ Correct — explicitly close; this destroys the underlying socket immediately
const resultSet = await client.query({ query: "SELECT ..." });
resultSet.close();
```

## Step 2 — Check your ESLint setup

Add the [`no-floating-promises`](https://typescript-eslint.io/rules/no-floating-promises/) ESLint rule. Unhandled promises leave streams dangling, which can cause the server to close the socket.

Even with `await`, if the returned `ResultSet` is not consumed (no `.json()`, `.text()`, `.close()`, or full stream iteration), the socket is left open. The ESLint rule catches the promise case; code review is needed for the "awaited but unconsumed result" case.

## Step 3 — Find the server's Keep-Alive timeout

```bash
curl -v --data-binary "SELECT 1" <your_clickhouse_url>
```

Check the response headers:

```
< Connection: Keep-Alive
< Keep-Alive: timeout=10
```

> **Requires:** `>= 0.3.0` (`keep_alive.idle_socket_ttl` was introduced in 0.3.0 with a default of 2500 ms, replacing the older `keep_alive.socket_ttl` from 0.1.1 which was removed in 0.3.0).

The default `idle_socket_ttl` in the client is **2500 ms**, which is safe for servers with a 3 s timeout (common in ClickHouse < 23.11). If your server has a higher timeout (e.g., 10 s), you can safely increase:

```js
const client = createClient({
  keep_alive: {
    idle_socket_ttl: 9000, // stay ~500ms below the server's timeout
  },
});
```

> ⚠️ If you still get errors after increasing, **lower** the value, not raise it.

> **Tip (`>= 1.18.3`):** Enable `keep_alive.eagerly_destroy_stale_sockets: true` to proactively destroy sockets that have been idle longer than `idle_socket_ttl` before each request. This helps when event loop delays prevent the idle timeout callback from firing on time. The cleanup only runs for Node.js `http.Agent` instances, including `https.Agent`.

## Step 4 — Long-running queries with no data in/out (INSERT FROM SELECT, etc.)

> **Requires:** `>= 1.0.0` (`request_timeout` default was fixed to 30 000 ms in 0.3.0; `url`-based configuration including `request_timeout` via URL params available since 1.0.0).

Load balancers may close idle connections mid-query. Force periodic progress headers:

```js
const client = createClient({
  request_timeout: 400_000, // e.g. 400s for long queries
  clickhouse_settings: {
    send_progress_in_http_headers: 1,
    http_headers_progress_interval_ms: "110000", // string — UInt64 type; set ~10s below LB idle timeout
  },
});
```

### ⚠️ Critical: 16 KB Node.js Header Size Limit

**Node.js defaults to a total received HTTP header limit of approximately 16 KB (this can be increased via the `--max-http-header-size` CLI flag[^max-header-size]).** ClickHouse sends a new progress header with each interval (~200 bytes), and after ~75 progress headers accumulate, Node.js will throw an exception and terminate the request unless that limit is raised.

[^max-header-size]: Since `>= 1.18.5`, the ClickHouse JS Node client forwards a per-client header limit via the `max_response_headers_size` (bytes) option on `createClient` (it maps to Node's `http(s).request({ maxHeaderSize })`). On older versions, use the `--max-http-header-size` CLI flag / `NODE_OPTIONS` (process-wide).

**Maximum safe query duration formula:**

```
Max duration (seconds) ≈ http_headers_progress_interval_ms × 75 ÷ 1000
```

**Examples:**

- `http_headers_progress_interval_ms: '10000'` (10s) → **~12.5 minutes** max safe duration
- `http_headers_progress_interval_ms: '60000'` (60s) → **~75 minutes** max safe duration
- `http_headers_progress_interval_ms: '120000'` (120s) → **~2.5 hours** max safe duration

> **Note:** `http_headers_progress_interval_ms` is a `UInt64` ClickHouse setting, so it must be passed as a **string** (e.g., `'10000'`).

**Raising the Node.js header limit (e.g., to 64 KB):**

If you need a longer max safe duration without lengthening the progress interval, raise Node's HTTP header limit. For example, increasing it from the default 16 KB to **64 KB** quadruples the max safe duration (≈300 progress headers instead of ≈75).

```ts
// Option 1 (recommended, since `>= 1.18.5`) — per-client, no process-wide flag needed
const client = createClient({
  request_timeout: 400_000,
  max_response_headers_size: 65536, // 64 KB; lifts the per-request header cap
  clickhouse_settings: {
    send_progress_in_http_headers: 1,
    http_headers_progress_interval_ms: "110000",
  },
});
```

```bash
# Option 2 — CLI flag when launching your app (process-wide; older client versions)
node --max-http-header-size=65536 app.js

# Option 3 — environment variable (works with any Node entry point, including npm/ts-node)
NODE_OPTIONS="--max-http-header-size=65536" node app.js
```

With `maxHeaderSize = 65536` (64 KB), the formula becomes:
Max duration (seconds) ≈ http_headers_progress_interval_ms × 300 ÷ 1000

```
Max duration ≈ http_headers_progress_interval_ms ÷ 1000 × 300
```

Examples at 64 KB:

- `http_headers_progress_interval_ms: '10000'` (10s) → **~50 minutes** max safe duration
- `http_headers_progress_interval_ms: '60000'` (60s) → **~5 hours** max safe duration
- `http_headers_progress_interval_ms: '120000'` (120s) → **~10 hours** max safe duration

**Guidelines for choosing the interval** (subject to your load balancer's idle timeout — see trade-offs below):

1. **For queries under 12 minutes:** Use `'10000'` ms (10s) intervals, if your LB idle timeout allows
2. **For queries 12 min – 1 hour:** Use `'60000'` ms (60s) intervals, if your LB idle timeout allows
3. **For queries 1–2 hours:** Use `'120000'` ms (120s) intervals, if your LB idle timeout allows
4. **For mutations over 2 hours:** Use the fire-and-forget pattern (see below)
5. **For SELECT queries over 2 hours:** Increase `http_headers_progress_interval_ms` to extend the safe duration, while keeping it below your LB idle timeout and within Node.js header-limit constraints

Use this command to experiment and debug:

```bash
curl -v "http://localhost:8123/?function_sleep_max_microseconds_per_block=10000000&wait_end_of_query=1&send_progress_in_http_headers=1&max_block_size=1&query=select+sum(sleepEachRow(1))+from+numbers(10)+FORMAT+JSONEachRow"
```

Experimenting with the exact load balancer stack might be required.

**Important trade-offs:**

- **Shorter intervals** = better load balancer keep-alive (prevents idle timeout) but **lower max duration**
- **Longer intervals** = higher max duration but **higher risk of LB idle timeout**

As a rule of thumb, set the interval slightly **below** your load balancer's idle timeout—typically by a few seconds (for example, often around 5–20 seconds), depending on your load balancer, proxies, and network behavior—while staying under the header limit for your expected query duration.

**Alternatively — cancel the HTTP request and poll:** For operations such as `INSERT ... SELECT` that continue after disconnection, first confirm the server received the query. Then abort the request and poll for completion. Do not assume that cancelling a request cancels the query, or that every query survives disconnection. See [the runnable example](https://github.com/ClickHouse/clickhouse-js/blob/main/examples/node/troubleshooting/long_running_queries_cancel_request.ts).

## Step 5 — Disable Keep-Alive entirely (last resort)

> **Requires:** `>= 0.1.1` (Keep-Alive disable option introduced in 0.1.1).

Adds overhead (new TCP connection per request) and avoids reusing idle sockets. Other causes of connection resets remain possible:

```js
const client = createClient({
  keep_alive: { enabled: false },
});
```

## Step 6 — Check connectivity and event-loop delays

For `Error: Timeout error.`, first check the same server and network path with `curl` or native Node.js. See [the connectivity checks](https://github.com/ClickHouse/clickhouse-js/blob/main/docs/socket_hang_up_econnreset.md). The Node.js client's `request_timeout` limits socket inactivity, not total query execution time.

Run the monitor from [the event-loop delay example](https://github.com/ClickHouse/clickhouse-js/blob/main/examples/node/troubleshooting/event_loop_delay.ts) inside the affected Node.js process. It logs timestamped p99 and maximum delays in milliseconds. Compare spikes with client errors and CPU/GC metrics. The standalone demonstration needs no server and includes a deliberate 200 ms block. Copy only the monitoring code into an application.

With the example's 20 ms sampling resolution, baseline readings are near 20 ms. With about 50 samples per report, p99 and max will often match. Reports pause during a block and resume afterward. Spikes show delayed timers and socket callbacks, but do not prove the cause of a connection reset.
