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

## Answer checklist

When answering configuration questions, include the relevant points:

- Show `createClient` from `@clickhouse/client` with explicit fields when the
  user is writing code; this is easier to read and review than encoding
  everything into a URL string.
- When mentioning the URL form for environment variables / DSNs: show a **Bash**
  `export` with the literal URL value, and `createClient({ url: process.env.CLICKHOUSE_URL })`
  in the Node code. **Never construct a URL in application code** — no string
  concatenation, no template literals, no query-string builders.
- If URL parameters and object fields both set the same option, URL parameters
  override the rest of the configuration object.
- If `clickhouse_settings` appear on `createClient`, explain that they are
  defaults for every request and can be overridden on individual `query()`,
  `insert()`, `command()`, or `exec()` calls.
- Remind long-running services to close the client during graceful shutdown.
- The `application` field sets the name that appears in `system.query_log`.
  Do **not** mention any specific HTTP header name — the client handles header
  mapping internally and the header names are an implementation detail.

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

A fixed allowlist of config fields can be set as URL query parameters
(plus any key prefixed with `clickhouse_setting_` / `ch_` / `http_header_`).
**Supported URL parameters override the corresponding values in the rest of
the configuration object** — when they do, the client logs a warning.
Unknown URL parameters cause `createClient` to throw
`Unknown URL parameters: ...`
(see [`packages/client-common/src/config.ts`](https://github.com/ClickHouse/clickhouse-js/blob/main/packages/client-common/src/config.ts) for the shared allowlist, and [`packages/client-node/src/config.ts`](https://github.com/ClickHouse/clickhouse-js/blob/main/packages/client-node/src/config.ts) for Node-specific URL parameters).

Supported non-prefixed keys parsed by `client-common`: `application`,
`session_id`, `pathname`, `access_token`, `request_timeout`,
`max_open_connections`, `compression_request`, `compression_response`,
`log_level`, `keep_alive_enabled`. Additionally, Node supports
`keep_alive_idle_socket_ttl` via the Node-specific config implementation.
Anything else must be passed via the config object on `createClient`.

Prefer explicit object fields in application code. Use the URL form when the
application receives one connection string from an environment variable, secret
manager, or config file. The URL value belongs in the environment, not in the
source code — show it as a shell export and read it in Node:

```bash
# In your shell environment / deployment config (e.g. .env, Kubernetes secret):
export CLICKHOUSE_URL='https://bob:secret@my.host:8124/analytics?application=my_analytics_app&ch_async_insert=1&ch_wait_for_async_insert=0'
```

```ts
// In your Node.js code — no URL construction needed:
const client = createClient({ url: process.env.CLICKHOUSE_URL })
```

The same connection can also be expressed as an explicit config object (useful when you want to document each field individually):

```ts
import { createClient } from '@clickhouse/client'

createClient({
  url: 'https://my.host:8124',
  username: 'bob',
  password: 'secret',
  database: 'analytics',
  application: 'my_analytics_app',
  clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
})
```

## Per-client vs per-request `clickhouse_settings` ⭐

> **Always mention this when discussing `clickhouse_settings`:** settings set
> on `createClient` are defaults; any individual call can override them.

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
