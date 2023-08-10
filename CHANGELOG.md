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
