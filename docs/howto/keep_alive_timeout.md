# Keep-Alive ECONNRESET: idle socket TTL vs server timeout

## The problem

When Keep-Alive is enabled (the default), the Node.js client reuses idle TCP sockets between requests. If the client holds a socket idle for longer than the server's Keep-Alive timeout, the server closes it. But the client doesn't get to know about the closed socket immediately and can attempt to use it. The next request on that socket gets an `ECONNRESET` error.

One cause is `keep_alive.idle_socket_ttl` (client-side) being greater than the `timeout` value in the server's `Keep-Alive` response header. Delayed event-loop timers can also leave expired sockets in the pool.

## How to debug

**Step 0 — upgrade the client version** to make sure all the latest Keep-Alive improvements and logs are available.

**Step 1 — enable TRACE logging** to confirm the error and see the server-sent timeout:

```ts
const client = createClient({
  log: { level: ClickHouseLogLevel.TRACE },
});
```

Look for two log entries:

1. The server-sent timeout, logged on every response:

   ```
   updated server sent socket keep-alive timeout
   { server_keep_alive_timeout_ms: 3000, ... }
   ```

   This confirms the server-sent Keep-Alive timeout value. `ECONNRESET` occurs when the client's `idle_socket_ttl` is greater (within the network latency margin) than the server-sent Keep-Alive timeout.

2. The mismatch warning, logged when `ECONNRESET` occurs:

   ```
   idle socket TTL is greater than server keep-alive timeout ...
   { server_keep_alive_timeout_ms: 3000, idle_socket_ttl: 3500, ... }
   ```

   This identifies a timeout mismatch that can cause connection resets. It does not rule out other network problems.

**Step 2 — check the server's Keep-Alive timeout** directly:

```sh
curl -v https://<host>:8443/ 2>&1 | grep -i keep-alive
# < keep-alive: timeout=3
```

The value is in seconds. Check the actual response for your deployment. A proxy or load balancer may impose a shorter timeout.

**Step 3 — fix it** by setting `idle_socket_ttl` strictly below the server timeout:

```ts
const client = createClient({
  keep_alive: {
    idle_socket_ttl: 2500, // ms; server timeout is 3000 ms → safe margin
  },
});
```

A margin of 500–1000 ms leaves room for network latency and event-loop delays.

**Optional — enable eager socket destruction** as an extra safeguard on CPU-starved machines where timers may fire late:

If you also see this in logs:

```
reusing socket with TTL expired based on timestamp
{ socket_age_ms: 5380, idle_socket_ttl_ms: 2500, ... }
```

This can indicate delayed timers. Use [the event-loop delay example](../../examples/node/troubleshooting/event_loop_delay.ts) in the affected process to measure delays. Enable eager socket destruction to check idle sockets against the client's `idle_socket_ttl` before each request:

```ts
const client = createClient({
  keep_alive: {
    eagerly_destroy_stale_sockets: true,
  },
});
```

When enabled, the client destroys expired idle sockets before assigning one to a request. This uses the client's `idle_socket_ttl`, not the server timeout, and is not a background cleanup task. The cleanup only runs for Node.js `http.Agent` instances, including `https.Agent`. It can reduce connection resets caused by delayed timers, but cannot prevent every reset. Look for these TRACE logs:

```
socket TTL expired based on timestamp, destroying socket
{ socket_age_ms: 4730, idle_socket_ttl_ms: 3000, ... }
```
