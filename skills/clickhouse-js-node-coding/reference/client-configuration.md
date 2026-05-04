# Client Configuration

> **Applies to:** all versions, with these notable additions:
>
> - `pathname` config option: client `>= 1.0.0`.
> - `clickhouse_setting_*` / `ch_*` URL parameters: client `>= 1.0.0`.
> - `keep_alive.idle_socket_ttl` (Node-only): client `>= 1.0.0`.

Backing examples:
[`examples/node/coding/url_configuration.ts`](https://github.com/ClickHouse/clickhouse-js/blob/main/examples/node/coding/url_configuration.ts),
[`examples/node/coding/clickhouse_settings.ts`](https://github.com/ClickHouse/clickhouse-js/blob/main/examples/node/coding/clickhouse_settings.ts),
[`examples/node/coding/default_format_setting.ts`](https://github.com/ClickHouse/clickhouse-js/blob/main/examples/node/coding/default_format_setting.ts).

## Minimal client

```ts
import { createClient } from '@clickhouse/client'

const client = createClient({
  url: process.env.CLICKHOUSE_URL, // defaults to 'http://localhost:8123'
  username: process.env.CLICKHOUSE_USER, // defaults to 'default'
  password: process.env.CLICKHOUSE_PASSWORD, // defaults to ''
  database: 'analytics', // defaults to 'default'
})
// ... your queries ...
await client.close()
```

`url` accepts a string or a `URL` object. The accepted string format is:

```
http[s]://[username:password@]hostname:port[/database][?param1=value1&param2=value2]
```

## Configuration via URL parameters

Every config field can be set as a URL query parameter. **URL parameters
always override the rest of the configuration object** — when they do, the
client logs a warning.

```ts
const url =
  'https://bob:secret@my.host:8124/analytics?' +
  [
    'application=my_analytics_app',
    'session_id=random_session_id',
    'pathname=/my_proxy', // requires >= 1.0.0
    'request_timeout=60000',
    'max_open_connections=10',
    'compression_request=1', // boolean: 1/0 or true/false
    'compression_response=false',
    'log_level=TRACE', // TRACE | DEBUG | INFO | WARN | ERROR | OFF
    'keep_alive_enabled=false',
    'keep_alive_idle_socket_ttl=1500', // Node.js only
    'clickhouse_setting_async_insert=1', // any clickhouse_setting_* is forwarded
    'ch_wait_for_async_insert=0', // shorthand for clickhouse_setting_*
    'http_header_X-CLICKHOUSE-AUTH=secret', // any http_header_* is forwarded
  ].join('&')

const client = createClient({ url })
```

The URL above is equivalent to:

```ts
createClient({
  url: 'https://my.host:8124',
  username: 'bob',
  password: 'secret',
  database: 'analytics',
  pathname: '/my_proxy',
  application: 'my_analytics_app',
  session_id: 'random_session_id',
  request_timeout: 60_000,
  max_open_connections: 10,
  compression: { request: true, response: false },
  log_level: 'TRACE',
  keep_alive: { enabled: false },
  clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
  http_headers: { 'X-CLICKHOUSE-AUTH': 'secret' },
})
```

## Per-client vs per-request `clickhouse_settings`

Settings on `createClient` apply to every request. Settings on a single
operation (`query`, `insert`, `command`, `exec`) override the client defaults
for **that call only**.

```ts
const client = createClient({
  clickhouse_settings: {
    date_time_input_format: 'best_effort', // applied to every request
  },
})

const rows = await client.query({
  query: 'SELECT number FROM system.numbers LIMIT 2',
  format: 'JSONEachRow',
  clickhouse_settings: {
    output_format_json_quote_64bit_integers: 1, // overrides client default for this call
  },
})
```

## `default_format` for `exec()`

`client.exec()` runs an arbitrary statement and returns a stream. If your
query has no trailing `FORMAT …` clause, set `default_format` so the server
knows what to send back, then wrap the response in a `ResultSet`:

```ts
import { createClient, ResultSet } from '@clickhouse/client'

const client = createClient()
const format = 'JSONCompactEachRowWithNamesAndTypes'
const { stream, query_id } = await client.exec({
  query: 'SELECT database, name, engine FROM system.tables LIMIT 5',
  clickhouse_settings: { default_format: format },
})
const rs = new ResultSet(stream, format, query_id)
console.log(await rs.json())
await client.close()
```

For ordinary `SELECT`s prefer `client.query({ format })` — `default_format` is
only needed for raw `exec()`.

## Common pitfalls

- **Don't put a path in `url` and expect it to be the database name when
  you're behind a proxy.** Use `pathname` for the proxy path and `database`
  for the DB. (Symptom: "wrong database selected.") See the
  troubleshooting skill for diagnosis.
- **Don't create a client per request.** `createClient` opens a connection
  pool; share one client across the process and `close()` on shutdown.
- **`max_open_connections` must be `>= 1`** when set explicitly.
