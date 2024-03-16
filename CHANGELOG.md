## 0.3.0 (Node.js only)

This release primarily focuses on improving the Keep-Alive mechanism's reliability on the client side.

### New features

- Idle sockets timeout rework; now, the client attaches internal timers to idling sockets, and forcefully removes them from the pool if it considers that a particular socket is idling for too long. The intention of this additional sockets housekeeping is to eliminate "Socket hang-up" errors that could previously still occur on certain configurations. Now, the client does not rely on KeepAlive agent when it comes to removing the idling sockets; in most cases, the server will not close the socket before the client does.
- There is a new `keep_alive.idle_socket_ttl` configuration parameter. The default value is `2500` (milliseconds), which is considered to be safe, as [ClickHouse versions prior to 23.11 had `keep_alive_timeout` set to 3 seconds by default](https://github.com/ClickHouse/ClickHouse/commit/1685cdcb89fe110b45497c7ff27ce73cc03e82d1), and `keep_alive.idle_socket_ttl` is supposed to be slightly less than that to allow the client to remove the sockets that are about to expire before the server does so.
- Logging improvements: more internal logs on failing requests; all client methods except ping will log an error on failure now. A failed ping will log a warning, since the underlying error is returned as a part of its result. Client logging still needs to be enabled explicitly by specifying the desired `log.level` config option, as the log level is `OFF` by default. Currently, the client logs the following events, depending on the selected `log.level` value:

  - `TRACE` - low-level information about the Keep-Alive sockets lifecycle.
  - `DEBUG` - response information (without authorization headers and host info).
  - `INFO` - still mostly unused, will print the current log level when the client is initialized.
  - `WARN` - non-fatal errors; failed `ping` request is logged as a warning, as the underlying error is included in the returned result.
  - `ERROR` - fatal errors from `query`/`insert`/`exec`/`command` methods, such as a failed request.

### Breaking changes

- `keep_alive.retry_on_expired_socket` and `keep_alive.socket_ttl` configuration parameters are removed.
- The `max_open_connections` configuration parameter is now 10 by default, as we should not rely on the KeepAlive agent's defaults.
- Fixed the default `request_timeout` configuration value (now it is correctly set to `30_000`, previously `300_000` (milliseconds)).

### Bug fixes

- Fixed a bug with Ping that could lead to an unhandled "Socket hang-up" propagation.
- Ensure proper `Connection` header value considering Keep-Alive settings. If Keep-Alive is disabled, its value is now forced to ["close"](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Connection#close).

## 0.3.0-beta.1 (Node.js only)

See [0.3.0](#030-nodejs-only).

## 0.2.10 (Common, Node.js, Web)

### New features

- If `InsertParams.values` is an empty array, no request is sent to the server and `ClickHouseClient.insert` short-circuits itself. In this scenario, the newly added `InsertResult.executed` flag will be `false`, and `InsertResult.query_id` will be an empty string.

### Bug fixes

- Client no longer produces `Code: 354. inflate failed: buffer error` exception if request compression is enabled and `InsertParams.values` is an empty array (see above).

## 0.2.9 (Common, Node.js, Web)

### New features

- It is now possible to set additional HTTP headers for outgoing ClickHouse requests. This might be useful if, for example, you use a reverse proxy with authorization. ([@teawithfruit](https://github.com/teawithfruit), [#224](https://github.com/ClickHouse/clickhouse-js/pull/224))

```ts
const client = createClient({
  additional_headers: {
    'X-ClickHouse-User': 'clickhouse_user',
    'X-ClickHouse-Key': 'clickhouse_password',
  },
})
```

## 0.2.8 (Common, Node.js, Web)

### New features

- (Web only) Allow to modify Keep-Alive setting (previously always disabled).
  Keep-Alive setting **is now enabled by default** for the Web version.

```ts
import { createClient } from '@clickhouse/client-web'
const client = createClient({ keep_alive: { enabled: true } })
```

- (Node.js & Web) It is now possible to either specify a list of columns to insert the data into or a list of excluded columns:

```ts
// Generated query: INSERT INTO mytable (message) FORMAT JSONEachRow
await client.insert({
  table: 'mytable',
  format: 'JSONEachRow',
  values: [{ message: 'foo' }],
  columns: ['message'],
})

// Generated query: INSERT INTO mytable (* EXCEPT (message)) FORMAT JSONEachRow
await client.insert({
  table: 'mytable',
  format: 'JSONEachRow',
  values: [{ id: 42 }],
  columns: { except: ['message'] },
})
```

See also the new examples:

- [Including specific columns or excluding certain ones instead](./examples/insert_exclude_columns.ts)
- [Leveraging this feature](./examples/insert_ephemeral_columns.ts) when working with
  [ephemeral columns](https://clickhouse.com/docs/en/sql-reference/statements/create/table#ephemeral)
  ([#217](https://github.com/ClickHouse/clickhouse-js/issues/217))

## 0.2.7 (Common, Node.js, Web)

### New features

- (Node.js only) `X-ClickHouse-Summary` response header is now parsed when working with `insert`/`exec`/`command` methods.
  See the [related test](./packages/client-node/__tests__/integration/node_summary.test.ts) for more details.
  NB: it is guaranteed to be correct only for non-streaming scenarios.
  Web version does not currently support this due to CORS limitations. ([#210](https://github.com/ClickHouse/clickhouse-js/issues/210))

### Bug fixes

- Drain insert response stream in Web version - required to properly work with `async_insert`, especially in the Cloudflare Workers context.

## 0.2.6 (Common, Node.js)

### New features

- Added [Parquet format](https://clickhouse.com/docs/en/integrations/data-formats/parquet) streaming support.
  See the new examples:
  [insert from a file](./examples/node/insert_file_stream_parquet.ts),
  [select into a file](./examples/node/select_parquet_as_file.ts).

## 0.2.5 (Common, Node.js, Web)

### Bug fixes

- `pathname` segment from `host` client configuration parameter is now handled properly when making requests.
  See this [comment](https://github.com/ClickHouse/clickhouse-js/issues/164#issuecomment-1785166626) for more details.

## 0.2.4 (Node.js only)

No changes in web/common modules.

### Bug fixes

- (Node.js only) Fixed an issue where streaming large datasets could provide corrupted results. See [#171](https://github.com/ClickHouse/clickhouse-js/issues/171) (issue) and [#204](https://github.com/ClickHouse/clickhouse-js/pull/204) (PR) for more details.

## 0.2.3 (Node.js only)

No changes in web/common modules.

### Bug fixes

- (Node.js only) Fixed an issue where the underlying socket was closed every time after using `insert` with a `keep_alive` option enabled, which led to performance limitations. See [#202](https://github.com/ClickHouse/clickhouse-js/issues/202) for more details. ([@varrocs](https://github.com/varrocs))

## 0.2.2 (Common, Node.js & Web)

### New features

- Added `default_format` setting, which allows to perform `exec` calls without `FORMAT` clause.

## 0.2.1 (Common, Node.js & Web)

### Breaking changes

Date objects in query parameters are now serialized as time-zone-agnostic Unix timestamps (NNNNNNNNNN[.NNN], optionally with millisecond-precision) instead of datetime strings without time zones (YYYY-MM-DD HH:MM:SS[.MMM]). This means the server will receive the same absolute timestamp the client sent even if the client's time zone and the database server's time zone differ. Previously, if the server used one time zone and the client used another, Date objects would be encoded in the client's time zone and decoded in the server's time zone and create a mismatch.

For instance, if the server used UTC (GMT) and the client used PST (GMT-8), a Date object for "2023-01-01 13:00:00 **PST**" would be encoded as "2023-01-01 13:00:00.000" and decoded as "2023-01-01 13:00:00 **UTC**" (which is 2023-01-01 **05**:00:00 PST). Now, "2023-01-01 13:00:00 PST" is encoded as "1672606800000" and decoded as "2023-01-01 **21**:00:00 UTC", the same time the client sent.

## 0.2.0 (web platform support)

Introduces web client (using native [fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
and [WebStream](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API) APIs)
without Node.js modules in the common interfaces. No polyfills are required.

Web client is confirmed to work with Chrome/Firefox/CloudFlare workers.

It is now possible to implement new custom connections on top of `@clickhouse/client-common`.

The client was refactored into three packages:

- `@clickhouse/client-common`: all possible platform-independent code, types and interfaces
- `@clickhouse/client-web`: new web (or non-Node.js env) connection, uses native fetch.
- `@clickhouse/client`: Node.js connection as it was before.

### Node.js client breaking changes

- Changed `ping` method behavior: it will not throw now.
  Instead, either `{ success: true }` or `{ success: false, error: Error }` is returned.
- Log level configuration parameter is now explicit instead of `CLICKHOUSE_LOG_LEVEL` environment variable.
  Default is `OFF`.
- `query` return type signature changed to is `BaseResultSet<Stream.Readable>` (no functional changes)
- `exec` return type signature changed to `ExecResult<Stream.Readable>` (no functional changes)
- `insert<T>` params argument type changed to `InsertParams<Stream, T>` (no functional changes)
- Experimental `schema` module is removed

### Web client known limitations

- Streaming for select queries works, but it is disabled for inserts (on the type level as well).
- KeepAlive is disabled and not configurable yet.
- Request compression is disabled and configuration is ignored. Response compression works.
- No logging support yet.

## 0.1.1

## New features

- Expired socket detection on the client side when using Keep-Alive. If a potentially expired socket is detected,
  and retry is enabled in the configuration, both socket and request will be immediately destroyed (before sending the data),
  and the client will recreate the request. See `ClickHouseClientConfigOptions.keep_alive` for more details. Disabled by default.
- Allow disabling Keep-Alive feature entirely.
- `TRACE` log level.

## Examples

#### Disable Keep-Alive feature

```ts
const client = createClient({
  keep_alive: {
    enabled: false,
  },
})
```

#### Retry on expired socket

```ts
const client = createClient({
  keep_alive: {
    enabled: true,
    // should be slightly less than the `keep_alive_timeout` setting in server's `config.xml`
    // default is 3s there, so 2500 milliseconds seems to be a safe client value in this scenario
    // another example: if your configuration has `keep_alive_timeout` set to 60s, you could put 59_000 here
    socket_ttl: 2500,
    retry_on_expired_socket: true,
  },
})
```

## 0.1.0

## Breaking changes

- `connect_timeout` client setting is removed, as it was unused in the code.

## New features

- `command` method is introduced as an alternative to `exec`.
  `command` does not expect user to consume the response stream, and it is destroyed immediately.
  Essentially, this is a shortcut to `exec` that destroys the stream under the hood.
  Consider using `command` instead of `exec` for DDLs and other custom commands which do not provide any valuable output.

Example:

```ts
// incorrect: stream is not consumed and not destroyed, request will be timed out eventually
await client.exec('CREATE TABLE foo (id String) ENGINE Memory')

// correct: stream does not contain any information and just destroyed
const { stream } = await client.exec(
  'CREATE TABLE foo (id String) ENGINE Memory'
)
stream.destroy()

// correct: same as exec + stream.destroy()
await client.command('CREATE TABLE foo (id String) ENGINE Memory')
```

### Bug fixes

- Fixed delays on subsequent requests after calling `insert` that happened due to unclosed stream instance when using low number of `max_open_connections`. See [#161](https://github.com/ClickHouse/clickhouse-js/issues/161) for more details.
- Request timeouts internal logic rework (see [#168](https://github.com/ClickHouse/clickhouse-js/pull/168))

## 0.0.16

- Fix NULL parameter binding.
  As HTTP interface expects `\N` instead of `'NULL'` string, it is now correctly handled for both `null`
  and _explicitly_ `undefined` parameters. See the [test scenarios](https://github.com/ClickHouse/clickhouse-js/blob/f1500e188600d85ddd5ee7d2a80846071c8cf23e/__tests__/integration/select_query_binding.test.ts#L273-L303) for more details.

## 0.0.15

### Bug fixes

- Fix Node.JS 19.x/20.x timeout error (@olexiyb)

## 0.0.14

### New features

- Added support for `JSONStrings`, `JSONCompact`, `JSONCompactStrings`, `JSONColumnsWithMetadata` formats (@andrewzolotukhin).

## 0.0.13

### New features

- `query_id` can be now overridden for all main client's methods: `query`, `exec`, `insert`.

## 0.0.12

### New features

- `ResultSet.query_id` contains a unique query identifier that might be useful for retrieving query metrics from `system.query_log`
- `User-Agent` HTTP header is set according to the [language client spec](https://docs.google.com/document/d/1924Dvy79KXIhfqKpi1EBVY3133pIdoMwgCQtZ-uhEKs/edit#heading=h.ah33hoz5xei2).
  For example, for client version 0.0.12 and Node.js runtime v19.0.4 on Linux platform, it will be `clickhouse-js/0.0.12 (lv:nodejs/19.0.4; os:linux)`.
  If `ClickHouseClientConfigOptions.application` is set, it will be prepended to the generated `User-Agent`.

### Breaking changes

- `client.insert` now returns `{ query_id: string }` instead of `void`
- `client.exec` now returns `{ stream: Stream.Readable, query_id: string }` instead of just `Stream.Readable`

## 0.0.11, 2022-12-08

### Breaking changes

- `log.enabled` flag was removed from the client configuration.
- Use `CLICKHOUSE_LOG_LEVEL` environment variable instead. Possible values: `OFF`, `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`.
  Currently, there are only debug messages, but we will log more in the future.

For more details, see PR [#110](https://github.com/ClickHouse/clickhouse-js/pull/110)

## 0.0.10, 2022-11-14

### New features

- Remove request listeners synchronously.
  [#123](https://github.com/ClickHouse/clickhouse-js/issues/123)

## 0.0.9, 2022-10-25

### New features

- Added ClickHouse session_id support.
  [#121](https://github.com/ClickHouse/clickhouse-js/pull/121)

## 0.0.8, 2022-10-18

### New features

- Added SSL/TLS support (basic and mutual).
  [#52](https://github.com/ClickHouse/clickhouse-js/issues/52)

## 0.0.7, 2022-10-18

### Bug fixes

- Allow semicolons in select clause.
  [#116](https://github.com/ClickHouse/clickhouse-js/issues/116)

## 0.0.6, 2022-10-07

### New features

- Add JSONObjectEachRow input/output and JSON input formats.
  [#113](https://github.com/ClickHouse/clickhouse-js/pull/113)

## 0.0.5, 2022-10-04

### Breaking changes

- Rows abstraction was renamed to ResultSet.
- now, every iteration over `ResultSet.stream()` yields `Row[]` instead of a single `Row`.
  Please check out [an example](https://github.com/ClickHouse/clickhouse-js/blob/c86c31dada8f4845cd4e6843645177c99bc53a9d/examples/select_streaming_on_data.ts)
  and [this PR](https://github.com/ClickHouse/clickhouse-js/pull/109) for more details.
  These changes allowed us to significantly reduce overhead on select result set streaming.

### New features

- [split2](https://www.npmjs.com/package/split2) is no longer a package dependency.
