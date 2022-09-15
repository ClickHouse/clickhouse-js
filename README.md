<p align="center">
<img src=".static/logo.png" width="200px" align="center">
<h1 align="center">ClickHouse Node.JS client</h1>
</p>
<br/>
<p align="center">
<a href="https://github.com/ClickHouse/clickhouse-js/actions/workflows/run-tests.yml">
<img src="https://github.com/ClickHouse/clickhouse-js/actions/workflows/run-tests.yml/badge.svg?branch=main">
</a>
</p>

## Introduction

Official Node.js client for [ClickHouse](https://clickhouse.com/), written purely in TypeScript, thoroughly tested with actual ClickHouse versions.

It is focused on data streaming for both inserts and selects using standard [Node.js Streaming API](https://nodejs.org/docs/latest-v14.x/api/stream.html).

## Compatibility

The client is tested with the following ClickHouse and Node.js versions:

| Node.js | ClickHouse | Status |
|---------|------------|--------|
| 14.x    | 22.8       | ✔      |
| 16.x    | 22.8       | ✔      |
| 18.x    | 22.8       | ✔      |
| 14.x    | 22.9       | ✔      |
| 16.x    | 22.9       | ✔      |
| 18.x    | 22.9       | ✔      |

## Installation

```bash
npm i @clickhouse/client
```

## Connection

Currently, only HTTP(s) protocol is supported.

A very basic connection to a single local ClickHouse instance with default settings (for example, if it is running as a Docker container as described in the [contribution guide](./CONTRIBUTING.md)):

```ts
import { createClient } from '@clickhouse/client'

const client = createClient()
```

Basic HTTPS connection:

```ts
import { createClient } from '@clickhouse/client'

const client = createClient({
  host: `https://<YOUR_CLICKHOUSE_HOST>:8443`,
  password: '<YOUR_CLICKHOUSE_PASSWORD>',
  database: '<YOUR_CLICKHOUSE_DATABASE>',
})
```

Using custom ClickHouse settings and forced HTTP compression (GZIP) for both request and response:

```ts
import { createClient } from '@clickhouse/client'

const client = createClient({
  host: `https://<YOUR_CLICKHOUSE_HOST>:8443`,
  password: '<YOUR_CLICKHOUSE_PASSWORD>',
  database: '<YOUR_CLICKHOUSE_DATABASE>',
  compression: {
    request: true,
    response: true,
  },
  clickhouse_settings: {
    insert_quorum: '2',
  },
})
```

Closing the connection:

```ts
await client.close()
```

### Connection settings overview

See [ClickHouseClientConfigOptions](https://github.com/ClickHouse/clickhouse-js/blob/60c484a3492420baed4b4c6c33cc0845262285e7/src/client.ts#L13-L35)

```ts
export interface ClickHouseClientConfigOptions {
  // a valid URL, for example, https://myclickhouseserver.org:8123
  // if unset, defaults to http://localhost:8123
  host?: string

  // milliseconds, default 10_000
  connect_timeout?: number

  // milliseconds, default 300_000
  request_timeout?: number

  // For HTTP protocol, the connection pool has infinite size by default
  // it can be overriden with this setting
  max_open_connections?: number

  // HTTP compression settings. Uses GZIP.
  // For more details, see https://clickhouse.com/docs/en/interfaces/http/#compression
  compression?: {
    // enabled by default - the server will compress the data it sends to you in the response
    response?: boolean
    // disabled by default - the server will decompress the data which you pass in the request
    request?: boolean
  }

  // if not set, 'default' is used
  username?: string

  // if not set, an empty password is used
  password?: string

  // used to identify the connection on the server side, if not set, uses 'clickhouse-js'
  application?: string

  // if not set, 'default' is used
  database?: string

  // additional settings to send with every query, such as `date_time_input_format` or `insert_quorum`
  // see https://clickhouse.com/docs/en/operations/settings/settings/
  // typings should support most of the options listed there
  clickhouse_settings?: ClickHouseSettings

  // logger settings
  log?: {
    // disabled by default, can be enabled using this setting
    enable?: boolean
    // use it to override default clickhouse-js logger with your own implementation
    LoggerClass?: new (enabled: boolean) => Logger
  }
}
```

See also:

- [ClickHouseSettings](https://github.com/ClickHouse/clickhouse-js/blob/730b1b2516e2d47dc9a32b1d8d0b8ba8ceb95ead/src/settings.ts#L10-L1201)

- [Logger](https://github.com/ClickHouse/clickhouse-js/blob/ebdcab7a5d00d53bbbe46cce45c14bbcfda93f0c/src/logger.ts)

## Supported formats

| Format                                     | Input (array) | Input (stream) | Output (JSON) | Output (text) |
|--------------------------------------------|---------------|----------------|---------------|---------------|
| JSON                                       | ❌             | ❌              | ✔️            | ✔️            |
| JSONEachRow                                | ✔️            | ✔️             | ✔️            | ✔️            |
| JSONStringsEachRow                         | ✔️            | ✔️             | ✔️            | ✔️            |
| JSONCompactEachRow                         | ✔️            | ✔️             | ✔️            | ✔️            |
| JSONCompactStringsEachRow                  | ✔️            | ✔️             | ✔️            | ✔️            |
| JSONCompactEachRowWithNames                | ✔️            | ✔️             | ✔️            | ✔️            |
| JSONCompactEachRowWithNamesAndTypes        | ✔️            | ✔️             | ✔️            | ✔️            |
| JSONCompactStringsEachRowWithNames         | ✔️            | ✔️             | ✔️            | ✔️            |
| JSONCompactStringsEachRowWithNamesAndTypes | ✔️            | ✔️             | ✔️            | ✔️            |
| CSV                                        | ❌             | ✔️             | ❌             | ✔️            |
| CSVWithNames                               | ❌             | ✔️             | ❌             | ✔️            |
| CSVWithNamesAndTypes                       | ❌             | ✔️             | ❌             | ✔️            |
| TabSeparated                               | ❌             | ✔️             | ❌             | ✔️            |
| TabSeparatedRaw                            | ❌             | ✔️             | ❌             | ✔️            |
| TabSeparatedWithNames                      | ❌             | ✔️             | ❌             | ✔️            |
| TabSeparatedWithNamesAndTypes              | ❌             | ✔️             | ❌             | ✔️            |
| CustomSeparated                            | ❌             | ✔️             | ❌             | ✔️            |
| CustomSeparatedWithNames                   | ❌             | ✔️             | ❌             | ✔️            |
| CustomSeparatedWithNamesAndTypes           | ❌             | ✔️             | ❌             | ✔️            |

The entire list of ClickHouse input and output formats is available [here](https://clickhouse.com/docs/en/interfaces/formats).

## Supported ClickHouse data types

| Type           | Status         | JS type                               |
|----------------|----------------|---------------------------------------|
| UInt8/16/32    | ✔️             | number                                |
| UInt64/128/256 | ✔️❗- see below | string                                |
| Int8/16/32     | ✔️             | number                                |
| Int64/128/256  | ✔️❗- see below | string                                |
| Float32/64     | ✔️             | number                                |
| Decimal        | ✔️❗- see below | number                                |
| Boolean        | ✔️             | boolean                               |
| String         | ✔️             | string                                |
| FixedString    | ✔️             | string                                |
| UUID           | ✔️             | string                                |
| Date32/64      | ✔️❗- see below | string                                |
| DateTime32/64  | ✔️❗- see below | string                                |
| Enum           | ✔️             | string                                |
| LowCardinality | ✔️             | string                                |
| Array(T)       | ✔️             | Array\<JS type for T>                 |
| JSON           | ✔️             | object                                |
| Nested         | ❌              | -                                     |
| Tuple          | ✔️             | Tuple                                 |
| Nullable(T)    | ✔️             | JS type for T or null                 |
| IPv4           | ✔️             | string                                |
| IPv6           | ✔️             | string                                |
| Point          | ✔️             | [ number, number ]                    |
| Ring           | ✔️             | Array\<Point>                         |
| Polygon        | ✔️             | Array\<Ring>                          |
| MultiPolygon   | ✔️             | Array\<Polygon>                       |
| Map(K, V)      | ✔️             | Record\<JS type for K, JS type for V> |

The entire list of supported ClickHouse formats is available [here](https://clickhouse.com/docs/en/sql-reference/data-types/).

### Date* / DateTime* types caveats:

Since we use data streaming for inserts without the `VALUES` clause (which does additional type conversion), Date\* type columns can be only inserted as strings and not as Unix time epoch. It can be possibly changed with the future ClickHouse database releases. Please refer to the corresponding [integration tests](https://github.com/ClickHouse/clickhouse-js/blob/ba387d7f4ce375a60982ac2d99cb47391cf76cec/__tests__/integration/date_time.test.ts) for more examples.

### Decimal\* types caveats:

Since we do not use `VALUES` clause and there is no additional type conversion, it is not possible to insert Decimal* type columns as strings, only as numbers. This is a suboptimal approach as it might end in float precision loss. Thus, it is recommended to avoid JSON* formats when using Decimals as of now. Consider TabSeparated* / CSV* / CustomSeparated\* formats families for that kind of workflows. Please refer to the [data types tests](https://github.com/ClickHouse/clickhouse-js/blob/c1b70c82f525c39edb3ca1ee05cb5e6b43dba5b3/__tests__/integration/data_types.test.ts#L98-L131) for more concrete examples on how to avoid precision loss.

### NB: Int64, Int128, Int256, UInt64, UInt128, UInt256

Though the server can accept it as a number, it is by default returned as a string in JSON\* family output formats to avoid integer overflow as max values for these types are bigger than `Number.MAX_SAFE_INTEGER`.

This behavior, however, can be modified with [`output_format_json_quote_64bit_integers` setting](https://clickhouse.com/docs/en/operations/settings/settings/#output_format_json_quote_64bit_integers).

## ClickHouse client API overview

### Query

Used for most statements that can have a response, such as `SELECT`, or for sending DDLs such as `CREATE TABLE`. For data insertion, please consider using the dedicated method `insert` which is described next.

```ts
interface QueryParams {
  // Query to execute that might return some data
  // IMPORTANT: do not specify the FORMAT clause here
  // use `format` param instead.
  query: string
  // Desired OUTPUT data format to be appended the query as ` FORMAT $format`
  // It is extracted to the separate param
  // as we may need to apply some additional request logic
  // based on the desired format
  format?: DataFormat
  // ClickHouse settings that can be applied on query level, such as `date_time_input_format`
  clickhouse_settings?: ClickHouseSettings
  // See https://clickhouse.com/docs/en/interfaces/http/#cli-queries-with-parameters for more details
  // IMPORTANT: that you should not prefix it with `param_` here, client will do that for you
  query_params?: Record<string, unknown>
  // A query can be aborted using this standard AbortSignal instance
  // Please refer to the usage examples for more details
  abort_signal?: AbortSignal
}

class ClickHouseClient {
  query(params: QueryParams): Promise<Rows> {}
  // ...
}
```

#### Rows response abstraction

Provides several convenience methods for data processing in your application.

```ts
class Rows {
  // Consume the entire stream and get the contents as a string
  // Can be used with any DataFormat
  // Should be called only once
  text(): Promise<string> {}
  // Consume the entire stream and get the contents as a JS object
  // Can be used only with JSON formats
  // Should be called only once
  json<T>(): Promise<T> {}
  // Returns a readable stream of Row instances for responses that can be streamed (i.e. all except JSON)
  // Should be called only once
  // NB: if called for the second time, the second stream will be just empty
  stream(): Stream.Readable {}
}

class Row {
  // Get the content of the row as plain string
  text(): string {}
  // Get the content of the row as a JS object
  json<T>(): T {}
}
```

### Insert

Primary method for data insertion. It can work with both `Stream.Readable` (all formats except `JSON`) and plain `Array<T>` (`JSON*` family formats only). It is recommended to avoid arrays in case of large inserts to reduce application memory consumption, and consider streaming for most of the use cases.

Should be awaited, but it does not return anything.

```ts
interface InsertParams<T> {
  // Table name to insert the data into
  table: string
  // Stream.Readable will work for all formats except JSON
  // Array will work only for JSON* formats
  values: ReadonlyArray<T> | Stream.Readable
  // Desired INPUT data format to be appended the statement as ` FORMAT $format`
  // It is extracted to the separate param
  // as we may need to apply some additional request logic
  // based on the desired format
  format?: DataFormat
  // ClickHouse settings that can be applied on statement level, such as `insert_quorum`
  clickhouse_settings?: ClickHouseSettings
  // See https://clickhouse.com/docs/en/interfaces/http/#cli-queries-with-parameters for more details
  // IMPORTANT: that you should not prefix it with `param_` here, client will do that for you
  query_params?: Record<string, unknown>
  // A query can be aborted using this standard AbortSignal instance
  // Please refer to the usage examples for more details
  abort_signal?: AbortSignal
}

class ClickHouseClient {
  insert(params: InsertParams): Promise<void> {}
  // ...
}
```

### Exec

Can be used for statements that do not have any output, when format clause is not applicable, or when you are not interested in the response at all. An example of such statement can be `CREATE TABLE` or `ALTER TABLE`.

Should be awaited.

Optionally, it returns a readable stream that can be consumed on the application side if you need it for some reason. But in that case you might consider using `query` instead.

```ts
interface ExecParams {
  // Statement to execute
  query: string
  // ClickHouse settings that can be applied on query level, such as `date_time_input_format`
  clickhouse_settings?: ClickHouseSettings
  // See https://clickhouse.com/docs/en/interfaces/http/#cli-queries-with-parameters for more details
  // IMPORTANT: that you should not prefix it with `param_` here, client will do that for you
  query_params?: Record<string, unknown>
  // A query can be aborted using this standard AbortSignal instance
  // Please refer to the usage examples for more details
  abort_signal?: AbortSignal
}

class ClickHouseClient {
  exec(params: ExecParams): Promise<Stream.Readable> {}
  // ...
}
```

### Ping

Might be useful to check the connectivity to the ClickHouse server. Returns `true` if server can be reached. Can throw a standard Node.js Error such as `ECONNREFUSED`.

```ts
class ClickHouseClient {
  ping(): Promise<boolean> {}
  // ...
}
```

### Close

Use it in your application graceful shutdown handler, as it properly closes all the open connections.

```ts
class ClickHouseClient {
  close(): Promise<void> {}
  // ...
}
```

## Usage examples

### Create a table (single node)

```ts
await client.exec({
  query: `
    CREATE TABLE foobar
    (id UInt64, name String)
    ENGINE MergeTree()
    ORDER BY (id)
  `,
})
```

### Create a table (local cluster)

```ts
await client.exec({
  query: `
    CREATE TABLE foobar ON CLUSTER '{cluster}'
    (id UInt64, name String)
    ENGINE ReplicatedMergeTree(
      '/clickhouse/{cluster}/tables/{database}/{table}/{shard}',
      '{replica}'
    )
    ORDER BY (id)
  `,
  // Recommended for cluster usage to avoid situations
  // where a query processing error occurred after the response code
  // and HTTP headers were sent to the client.
  // See https://clickhouse.com/docs/en/interfaces/http/#response-buffering
  clickhouse_settings: {
    wait_end_of_query: 1,
  },
})
```

### Create a table (ClickHouse cloud)

Note that `ENGINE` and `ON CLUSTER` clauses can be omitted entirely here.

ClickHouse cloud will automatically use `ReplicatedMergeTree` with appropriate settings in this case.

```ts
await client.exec({
  query: `
    CREATE TABLE foobar
    (id UInt64, name String)
    ORDER BY (id)
  `,
  // Recommended for cluster usage to avoid situations
  // where a query processing error occurred after the response code
  // and HTTP headers were sent to the client.
  // See https://clickhouse.com/docs/en/interfaces/http/#response-buffering
  clickhouse_settings: {
    wait_end_of_query: 1,
  },
})
```

### Insert with array input (JSON\* family formats only)

```ts
await client.insert({
  table: tableName,
  // structure should match the desired format, JSONEachRow in this example
  values: [
    { id: 42, name: 'foo' },
    { id: 42, name: 'bar' },
  ],
  format: 'JSONEachRow',
})
```

### Insert with stream input (any format except JSON, stream is created out of an array)

```ts
await client.insert({
  table: tableName,
  // structure should match the desired format, JSONCompactEachRow in this example
  values: Stream.Readable.from([
    [42, 'foo'],
    [42, 'bar'],
  ]),
  format: 'JSONCompactEachRow',
})
```

### Insert with stream input (any format except JSON, flowing stream)

```ts
const stream = new Stream.Readable({
  objectMode: true, // required for JSON* family formats
  read() {
    /* stub */
  },
})
// ... your (async) code pushing the values into the stream...
await client.insert({
  table: tableName,
  values: stream,
  format: 'JSONEachRow', // or any other desired JSON* format
})
// close the stream when finished by pushing a null value there
stream.push(null)
```

### Insert with stream input ("raw" formats like CSV* / TabSeparated* / CustomSeparated\*, stream is created out of an array)

```ts
await client.insert({
  table: tableName,
  // structure should match the desired format, TabSeparated in this example
  values: Stream.Readable.from(['42,foobar'], {
    objectMode: false, // required for "raw" family formats
  }),
  format: 'TabSeparated', // or any other desired "raw" format
})
```

### Insert with stream input ("raw" formats like CSV* / TabSeparated* / CustomSeparated\*, flowing stream)

```ts
const stream = new Stream.Readable({
  objectMode: false, // required for "raw" family formats
  read() {
    /* stub */
  },
})
// ... your (async) code pushing the values into the stream...
await client.insert({
  table: tableName,
  values: stream,
  format: 'TabSeparated', // or any other desired "raw" format
})
// close the stream when finished by pushing a null value there
stream.push(null)
```

### Inserting a file (for example, CSV)

```ts
const filename = Path.resolve(process.cwd(), 'path/to/file.csv')
await client.insert({
  table: tableName,
  values: Fs.createReadStream(filename),
  format: 'CSVWithNames',
})
```

See also:

- [NDJSON file streaming example](https://github.com/ClickHouse/clickhouse-js/blob/60c484a3492420baed4b4c6c33cc0845262285e7/examples/streaming/stream_ndjson.ts)
- [Memory leaks test using Brown University benchmarks files](https://github.com/ClickHouse/clickhouse-js/blob/60c484a3492420baed4b4c6c33cc0845262285e7/benchmarks/leaks/memory_leak_brown.ts#L72-L80)

### Selecting the data as JSON using a JSON\* family format

```ts
const rows = await client.query({
  query: 'SELECT number FROM system.numbers LIMIT 5',
  format: 'JSONCompactEachRow',
})
const result = await rows.json()
// result is [['0'], ['1'], ['2'], ['3'], ['4']]
```

### Selecting the data as JSON including response metadata

```ts
const rows = await client.query({
  query: 'SELECT number FROM system.numbers LIMIT 2',
  format: 'JSON',
})
const result = await rows.json<ResponseJSON<{ number: string }>>()

/* result will look like

{
    "meta": [ { "name": "number", "type": "UInt64" } ],
    "data": [ { "number": "0"}, { "number": "1" } ],
    "rows": 2,
    "rows_before_limit_at_least": 2,
    "statistics": {
        "elapsed": 0.00013129,
        "rows_read": 2,
        "bytes_read": 16
    }
}

*/
```

### Selecting the data as text

```ts
const rows = await client.query({
  query: `SELECT number FROM system.numbers LIMIT 2`,
  format: 'CSV',
})
const result = await rows.text()
// result is now '0\n1\n'
```

### Selecting the data as a stream

```ts
const rows = await client.query({
  query: `SELECT * from ${tableName}`,
  format: 'JSONCompactEachRow',
})
for await (const row of rows.stream()) {
  const data = (row as Row).json()
  // ... your code processing the data here
}
```

### Query with parameter binding

```ts
const rows = await client.query({
  query: 'SELECT plus({val1: Int32}, {val2: Int32})',
  format: 'CSV',
  query_params: {
    val1: 10,
    val2: 20,
  },
})
const result = await rows.text()
// result is '30\n'
```

### Query with custom ClickHouse settings

```ts
await client.insert({
  table: tableName,
  values: [
    { id: 42, name: 'foo' },
    { id: 42, name: 'bar' },
  ],
  format: 'JSONEachRow',
  clickhouse_settings: { insert_quorum: '2' },
})
```

### Abort query

```ts
import { AbortController } from 'node-abort-controller'

const controller = new AbortController()
const selectPromise = client.query({
  query: 'SELECT sleep(3)',
  format: 'CSV',
  abort_signal: controller.signal as AbortSignal,
})
controller.abort()
// selectPromise is now rejected with "The request was aborted" message
```

## Known limitations

- Browser usage is not supported.
- There are no data mappers for the result sets, so only language primitives are used.
- There are some [Decimal* and Date* / DateTime\* data types caveats](#date--datetime-types-caveats).
- Nested data type is currently not officially supported.

## Tips for performance optimizations

- To reduce application memory consumption, consider using streams for large inserts when applicable.
- Node.js HTTP(s) Agent has infinite max open sockets by default. In some cases, you might want to limit that by using `ClickHouseClientConfigOptions.max_open_connections` setting.
- We have response (for example, select queries) compression enabled by default, but insert compression is disabled. When using large inserts, you might want to enable request compression as well. You can use `ClickHouseClientConfigOptions.compression.request` for that.

## Contributing

Check out our [contributing guide](./CONTRIBUTING.md).
