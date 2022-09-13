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

Official Node.js (14.x or 16.x) client for [ClickHouse](https://clickhouse.com/), written purely in TypeScript, thoroughly tested with ClickHouse 22.8 and upcoming 22.9.

It is focused on data streaming for both inserts and selects using standard [Node.js Streaming API](https://nodejs.org/api/stream.html).

As of now, HTTP(s) protocol is used under the hood, with [planned](https://github.com/ClickHouse/clickhouse-js/issues/25) Native protocol support.

## Connection

A very basic connection to a local ClickHouse instance with default settings (for example, if it is running as a Docker container):

```ts
const client = createClient()
```

Basic HTTPS connection:

```ts
const client = createClient({
  host: `https://<YOUR_CLICKHOUSE_HOST>:8443`,
  password: '<YOUR_CLICKHOUSE_PASSWORD>',
  database: '<YOUR_CLICKHOUSE_DATABASE>',
})
```

Using custom ClickHouse settings and forced HTTP compression (GZIP) for both request and response:

```ts
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

  // by default, Node.js HTTP(s) Agent has infinite max open sockets
  // it can be overriden with this setting
  max_open_connections?: number

  // HTTP compression settings
  compression?: {
    // enabled by default
    response?: boolean
    // disabled by default
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
    // enabled by default, can be disabled
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
| ------------------------------------------ | ------------- | -------------- | ------------- | ------------- |
| JSON                                       | ❌            | ❌             | ✔️            | ✔️            |
| JSONEachRow                                | ✔️            | ✔️             | ✔️            | ✔️            |
| JSONStringsEachRow                         | ✔️            | ✔️             | ✔️            | ✔️            |
| JSONCompactEachRow                         | ✔️            | ✔️             | ✔️            | ✔️            |
| JSONCompactStringsEachRow                  | ✔️            | ✔️             | ✔️            | ✔️            |
| JSONCompactEachRowWithNames                | ✔️            | ✔️             | ✔️            | ✔️            |
| JSONCompactEachRowWithNamesAndTypes        | ✔️            | ✔️             | ✔️            | ✔️            |
| JSONCompactStringsEachRowWithNames         | ✔️            | ✔️             | ✔️            | ✔️            |
| JSONCompactStringsEachRowWithNamesAndTypes | ✔️            | ✔️             | ✔️            | ✔️            |
| CSV                                        | ❌            | ✔️             | ❌            | ✔️            |
| CSVWithNames                               | ❌            | ✔️             | ❌            | ✔️            |
| CSVWithNamesAndTypes                       | ❌            | ✔️             | ❌            | ✔️            |
| TabSeparated                               | ❌            | ✔️             | ❌            | ✔️            |
| TabSeparatedRaw                            | ❌            | ✔️             | ❌            | ✔️            |
| TabSeparatedWithNames                      | ❌            | ✔️             | ❌            | ✔️            |
| TabSeparatedWithNamesAndTypes              | ❌            | ✔️             | ❌            | ✔️            |
| CustomSeparated                            | ❌            | ✔️             | ❌            | ✔️            |
| CustomSeparatedWithNames                   | ❌            | ✔️             | ❌            | ✔️            |
| CustomSeparatedWithNamesAndTypes           | ❌            | ✔️             | ❌            | ✔️            |

## Supported ClickHouse data types

| Type           | Status          |
| -------------- | --------------- |
| UInt\*         | ✔️              |
| Int\*          | ✔️              |
| Float\*        | ✔️              |
| Decimal\*      | ✔️❗- see below |
| Boolean        | ✔️              |
| String         | ✔️              |
| FixedString    | ✔️              |
| UUID           | ✔️              |
| Date\*         | ✔️❗- see below |
| DateTime\*     | ✔️❗- see below |
| Enum           | ✔️              |
| LowCardinality | ✔️              |
| Array          | ✔️              |
| JSON           | ✔️              |
| Nested         | ❌              |
| Tuple          | ✔️              |
| Nullable       | ✔️              |
| IPv4           | ✔️              |
| IPv6           | ✔️              |
| Geo            | ✔️              |
| Map            | ✔️              |

### Date* / DateTime* types caveats:

Since we use data streaming for inserts without the `VALUES` clause (which does additional type conversion), Date\* type columns can be only inserted as strings and not as Unix time epoch. It can be possibly changed with the future ClickHouse database releases. Please refer to the corresponding [integration tests](https://github.com/ClickHouse/clickhouse-js/blob/ba387d7f4ce375a60982ac2d99cb47391cf76cec/__tests__/integration/date_time.test.ts) for more examples.

### Decimal\* types caveats:

Since we do not use `VALUES` clause and there is no additional type conversion, it is not possible to insert Decimal* type columns as strings, only as numbers. This is a suboptimal approach as it might end in float precision loss. Thus, it is recommended to avoid JSON* formats when using Decimals as of now. Consider TabSeparated* / CSV* / CustomSeparated\* formats families for that kind of workflows. Please refer to the [data types tests](https://github.com/ClickHouse/clickhouse-js/blob/c1b70c82f525c39edb3ca1ee05cb5e6b43dba5b3/__tests__/integration/data_types.test.ts#L98-L131) for more concrete examples on how to avoid precision loss.

## Usage examples

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
for await (const row of rows.asStream()) {
  const data = row.json()
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
