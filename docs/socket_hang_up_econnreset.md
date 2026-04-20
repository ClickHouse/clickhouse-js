# Socket Hang Up / ECONNRESET

If you're experiencing `socket hang up` and / or `ECONNRESET` errors even when using the latest version of the client, there are the following options to resolve this issue:

- Enable logs with at least `WARN` log level (default). This will allow for checking if there is an unconsumed or a dangling stream in the application code: the transport layer will log it on the WARN level, as that could potentially lead to the socket being closed by the server. You can enable logging in the client configuration as follows:

  ```ts
  const client = createClient({
    log: { level: ClickHouseLogLevel.WARN },
  })
  ```

- Make sure that the desired configuration is applied to the correct client instance. If you have multiple client instances in your application, double-check that the one you're using for queries has the correct `keep_alive.idle_socket_ttl` value.

- Reduce the `keep_alive.idle_socket_ttl` setting in the client configuration by 500 milliseconds. In certain situations, for example, high network latency between client and server, it could be beneficial, ruling out the situation where an outgoing request could obtain a socket that the server is going to close.

- If this error is happening during long-running queries with no data coming in or out (for example, a long-running `INSERT FROM SELECT`), this might be due to a load balancer or other network components closing long-lived connections or long running requests. You could try forcing some data coming in during long-running queries by using a combination of these ClickHouse settings:

  ```ts
  const client = createClient({
    // Here we assume that we will have some queries with more than 5 minutes of execution time
    request_timeout: 400_000,
    /** These settings in combination allow to avoid LB timeout issues in case of long-running queries without data coming in or out,
     *  such as `INSERT FROM SELECT` and similar ones, as the connection could be marked as idle by the LB and closed abruptly.
     *  In this case, we assume that the LB has idle connection timeout of 120s, so we set 110s as a "safe" value. */
    clickhouse_settings: {
      send_progress_in_http_headers: 1,
      http_headers_progress_interval_ms: '110000', // UInt64, should be passed as a string
    },
  })
  ```

  Keep in mind, however, that the total size of the received headers has 16KB limit in recent Node.js versions; after certain amount of progress headers received, which was around 70-80 in our tests, an exception will be generated.

  It is also possible to use an entirely different approach, avoiding wait time on the wire completely; it could be done by leveraging HTTP interface "feature" that mutations aren't cancelled when the connection is lost. See [this example (part 2)](https://github.com/ClickHouse/clickhouse-js/blob/main/examples/long_running_queries_timeouts.ts) for more details.

- Keep-Alive feature can be disabled entirely. In this case, client will also add `Connection: close` header to every request, and the underlying HTTP agent won't reuse the connections. `keep_alive.idle_socket_ttl` setting will be ignored, as there will be no idling sockets. This will result in additional overhead, as a new connection will be established for every request.

  ```ts
  const client = createClient({
    keep_alive: {
      enabled: false,
    },
  })
  ```

- Rule out potential issues with the rest of the network stack including Node.js itself by running a simple command-line test with the same ClickHouse instance and the same network path (i.e. from the same machine or network segment, e.g. a Kubernetes pod), for example, using `curl`:

  ```sh
  curl -is --user '<user>:<password>' --data-binary "SELECT 1" <clickhouse_url>
  ```

  You might want to run it in a loop for several minutes. If you see similar errors in `curl`, it is likely that the issue is not related to the client configuration, but rather to the network stack or the server configuration.

- To test the connection with plain Node.js functionality, you can try to create a simple HTTP request to the ClickHouse server using the built-in `fetch` API:

```ts
const response = await fetch('<clickhouse_url>?query=SELECT+1', {
  method: 'POST',
  headers: {
    Authorization:
      'Basic ' + Buffer.from('<user>:<password>').toString('base64'),
  },
})
```

- In some cases the application code or the framework adapters can add a preemptive `ping()` before the actual query execution, which can lead to a situation where the `ping()` request is successful, but the subsequent query request fails with a "socket hang up" error due to the same underlying issue with idle connections. If you see that pattern in the logs, try to check if there is an option to disable preemptive pings in your framework or application code. This should also help with reducing the probability of getting rate limited by any of the intermediate network components.

- Make sure that the application itself is getting enough CPU time and the network is not throttled by the hosting provider. Various means of monitoring like GC pause metrics, event loop lag metrics, and similar ones can also be helpful to rule out potential resource starvation issues.

- Try checking your application code with [no-floating-promises](https://typescript-eslint.io/rules/no-floating-promises/) ESLint rule enabled, which will help to identify unhandled promises that could lead to dangling streams and sockets.
