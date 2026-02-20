# 1.18.0

## Improvements

- Logging is now lazy, which means that the log messages will only be constructed if the log level is appropriate for the message. This can improve performance in cases where constructing the log message is expensive, and the log level is set to ignore such messages. ([#520])

- By default the client will no longer log the full unredacted query text for security reasons; however, it is still possible to enable it via the `unsafeLogUnredactedQueries` configuration option. ([#520])

[#520]: https://github.com/ClickHouse/clickhouse-js/pull/520

# 1.17.0

## New features

- Added `http_status_code` to query, insert, and exec commands ([#525], [Kinzeng])
- Fixed `ignore_error_response` not getting passed when using `command` ([#536], [Kinzeng])

[#525]: https://github.com/ClickHouse/clickhouse-js/pull/525
[#536]: https://github.com/ClickHouse/clickhouse-js/pull/536

# 1.16.0

## New features

- Added support for the new [Disposable API] (a.k.a the `using` keyword) (#500)

[Disposable API]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/using

# 1.15.0

## New features

- Added support for [BigInt] values in query parameters. ([#487], @dalechyn)

[#487]: https://github.com/ClickHouse/clickhouse-js/pull/487
[BigInt]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt

# 1.14.0

## New features

- It is now possible to specify custom `parse` and `stringify` functions that will be used instead of the standard `JSON.parse` and `JSON.stringify` methods for JSON serialization/deserialization when working with `JSON*` family formats. See `ClickHouseClientConfigOptions.json`, and a new [custom_json_handling] example for more details. ([#481], [looskie])
- (Node.js only) Added an `ignore_error_response` param to `ClickHouseClient.exec`, which allows callers to manually handle request errors on the application side. ([#483], [Kinzeng])

[#481]: https://github.com/ClickHouse/clickhouse-js/pull/481
[#483]: https://github.com/ClickHouse/clickhouse-js/pull/483
[looskie]: https://github.com/looskie
[Kinzeng]: https://github.com/Kinzeng
[custom_json_handling]: https://github.com/ClickHouse/clickhouse-js/blob/1.14.0/examples/custom_json_handling.ts

# 1.13.0

## New features

- Server-side exceptions that occur in the middle of the HTTP stream are now handled correctly. This requires [ClickHouse 25.11+](https://github.com/ClickHouse/ClickHouse/pull/88818). Previous ClickHouse versions are unaffected by this change. ([#478])

## Improvements

- `TupleParam` constructor now accepts a readonly array to permit more usages. ([#465], [Malien])

## Bug fixes

- Fixed boolean value formatting in query parameters. Boolean values within `Array`, `Tuple`, and `Map` types are now correctly formatted as `TRUE`/`FALSE` instead of `1`/`0` to ensure proper type compatibility with ClickHouse. ([#475], [baseballyama])

[#465]: https://github.com/ClickHouse/clickhouse-js/pull/465
[#475]: https://github.com/ClickHouse/clickhouse-js/pull/475
[#478]: https://github.com/ClickHouse/clickhouse-js/pull/478
[Malien]: https://github.com/Malien
[baseballyama]: https://github.com/baseballyama

# 1.12.1

## Improvements

- Improved performance of `toSearchParams`. ([#449], [twk])

## Other

- Added Node.js 24.x to the CI matrix. Node.js 18.x was removed from the CI due to [EOL](https://endoflife.date/nodejs).

[#449]: https://github.com/ClickHouse/clickhouse-js/pull/449
[twk]: https://github.com/twk

# 1.12.0

## Types

- Add missing `allow_experimental_join_condition` to `ClickHouseSettings` typing. ([#430], [looskie])
- Fixed `JSONEachRowWithProgress` TypeScript flow after the breaking changes in [ClickHouse 25.1]. `RowOrProgress<T>` now has an additional variant: `SpecialEventRow<T>`. The library now additionally exports the `parseError` method, and newly added `isRow` / `isException` type guards. See the updated [JSONEachRowWithProgress example] ([#443])
- Added missing `allow_experimental_variant_type` (24.1+), `allow_experimental_dynamic_type` (24.5+), `allow_experimental_json_type` (24.8+), `enable_json_type` (25.3+), `enable_time_time64_type` (25.6+) to `ClickHouseSettings` typing. ([#445])

## Improvements

- Add a warning on a socket closed without fully consuming the stream (e.g., when using `query` or `exec` method). ([#441])
- (Node.js only) An option to use a simple SELECT query for ping checks instead of `/ping` endpoint. See the new optional argument to the `ClickHouseClient.ping` method and `PingParams` typings. Note that the Web version always used a SELECT query by default, as the `/ping` endpoint does not support CORS, and that cannot be changed. ([#442])

## Other

- The project now uses [Codecov] instead of SonarCloud for code coverage reports. ([#444])

[#430]: https://github.com/ClickHouse/clickhouse-js/pull/430
[#441]: https://github.com/ClickHouse/clickhouse-js/pull/441
[#442]: https://github.com/ClickHouse/clickhouse-js/pull/442
[#443]: https://github.com/ClickHouse/clickhouse-js/pull/443
[#444]: https://github.com/ClickHouse/clickhouse-js/pull/444
[#445]: https://github.com/ClickHouse/clickhouse-js/pull/445
[looskie]: https://github.com/looskie
[ClickHouse 25.1]: https://github.com/ClickHouse/ClickHouse/pull/74181
[JSONEachRowWithProgress example]: https://github.com/ClickHouse/clickhouse-js/blob/main/examples/node/select_json_each_row_with_progress.ts
[Codecov]: https://codecov.io/gh/ClickHouse/clickhouse-js

# 1.11.2 (Common, Node.js)

A minor release to allow further investigation regarding uncaught error issues with [#410].

## Types

- Added missing `lightweight_deletes_sync` typing to `ClickHouseSettings` ([#422], [pratimapatel2008])

## Improvements (Node.js)

- Added a new configuration option: `capture_enhanced_stack_trace`; see the JS doc in the Node.js client package. Note that it is disabled by default due to a possible performance impact. ([#427])
- Added more try-catch blocks to the Node.js connection layer. ([#427])

[#410]: https://github.com/ClickHouse/clickhouse-js/pull/410
[#422]: https://github.com/ClickHouse/clickhouse-js/pull/422
[#427]: https://github.com/ClickHouse/clickhouse-js/pull/427
[pratimapatel2008]: https://github.com/pratimapatel2008

# 1.11.1 (Common, Node.js, Web)

## Bug fixes

- Fixed an issue with URLEncoded special characters in the URL configuration for username or password. ([#407](https://github.com/ClickHouse/clickhouse-js/issues/407))

## Improvements

- Added support for streaming on 32-bit platforms. ([#403](https://github.com/ClickHouse/clickhouse-js/pull/403), [shevchenkonik](https://github.com/shevchenkonik))

# 1.11.0 (Common, Node.js, Web)

## New features

- It is now possible to provide custom HTTP headers when calling the `query`/`insert`/`command`/`exec` methods using the `http_headers` option. NB: `http_headers` specified this way will override `http_headers` set on the client instance level. ([#394](https://github.com/ClickHouse/clickhouse-js/issues/374), [@DylanRJohnston](https://github.com/DylanRJohnston))
- (Web only) It is now possible to provide a custom `fetch` implementation to the client. ([#315](https://github.com/ClickHouse/clickhouse-js/issues/315), [@lucacasonato](https://github.com/lucacasonato))

# 1.10.1 (Common, Node.js, Web)

## Bug fixes

- Fixed `NULL` parameter binding with `Tuple`, `Array`, and `Map` types. ([#374](https://github.com/ClickHouse/clickhouse-js/issues/374))

## Improvements

- `ClickHouseSettings` typings now include `session_timeout` and `session_check` settings. ([#370](https://github.com/ClickHouse/clickhouse-js/issues/370))

# 1.10.0 (Common, Node.js, Web)

## New features

- Added support for JWT authentication (ClickHouse Cloud feature) in both Node.js and Web API packages. JWT token can be set via `access_token` client configuration option.

  ```ts
  const client = createClient({
    // ...
    access_token: '<JWT access token>',
  })
  ```

  Access token can also be configured via the URL params, e.g., `https://host:port?access_token=...`.

  It is also possible to override the access token for a particular request (see `BaseQueryParams.auth` for more details).

  NB: do not mix access token and username/password credentials in the configuration; the client will throw an error if both are set.

# 1.9.1 (Node.js only)

## Bug fixes

- Fixed an uncaught exception that could happen in case of malformed ClickHouse response when response compression is enabled ([#363](https://github.com/ClickHouse/clickhouse-js/issues/363))

# 1.9.0 (Common, Node.js, Web)

## New features

- Added `input_format_json_throw_on_bad_escape_sequence` to the `ClickhouseSettings` type. ([#355](https://github.com/ClickHouse/clickhouse-js/pull/355), [@emmanuel-bonin](https://github.com/emmanuel-bonin))
- The client now exports `TupleParam` wrapper class, allowing tuples to be properly used as query parameters. Added support for JS Map as a query parameter. ([#359](https://github.com/ClickHouse/clickhouse-js/pull/359))

## Improvements

- The client will throw a more informative error if the buffered response is larger than the max allowed string length in V8, which is `2**29 - 24` bytes. ([#357](https://github.com/ClickHouse/clickhouse-js/pull/357))

# 1.8.1 (Node.js)

## Bug fixes

- When a custom HTTP agent is used, the HTTP or HTTPS request implementation is now correctly chosen based on the URL protocol. ([#352](https://github.com/ClickHouse/clickhouse-js/issues/352))

# 1.8.0 (Common, Node.js, Web)

## New features

- Added support for specifying roles via request query parameters. See [this example](examples/role.ts) for more details. ([@pulpdrew](https://github.com/pulpdrew), [#328](https://github.com/ClickHouse/clickhouse-js/pull/328))

# 1.7.0 (Common, Node.js, Web)

## Bug fixes

- (Web only) Fixed an issue where streaming large datasets could provide corrupted results. See [#333](https://github.com/ClickHouse/clickhouse-js/pull/333) (PR) for more details.

## New features

- Added `JSONEachRowWithProgress` format support, `ProgressRow` interface, and `isProgressRow` type guard. See [this Node.js example](./examples/node/select_json_each_row_with_progress.ts) for more details. It should work similarly with the Web version.
- (Experimental) Exposed the `parseColumnType` function that takes a string representation of a ClickHouse type (e.g., `FixedString(16)`, `Nullable(Int32)`, etc.) and returns an AST-like object that represents the type. For example:

  ```ts
  for (const type of [
    'Int32',
    'Array(Nullable(String))',
    `Map(Int32, DateTime64(9, 'UTC'))`,
  ]) {
    console.log(`##### Source ClickHouse type: ${type}`)
    console.log(parseColumnType(type))
  }
  ```

  The above code will output:

  ```
  ##### Source ClickHouse type: Int32
  { type: 'Simple', columnType: 'Int32', sourceType: 'Int32' }
  ##### Source ClickHouse type: Array(Nullable(String))
  {
    type: 'Array',
    value: {
      type: 'Nullable',
      sourceType: 'Nullable(String)',
      value: { type: 'Simple', columnType: 'String', sourceType: 'String' }
    },
    dimensions: 1,
    sourceType: 'Array(Nullable(String))'
  }
  ##### Source ClickHouse type: Map(Int32, DateTime64(9, 'UTC'))
  {
    type: 'Map',
    key: { type: 'Simple', columnType: 'Int32', sourceType: 'Int32' },
    value: {
      type: 'DateTime64',
      timezone: 'UTC',
      precision: 9,
      sourceType: "DateTime64(9, 'UTC')"
    },
    sourceType: "Map(Int32, DateTime64(9, 'UTC'))"
  }
  ```

  While the original intention was to use this function internally for `Native`/`RowBinaryWithNamesAndTypes` data formats headers parsing, it can be useful for other purposes as well (e.g., interfaces generation, or custom JSON serializers).

  NB: currently unsupported source types to parse:
  - Geo
  - (Simple)AggregateFunction
  - Nested
  - Old/new experimental JSON
  - Dynamic
  - Variant

# 1.6.0 (Common, Node.js, Web)

## New features

- Added optional `real_time_microseconds` field to the `ClickHouseSummary` interface (see <https://github.com/ClickHouse/ClickHouse/pull/69032>)

## Bug fixes

- Fixed unhandled exceptions produced when calling `ResultSet.json` if the response data was not in fact a valid JSON. ([#311](https://github.com/ClickHouse/clickhouse-js/pull/311))

# 1.5.0 (Node.js)

## New features

- It is now possible to disable the automatic decompression of the response stream with the `exec` method. See `ExecParams.decompress_response_stream` for more details. ([#298](https://github.com/ClickHouse/clickhouse-js/issues/298)).

# 1.4.1 (Node.js, Web)

## Improvements

- `ClickHouseClient` is now exported as a value from `@clickhouse/client` and `@clickhouse/client-web` packages, allowing for better integration in dependency injection frameworks that rely on IoC (e.g., [Nest.js](https://github.com/nestjs/nest), [tsyringe](https://github.com/microsoft/tsyringe)) ([@mathieu-bour](https://github.com/mathieu-bour), [#292](https://github.com/ClickHouse/clickhouse-js/issues/292)).

## Bug fixes

- Fixed a potential socket hang up issue that could happen under 100% CPU load ([#294](https://github.com/ClickHouse/clickhouse-js/issues/294)).

# 1.4.0 (Node.js)

## New features

- (Node.js only) The `exec` method now accepts an optional `values` parameter, which allows you to pass the request body as a `Stream.Readable`. This can be useful in case of custom insert streaming with arbitrary ClickHouse data formats (which might not be explicitly supported and allowed by the client in the `insert` method yet). NB: in this case, you are expected to serialize the data in the stream in the required input format yourself.

# 1.3.0 (Common, Node.js, Web)

## New features

- It is now possible to get the entire response headers object from the `query`/`insert`/`command`/`exec` methods. With `query`, you can access the `ResultSet.response_headers` property; other methods (`insert`/`command`/`exec`) return it as parts of their response objects as well.
  For example:

  ```ts
  const rs = await client.query({
    query: 'SELECT * FROM system.numbers LIMIT 1',
    format: 'JSONEachRow',
  })
  console.log(rs.response_headers['content-type'])
  ```

  This will print: `application/x-ndjson; charset=UTF-8`. It can be used in a similar way with the other methods.

## Improvements

- Re-exported several constants from the `@clickhouse/client-common` package for convenience:
  - `SupportedJSONFormats`
  - `SupportedRawFormats`
  - `StreamableFormats`
  - `StreamableJSONFormats`
  - `SingleDocumentJSONFormats`
  - `RecordsJSONFormats`

# 1.2.0 (Node.js)

## New features

- (Experimental) Added an option to provide a custom HTTP Agent in the client configuration via the `http_agent` option ([#283](https://github.com/ClickHouse/clickhouse-js/issues/283), related: [#278](https://github.com/ClickHouse/clickhouse-js/issues/278)). The following conditions apply if a custom HTTP Agent is provided:
  - The `max_open_connections` and `tls` options will have _no effect_ and will be ignored by the client, as it is a part of the underlying HTTP Agent configuration.
  - `keep_alive.enabled` will only regulate the default value of the `Connection` header (`true` -> `Connection: keep-alive`, `false` -> `Connection: close`).
  - While the idle socket management will still work, it is now possible to disable it completely by setting the `keep_alive.idle_socket_ttl` value to `0`.
- (Experimental) Added a new client configuration option: `set_basic_auth_header`, which disables the `Authorization` header that is set by the client by default for every outgoing HTTP request. One of the possible scenarios when it is necessary to disable this header is when a custom HTTPS agent is used, and the server requires TLS authorization. For example:

  ```ts
  const agent = new https.Agent({
    ca: fs.readFileSync('./ca.crt'),
  })
  const client = createClient({
    url: 'https://server.clickhouseconnect.test:8443',
    http_agent: agent,
    // With a custom HTTPS agent, the client won't use the default HTTPS connection implementation; the headers should be provided manually
    http_headers: {
      'X-ClickHouse-User': 'default',
      'X-ClickHouse-Key': '',
    },
    // Authorization header conflicts with the TLS headers; disable it.
    set_basic_auth_header: false,
  })
  ```

NB: It is currently not possible to set the `set_basic_auth_header` option via the URL params.

If you have feedback on these experimental features, please let us know by creating [an issue](https://github.com/ClickHouse/clickhouse-js/issues) in the repository.

# 1.1.0 (Common, Node.js, Web)

## New features

- Added an option to override the credentials for a particular `query`/`command`/`exec`/`insert` request via the `BaseQueryParams.auth` setting; when set, the credentials will be taken from there instead of the username/password provided during the client instantiation ([#278](https://github.com/ClickHouse/clickhouse-js/issues/278)).
- Added an option to override the `session_id` for a particular `query`/`command`/`exec`/`insert` request via the `BaseQueryParams.session_id` setting; when set, it will be used instead of the session id provided during the client instantiation ([@holi0317](https://github.com/Holi0317), [#271](https://github.com/ClickHouse/clickhouse-js/issues/271)).

## Bug fixes

- Fixed the incorrect `ResponseJSON<T>.totals` TypeScript type. Now it correctly matches the shape of the data (`T`, default = `unknown`) instead of the former `Record<string, number>` definition ([#274](https://github.com/ClickHouse/clickhouse-js/issues/274)).

# 1.0.2 (Common, Node.js, Web)

## Bug fixes

- The `command` method now drains the response stream properly, as the previous implementation could cause the `Keep-Alive` socket to close after each request.
- Removed an unnecessary error log in the `ResultSet.stream` method if the request was aborted or the result set was closed ([#263](https://github.com/ClickHouse/clickhouse-js/issues/263)).

## Improvements

- `ResultSet.stream` logs an error via the `Logger` instance, if the stream emits an error event instead of a simple `console.error` call.
- Minor adjustments to the `DefaultLogger` log messages formatting.
- Added missing `rows_before_limit_at_least` to the ResponseJSON type ([@0237h](https://github.com/0237h), [#267](https://github.com/ClickHouse/clickhouse-js/issues/267)).

# 1.0.1 (Common, Node.js, Web)

## Bug fixes

- Fixed the regression where the default HTTP/HTTPS port numbers (80/443) could not be used with the URL configuration ([#258](https://github.com/ClickHouse/clickhouse-js/issues/258)).

# 1.0.0 (Common, Node.js, Web)

Formal stable release milestone with a lot of improvements and some [breaking changes](#breaking-changes-in-100).

Major new features overview:

- [Advanced TypeScript support for `query` + `ResultSet`](#advanced-typescript-support-for-query--resultset)
- [URL configuration](#url-configuration)

From now on, the client will follow the [official semantic versioning](https://docs.npmjs.com/about-semantic-versioning) guidelines.

## Deprecated API

The following configuration parameters are marked as deprecated:

- `host` configuration parameter is deprecated; use `url` instead.
- `additional_headers` configuration parameter is deprecated; use `http_headers` instead.

The client will log a warning if any of these parameters are used. However, it is still allowed to use `host` instead of `url` and `additional_headers` instead of `http_headers` for now; this deprecation is not supposed to break the existing code.

These parameters will be removed in the next major release (2.0.0).

See "New features" section for more details.

## Breaking changes in 1.0.0

- `compression.response` is now disabled by default in the client configuration options, as it cannot be used with readonly=1 users, and it was not clear from the ClickHouse error message what exact client option was causing the failing query in this case. If you'd like to continue using response compression, you should explicitly enable it in the client configuration.
- As the client now supports parsing [URL configuration](#url-configuration), you should specify `pathname` as a separate configuration option (as it would be considered as the `database` otherwise).
- (TypeScript only) `ResultSet` and `Row` are now more strictly typed, according to the format used during the `query` call. See [this section](#advanced-typescript-support-for-query--resultset) for more details.
- (TypeScript only) Both Node.js and Web versions now uniformly export correct `ClickHouseClient` and `ClickHouseClientConfigOptions` types, specific to each implementation. Exported `ClickHouseClient` now does not have a `Stream` type parameter, as it was unintended to expose it there. NB: you should still use `createClient` factory function provided in the package.

## New features in 1.0.0

### Advanced TypeScript support for `query` + `ResultSet`

Client will now try its best to figure out the shape of the data based on the DataFormat literal specified to the `query` call, as well as which methods are allowed to be called on the `ResultSet`.

Live demo (see the full description below):

[Screencast](https://github.com/ClickHouse/clickhouse-js/assets/3175289/b66afcb2-3a10-4411-af59-51d2754c417e)

Complete reference:

| Format                          | `ResultSet.json<T>()` | `ResultSet.stream<T>()`     | Stream data       | `Row.json<T>()` |
| ------------------------------- | --------------------- | --------------------------- | ----------------- | --------------- |
| JSON                            | ResponseJSON\<T\>     | never                       | never             | never           |
| JSONObjectEachRow               | Record\<string, T\>   | never                       | never             | never           |
| All other JSON\*EachRow         | Array\<T\>            | Stream\<Array\<Row\<T\>\>\> | Array\<Row\<T\>\> | T               |
| CSV/TSV/CustomSeparated/Parquet | never                 | Stream\<Array\<Row\<T\>\>\> | Array\<Row\<T\>\> | never           |

By default, `T` (which represents `JSONType`) is still `unknown`. However, considering `JSONObjectsEachRow` example: prior to 1.0.0, you had to specify the entire type hint, including the shape of the data, manually:

```ts
type Data = { foo: string }

const resultSet = await client.query({
  query: 'SELECT * FROM my_table',
  format: 'JSONObjectsEachRow',
})

// pre-1.0.0, `resultOld` has type Record<string, Data>
const resultOld = resultSet.json<Record<string, Data>>()
// const resultOld = resultSet.json<Data>() // incorrect! The type hint should've been `Record<string, Data>` here.

// 1.0.0, `resultNew` also has type Record<string, Data>; client inferred that it has to be a Record from the format literal.
const resultNew = resultSet.json<Data>()
```

This is even more handy in case of streaming on the Node.js platform:

```ts
const resultSet = await client.query({
  query: 'SELECT * FROM my_table',
  format: 'JSONEachRow',
})

// pre-1.0.0
// `streamOld` was just a regular Node.js Stream.Readable
const streamOld = resultSet.stream()
// `rows` were `any`, needed an explicit type hint
streamNew.on('data', (rows: Row[]) => {
  rows.forEach((row) => {
    // without an explicit type hint to `rows`, calling `forEach` and other array methods resulted in TS compiler errors
    const t = row.text
    const j = row.json<Data>() // `j` needed a type hint here, otherwise, it's `unknown`
  })
})

// 1.0.0
// `streamNew` is now StreamReadable<T> (Node.js Stream.Readable with a bit more type hints);
// type hint for the further `json` calls can be added here (and removed from the `json` calls)
const streamNew = resultSet.stream<Data>()
// `rows` are inferred as an Array<Row<Data, "JSONEachRow">> instead of `any`
streamNew.on('data', (rows) => {
  // `row` is inferred as Row<Data, "JSONEachRow">
  rows.forEach((row) => {
    // no explicit type hints required, you can use `forEach` straight away and TS compiler will be happy
    const t = row.text
    const j = row.json() // `j` will be of type Data
  })
})

// async iterator now also has type hints
// similarly to the `on(data)` example above, `rows` are inferred as Array<Row<Data, "JSONEachRow">>
for await (const rows of streamNew) {
  // `row` is inferred as Row<Data, "JSONEachRow">
  rows.forEach((row) => {
    const t = row.text
    const j = row.json() // `j` will be of type Data
  })
}
```

Calling `ResultSet.stream` is not allowed for certain data formats, such as `JSON` and `JSONObjectsEachRow` (unlike `JSONEachRow` and the rest of `JSON*EachRow`, these formats return a single object). In these cases, the client throws an error. However, it was previously not reflected on the type level; now, calling `stream` on these formats will result in a TS compiler error. For example:

```ts
const resultSet = await client.query('SELECT * FROM table', {
  format: 'JSON',
})
const stream = resultSet.stream() // `stream` is `never`
```

Calling `ResultSet.json` also does not make sense on `CSV` and similar "raw" formats, and the client throws. Again, now, it is typed properly:

```ts
const resultSet = await client.query('SELECT * FROM table', {
  format: 'CSV',
})
// `json` is `never`; same if you stream CSV, and call `Row.json` - it will be `never`, too.
const json = resultSet.json()
```

Currently, there is one known limitation: as the general shape of the data and the methods allowed for calling are inferred from the format literal, there might be situations where it will fail to do so, for example:

```ts
// assuming that `queryParams` has `JSONObjectsEachRow` format inside
async function runQuery(
  queryParams: QueryParams,
): Promise<Record<string, Data>> {
  const resultSet = await client.query(queryParams)
  // type hint here will provide a union of all known shapes instead of a specific one
  // inferred shapes: Data[] | ResponseJSON<Data> | Record<string, Data>
  return resultSet.json<Data>()
}
```

In this case, as it is _likely_ that you already know the desired format in advance (otherwise, returning a specific shape like `Record<string, Data>` would've been incorrect), consider helping the client a bit:

```ts
async function runQuery(
  queryParams: QueryParams,
): Promise<Record<string, Data>> {
  const resultSet = await client.query({
    ...queryParams,
    format: 'JSONObjectsEachRow',
  })
  // TS understands that it is a Record<string, Data> now
  return resultSet.json<Data>()
}
```

If you are interested in more details, see the [related test](./packages/client-node/__tests__/integration/node_query_format_types.test.ts) (featuring a great ESLint plugin [expect-types](https://github.com/JoshuaKGoldberg/eslint-plugin-expect-type)) in the client package.

### URL configuration

- Added `url` configuration parameter. It is intended to replace the deprecated `host`, which was already supposed to be passed as a valid URL.
- It is now possible to configure most of the client instance parameters with a URL. The URL format is `http[s]://[username:password@]hostname:port[/database][?param1=value1&param2=value2]`. In almost every case, the name of a particular parameter reflects its path in the config options interface, with a few exceptions. The following parameters are supported:

| Parameter                                   | Type                                                              |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `pathname`                                  | an arbitrary string.                                              |
| `application_id`                            | an arbitrary string.                                              |
| `session_id`                                | an arbitrary string.                                              |
| `request_timeout`                           | non-negative number.                                              |
| `max_open_connections`                      | non-negative number, greater than zero.                           |
| `compression_request`                       | boolean. See below [1].                                           |
| `compression_response`                      | boolean.                                                          |
| `log_level`                                 | allowed values: `OFF`, `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`. |
| `keep_alive_enabled`                        | boolean.                                                          |
| `clickhouse_setting_*` or `ch_*`            | see below [2].                                                    |
| `http_header_*`                             | see below [3].                                                    |
| (Node.js only) `keep_alive_idle_socket_ttl` | non-negative number.                                              |

[1] For booleans, valid values will be `true`/`1` and `false`/`0`.

[2] Any parameter prefixed with `clickhouse_setting_` or `ch_` will have this prefix removed and the rest added to client's `clickhouse_settings`. For example, `?ch_async_insert=1&ch_wait_for_async_insert=1` will be the same as:

```ts
createClient({
  clickhouse_settings: {
    async_insert: 1,
    wait_for_async_insert: 1,
  },
})
```

Note: boolean values for `clickhouse_settings` should be passed as `1`/`0` in the URL.

[3] Similar to [2], but for `http_header` configuration. For example, `?http_header_x-clickhouse-auth=foobar` will be an equivalent of:

```ts
createClient({
  http_headers: {
    'x-clickhouse-auth': 'foobar',
  },
})
```

**Important: URL will _always_ overwrite the hardcoded values and a warning will be logged in this case.**

Currently not supported via URL:

- `log.LoggerClass`
- (Node.js only) `tls_ca_cert`, `tls_cert`, `tls_key`.

See also: [URL configuration example](./examples/url_configuration.ts).

### Performance

- (Node.js only) Improved performance when decoding the entire set of rows with _streamable_ JSON formats (such as `JSONEachRow` or `JSONCompactEachRow`) by calling the `ResultSet.json()` method. NB: The actual streaming performance when consuming the `ResultSet.stream()` hasn't changed. Only the `ResultSet.json()` method used a suboptimal stream processing in some instances, and now `ResultSet.json()` just consumes the same stream transformer provided by the `ResultSet.stream()` method (see [#253](https://github.com/ClickHouse/clickhouse-js/pull/253) for more details).

### Miscellaneous

- Added `http_headers` configuration parameter as a direct replacement for `additional_headers`. Functionally, it is the same, and the change is purely cosmetic, as we'd like to leave an option to implement TCP connection in the future open.

## 0.3.1 (Common, Node.js, Web)

### Bug fixes

- Fixed an issue where query parameters containing tabs or newline characters were not encoded properly.

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
  'CREATE TABLE foo (id String) ENGINE Memory',
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
