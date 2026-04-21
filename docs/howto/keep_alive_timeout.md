# Keep-Alive ECONNRESET: idle socket TTL vs server timeout

## The problem

When Keep-Alive is enabled (the default), the Node.js client reuses idle TCP sockets between requests. If the client holds a socket idle for longer than the server's Keep-Alive timeout, the server closes it. But the client doesn't get to know about the closed socket immediately and can attempt to use it. The next request on that socket gets an `ECONNRESET` error.

This happens when `keep_alive.idle_socket_ttl` (client-side) is greater than the `timeout` value in the server's `Keep-Alive` response header.

## How to debug

**Step 0 — upgrade the client version** to make sure all the latest Keep-Alive improvements and logs are available.

**Step 1 — enable TRACE logging** to confirm the error and see the server-sent timeout:

```ts
const client = createClient({
  log: { level: ClickHouseLogLevel.TRACE },
})
```

Look for two log entries:

1. The server-sent timeout, logged on every response:

   ```
   updated server sent socket keep-alive timeout
   { server_keep_alive_timeout_ms: 3000, ... }
   ```

   This confirms that the server is sending a Keep-Alive timeout of a greater value than the client's `idle_socket_ttl`, which is the root cause of the `ECONNRESET` errors.

2. The mismatch warning, logged when `ECONNRESET` occurs:

   ```
   idle socket TTL is greater than server keep-alive timeout ...
   { server_keep_alive_timeout_ms: 3000, idle_socket_ttl: 2500, ... }
   ```

   This confirms that the ECONNRESET error is due to the idle socket TTL being greater than the server's Keep-Alive timeout.

**Step 2 — check the server's Keep-Alive timeout** directly:

```sh
curl -v https://<host>:8443/ 2>&1 | grep -i keep-alive
# < keep-alive: timeout=3
```

The value is in seconds. ClickHouse Cloud default is 3s; self-hosted default is 10s.

**Step 3 — fix it** by setting `idle_socket_ttl` strictly below the server timeout:

```ts
const client = createClient({
  keep_alive: {
    idle_socket_ttl: 2500, // ms; server timeout is 3000 ms → safe margin
  },
})
```

A margin of 500–1000 ms is recommended to account for clock skew and event-loop delays.

**Optional — enable eager socket destruction** as an extra safeguard on CPU-starved machines where timers may fire late:

```ts
keep_alive: {
  idle_socket_ttl: 2500,
  eagerly_destroy_stale_sockets: true,
}
```

This can also be seen in logs:

```
destroying idle socket that exceeded server keep-alive timeout
{ server_keep_alive_timeout_ms: 3000, idle_socket_ttl_ms: 2500, ... }
```

Which is a sign that the application running the client is under heavy load and timers are firing late and the eager destruction might help in this case.

## How the client tracks the server timeout

The server sends the timeout in every HTTP response header:

```
Keep-Alive: timeout=3
```
