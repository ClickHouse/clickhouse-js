## 0.1.0

## Breaking changes

* `connect_timeout` client setting is removed, as it was unused in the code.

## New features

* `command` method is introduced as an alternative to `exec`.
`command` does not expect user to consume the response stream, and it is destroyed immediately.
Essentially, this is a shortcut to `exec` that destroys the stream under the hood.
Consider using `command` instead of `exec` for DDLs and other custom commands which do not provide any valuable output.

Example:

```ts
// incorrect: stream is not consumed and not destroyed, request will be timed out eventually
await client.exec('CREATE TABLE foo (id String) ENGINE Memory')

// correct: stream does not contain any information and just destroyed
const { stream } = await client.exec('CREATE TABLE foo (id String) ENGINE Memory')
stream.destroy()

// correct: same as exec + stream.destroy()
await client.command('CREATE TABLE foo (id String) ENGINE Memory')
```

### Bug fixes

* Fixed delays on subsequent requests after calling `insert` that happened due to unclosed stream instance when using low number of `max_open_connections`. See [#161](https://github.com/ClickHouse/clickhouse-js/issues/161) for more details.
* Request timeouts internal logic rework (see [#168](https://github.com/ClickHouse/clickhouse-js/pull/168))

## 0.0.16
* Fix NULL parameter binding.
As HTTP interface expects `\N` instead of `'NULL'` string, it is now correctly handled for both `null`
and _explicitly_ `undefined` parameters. See the [test scenarios](https://github.com/ClickHouse/clickhouse-js/blob/f1500e188600d85ddd5ee7d2a80846071c8cf23e/__tests__/integration/select_query_binding.test.ts#L273-L303) for more details.

## 0.0.15

### Bug fixes
* Fix Node.JS 19.x/20.x timeout error (@olexiyb)

## 0.0.14

### New features
* Added support for `JSONStrings`, `JSONCompact`, `JSONCompactStrings`, `JSONColumnsWithMetadata` formats (@andrewzolotukhin).

## 0.0.13

### New features
* `query_id` can be now overridden for all main client's methods: `query`, `exec`, `insert`.

## 0.0.12

### New features
* `ResultSet.query_id` contains a unique query identifier that might be useful for retrieving query metrics from `system.query_log`
* `User-Agent` HTTP header is set according to the [language client spec](https://docs.google.com/document/d/1924Dvy79KXIhfqKpi1EBVY3133pIdoMwgCQtZ-uhEKs/edit#heading=h.ah33hoz5xei2).
For example, for client version 0.0.12 and Node.js runtime v19.0.4 on Linux platform, it will be `clickhouse-js/0.0.12 (lv:nodejs/19.0.4; os:linux)`.
If `ClickHouseClientConfigOptions.application` is set, it will be prepended to the generated `User-Agent`.

### Breaking changes
* `client.insert` now returns `{ query_id: string }` instead of `void`
* `client.exec` now returns `{ stream: Stream.Readable, query_id: string }` instead of just `Stream.Readable`

## 0.0.11, 2022-12-08
### Breaking changes
* `log.enabled` flag was removed from the client configuration.
* Use `CLICKHOUSE_LOG_LEVEL` environment variable instead. Possible values: `OFF`, `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`.
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
