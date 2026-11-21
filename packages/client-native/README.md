# @clickhouse/client-native

A Node.js client for [ClickHouse](https://clickhouse.com/) that uses the
**native TCP protocol** (port 9000, or 9440 with TLS) instead of the HTTP
interface.

Use this client when the HTTP interface of your server is not available, for
example when a database access proxy forwards only the native port.

The client has the API of [`@clickhouse/client`](../client-node/README.md).
To change from the HTTP client, change the import and the URL:

```ts
import { createClient } from "@clickhouse/client-native";

const client = createClient({
  url: "tcp://localhost:9000", // or tcps://host:9440 for TLS
  username: "default",
  password: "",
});

const rs = await client.query({
  query: "SELECT number FROM system.numbers LIMIT {limit:UInt32}",
  query_params: { limit: 3 },
  format: "JSONEachRow",
});
console.log(await rs.json()); // [ { number: 0 }, { number: 1 }, { number: 2 } ]

await client.close();
```

> **Status:** experimental (0.x). `query`, `command`, `insert`, `exec`,
> `ping`, TLS and LZ4/ZSTD compression are available.

## Installation

```sh
npm i @clickhouse/client-native
```

Node.js 22 or later is necessary. The package has no runtime dependencies.

## Configuration

The client accepts the configuration of `@clickhouse/client`, with these
differences:

| Option            | Value                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`             | `tcp://[user:password@]host[:port][/database]` or `tcps://...`. Default: `tcp://localhost:9000`.                                             |
| `tls`             | `{ ca_cert }` or `{ ca_cert, cert, key }` (mutual TLS), for a `tcps://` URL.                                                                 |
| `connect_timeout` | The time for a new connection and its handshake, in milliseconds. Default: `10000`.                                                          |
| `request_timeout` | The maximum time without a packet from the server, in milliseconds. Default: `30000`. See below.                                             |
| `compression`     | `"none"` (default), `"lz4"`, `"zstd"`, `{ codec: "lz4" }`, or `{ codec: "zstd", level }`: compression of the data blocks in both directions. |

The client ignores the options that apply only to HTTP: `keep_alive`,
`http_headers`, `http_agent` and `set_basic_auth_header`.

`tcp://` sends database credentials in clear text. Use `tcps://` to encrypt
the connection. The native protocol sends the local operating system username
and hostname to the server as client metadata with each query.

### Compression

With `compression: "lz4"`, `"zstd"`, `{ codec: "lz4" }`, or
`{ codec: "zstd", level }`, the client compresses the blocks that it sends
(applying `level` to outgoing ZSTD blocks when set), and asks the server to
compress its blocks with the same method (with the
`network_compression_method` setting, if the user can change settings).
The client decompresses LZ4 and ZSTD blocks from the server in all cases.
`zstd` needs Node.js 22.15.0 or later. The checksums of the compressed blocks
are computed in WebAssembly. `zstd` uses the zstd of Node.js and gives smaller
data than `lz4`; which of the two is faster depends on the data. The client
sends compressed blocks of 1 MiB at most, as the server does.

## How it works

The server sends the result of a query in `Native` blocks. The client decodes
the blocks and writes the rows in the format that you ask for, for example
`JSONEachRow`. Thus `ResultSet.json()`, `text()` and `stream()` work as with
the HTTP client.

For `JSONEachRow` and the `JSONCompactEachRow` formats, the client can write
text directly from blocks with integers up to 64 bits, booleans and `String`
values of up to 127 bytes of valid UTF-8. It uses the column decoder for other
blocks.

`json()` gives the values that `JSON.parse` gives for that text. For the
`JSON`, `JSONCompact`, `JSONEachRow` and `JSONCompactEachRow[WithNames...]`
formats, the client makes these values from the blocks and does not write
and parse the text. With your own `json.parse` function in the configuration,
the client gives the text to your function.

The integration tests compare the output of supported formats with the HTTP
interface. Query statistics and progress rows come from the native protocol.
The client reads output settings from `system.settings` per server identity
(cached with a 5-minute TTL) and applies overrides from `clickhouse_settings`
and from a top-level SQL `SETTINGS` clause.
For example, set `output_format_write_statistics = 0` on the query that returns
JSON. A separate `SET` statement or a subquery can leave the client using its
initial output settings. If the user cannot read `system.settings` (for
example, a settings profile with `max_result_rows` below the number of
settings), the client logs a warning and uses the defaults of a recent server
instead of the user's settings profile.

A `String` can have bytes that are not UTF-8 (for example a hash). The client
keeps them: the stream of `exec()` and of the result set has the same bytes
as over HTTP.

The client writes the text of `DateTime` values with the time zone data of
Node.js. For most dates this is the data of the server. A new rule of a time
zone can be in one of the two and not in the other (for example
`Africa/Casablanca` after 2026); then the text of a `DateTime` in that zone
can differ from the HTTP interface. A time zone that Node.js does not know is
an error.

Set `session_timezone` in `clickhouse_settings` or in the top-level `SETTINGS`
clause of the query. A separate `SET session_timezone` changes the server's
session but can leave the client formatting results in the previous time zone.
The `iso` output format writes UTC timestamps.

These output settings are not supported, and the client ignores them:
`rows_before_aggregation` (the server sends this number only to clients of a
later protocol revision), and `output_format_json_array_of_rows` together
with `JSONEachRowWithProgress`. When the server sends a `JSON` column as text, the
line breaks of unusual mixed arrays in the `JSON` format can differ from the
HTTP interface.

### Supported formats

`JSON`, `JSONStrings`, `JSONCompact`, `JSONCompactStrings`,
`JSONColumnsWithMetadata`, `JSONObjectEachRow`, `JSONEachRow`,
`JSONStringsEachRow`, `JSONCompactEachRow`, `JSONCompactStringsEachRow`,
`JSONCompactEachRowWithNames`, `JSONCompactEachRowWithNamesAndTypes`,
`JSONCompactStringsEachRowWithNames`,
`JSONCompactStringsEachRowWithNamesAndTypes`, `JSONEachRowWithProgress`, `CSV`,
`CSVWithNames`, `CSVWithNamesAndTypes`, `TabSeparated`, `TabSeparatedRaw`,
`TabSeparatedWithNames` and `TabSeparatedWithNamesAndTypes`.

`Parquet` and the `CustomSeparated` formats are not supported for results.

### Inserts

`insert()` accepts the values of `@clickhouse/client`:

- The rows of the JSON formats (`JSONEachRow`, `JSONCompactEachRow`,
  `JSONCompactEachRowWithNames[AndTypes]`, `JSONStringsEachRow`,
  `JSONObjectEachRow`, `JSON`), as an array or an object-mode stream. The client
  encodes them as `Native` blocks with the column types that the server sends,
  and streams them in blocks of 16384 rows. A value that does not fit its column
  makes the insert fail with an error that names the value and the type.
  If you configure `json.stringify`, the client sends its output in the
  requested format for the server to parse.
- The data of the other formats (for example `CSV`, `TabSeparated`, `Parquet`)
  as a stream. The client sends the data after the SQL, and the server parses it.
  The client keeps all the data in memory.

The client follows the settings that the server uses to read JSON rows
(`input_format_defaults_for_omitted_fields`, `input_format_null_as_default`
and `input_format_skip_unknown_fields`; it reads their values from the server
and from the request):

- With `input_format_defaults_for_omitted_fields = 1` and no `columns`
  option, the client can name the columns that the rows have so the server
  fills omitted columns with their `DEFAULT` expressions. With `0`, omitted
  fields in the insert column list receive the default value of their type.
- A `Native` block cannot leave out the value of one row. When a row of a
  block leaves out a column with a `DEFAULT` expression, or has `null` for it,
  the client sends that block as JSON text, and the server applies the
  defaults.
- With `input_format_null_as_default = 1`, `null` for a column that is not
  `Nullable` and has no `DEFAULT` expression gives the default value of the
  type. The server parses `null` for an `Enum` column or when
  `input_format_null_as_default = 0`, because the behavior varies by release.
- With `input_format_skip_unknown_fields = 1` (the default of a recent
  server), the client does not send a field of a row that is not a column of
  the table. With `0`, such a field is an error.
- For the `JSONStrings` formats, the client does not parse the text of
  `Array`, `Map`, `Tuple`, `Variant`, `Dynamic` and `JSON` values. When the
  table has such columns, the client sends the rows as JSON text.

The client reads the values as the server reads JSON with its default
settings:

- Date and time values follow `date_time_input_format = 'best_effort'` (the
  default of a recent server). The server parses numeric `Date` and `Date32`
  values outside their day ranges using its version's input rules. A number
  for `DateTime64` is a count of seconds, and a number for `Time64` is a count
  of ticks of the column precision.
- The client rejects some values that the server accepts with a result that
  is not useful, for example the text `"1"` or `"0000-00-00 00:00:00"` for a
  `DateTime`.
- The server finds dates in the strings of a `Dynamic` column
  (`input_format_try_infer_dates`, `input_format_try_infer_datetimes`), with
  rules that the client does not copy. When a string of a `Dynamic` value can
  be a date (it has a digit and is not a number), the client sends that block
  and the next blocks as JSON text, and the server finds the types.

One `insert()` can run more than one `INSERT` statement: one for each
group of blocks with the same columns, and one for each block that goes as
JSON text. The first statement uses `query_id`, and statement _n_ uses
`<query_id>_<n>`. The insert is not atomic: after an
error, the rows of the statements before it stay in the table. With
`insert_deduplication_token`, the first statement that sends rows uses your
token, and statement _n_ uses `<token>_<n>`. The same rows in the same order
give the same statements, so a retry with the same token is still a
duplicate.

### exec

`exec()` takes the full SQL. The format of the result is the format of a
trailing `FORMAT` clause, or the `default_format` setting, or `TabSeparated`.
The formats are the formats of `query()`. With `values`, the client sends the
data after the SQL (for example `INSERT INTO t FORMAT CSV`).

Use the `format` option with `query()`. If the SQL specifies a different
format, `query()` rejects the request.

### Supported column types

All column types, except `AggregateFunction`, `QBit` and the deprecated
`Object('json')`: integers (up to 256 bits), floats, `BFloat16`, `Decimal*`,
`Bool`, `String`, `FixedString`, `Date`, `Date32`, `DateTime`, `DateTime64`,
`Time`, `Time64`, `UUID`, `IPv4`, `IPv6`, `Enum8`, `Enum16`, `Nullable`,
`LowCardinality` (also `LowCardinality(Nullable(T))`), `Array`, `Tuple`,
`Map`, `Nested`, `Variant`, `Dynamic`, `JSON`, `SimpleAggregateFunction`,
`Interval*` and the geo types.

## Differences from the HTTP client

- The client decodes the blocks in JavaScript. For a large result, `json()`
  can be faster than HTTP because the client can read rows directly from the
  decoded blocks. `text()` and `stream()` format the result in JavaScript.
  HTTP formats the result on the server. Relative performance depends on the
  format, column types, and result size.
- `query()` returns when the first rows arrive or the query ends.
  `JSONEachRowWithProgress` can return when the first progress row arrives.
  An error before `query()` returns rejects the promise. A later error fails
  the result stream. With `wait_end_of_query: 1` (or `http_wait_end_of_query: 1`),
  `query()` and `exec()` buffer until `EndOfStream` so `summary` is complete and
  mid-query errors reject the promise directly.
- `request_timeout` is the maximum time without a packet from the server. The
  server sends progress packets during a long query, so a long query does not
  time out.
- A statement with `command()` can be an `INSERT` with its data in the SQL
  (`INSERT ... VALUES`) or an `INSERT ... SELECT`.
- Each connection is a separate session. `session_id`, `role` and the
  authentication options of one request are not supported (client-level
  `session_id` and `role` are rejected at `createClient()`). JWT authentication
  is not supported.
- The server sends the rows of an async insert (`async_insert = 1`) without a
  row count. Then `written_rows` in the summary is the number of rows that the
  client sent.
- When you close a result set early, abort a request, or hit `request_timeout`,
  the client sends a native `Cancel` packet before closing that connection and
  opens a new one for the next request.
- `client.close()` closes active and idle connections and cancels pending
  handshakes. Aborting an insert also cancels a pending read from its input
  stream.
- A user with `readonly = 1` can use the client. The client then does not
  change the settings that select the simplest `Native` forms of `Dynamic` and
  `JSON` columns, and decodes their other forms.

## Performance

Relative performance between `@clickhouse/client-native` (TCP) and
`@clickhouse/client` (HTTP) depends on the workload:

- **Point queries and concurrent small lookups:** Persistent native TCP framing
  avoids per-request HTTP header overhead, cutting point-query latency and
  Node.js CPU by more than half.
- **Large `.json()` analytics reads (plain or compressed):** Building JS objects
  directly from decoded `Native` blocks with native LZ4 compression reaches
  3.9M–6.6M rows/s (~2.6–3.6x HTTP), cutting client CPU by 28–62% and JS
  allocations by 33–62%.
- **Streaming `.stream()` reads and early cancellation:** Lazy sub-block slicing
  in `BinaryJSONRows` and prototype-backed `Row` objects reach >10M rows/s
  (~2.17x HTTP) with 31% less CPU and 65% fewer JS allocations, and make early
  `ResultSet.close()` ~2.75x faster than HTTP.
- **Structured `insert()`:** Encoding JS rows into columnar `Native` blocks with
  LZ4 reaches 1.2M rows/s (~1.61x HTTP) with 19% less CPU and 67% fewer JS
  allocations than HTTP JSON + gzip, while raw `CSV` stream inserts run at
  parity with zero extra payload copies.
- **Binary-path `JSON` decoding:** Columnar `JSON` block decoding and direct JS
  object construction beat HTTP by ~37% even when
  `output_format_native_write_json_as_string = 0`.

Indicative results from [`benchmarks/native/`](../../benchmarks/native/README.md)
(macOS, Node.js `v26.13.1`, ClickHouse `26.10.1.1562`, loopback `127.0.0.1`,
`iterations=7`, `warmup=2`; reproduce on your own hardware before drawing
conclusions):

| Scenario                                                 | `@clickhouse/client` (HTTP) | `@clickhouse/client-native` (TCP) | Native vs HTTP | CPU/op (HTTP → Native) | JS Alloc/op (HTTP → Native) |
| -------------------------------------------------------- | --------------------------: | --------------------------------: | -------------: | ---------------------: | --------------------------: |
| Sequential `SELECT 1` (200 reqs)                         |       497.0 req/s (2.00 ms) |          **2.3k req/s (0.43 ms)** |      **4.59x** |   0.638 → **0.263 ms** |         93.1 → **57.6 KiB** |
| Concurrent pool (16×25 reqs)                             |                  5.7k req/s |                    **9.7k req/s** |      **1.69x** |   0.219 → **0.157 ms** |         75.9 → **46.7 KiB** |
| `JSONEachRow` `.json()` (100k rows)                      |                1.50M rows/s |                  **3.86M rows/s** |      **2.58x** |     68.7 → **49.2 ms** |         50.0 → **33.5 MiB** |
| `JSONEachRow` `.stream()` (200k rows, binary fast path)  |                4.85M rows/s |                 **10.54M rows/s** |      **2.17x** |     34.5 → **23.7 ms** |         63.1 → **22.2 MiB** |
| Compressed `.json()` (200k rows, LZ4 vs gzip)            |                1.83M rows/s |                  **6.58M rows/s** |      **3.60x** |    119.5 → **45.1 ms** |         91.1 → **35.0 MiB** |
| Structured `JSONEachRow` insert (100k rows, LZ4 vs gzip) |               745.1k rows/s |                  **1.20M rows/s** |      **1.61x** |     50.7 → **40.9 ms** |         21.5 → **7.12 MiB** |
| Raw CSV stream insert (1M rows, 24.3 MiB)                |                 159.3 MiB/s |                       157.6 MiB/s |          0.99x |     8.42 → **5.95 ms** |           698 → **243 KiB** |
| Complex types: `Tuple`/`Array`/`JSON`/TZ (50k rows)      |               279.6k rows/s |                 **355.6k rows/s** |      **1.27x** |     68.9 → **67.0 ms** |         **36.6** → 41.0 MiB |
| Binary `JSON` paths (50k rows, 8 keys/row)               |               194.2k rows/s |                 **266.4k rows/s** |      **1.37x** |     **37.6** → 45.8 ms |         **23.8** → 30.2 MiB |
| Early `ResultSet.close()` on 50M-row query + recovery    |        77.9 req/s (12.8 ms) |         **213.9 req/s (4.67 ms)** |      **2.75x** |     **4.37** → 10.3 ms |          **928** → 1016 KiB |

Run the suite locally against your own ClickHouse instance:

```sh
npm run build
NODE_OPTIONS="--expose-gc" npx tsx benchmarks/native/index.ts
```

## Development

```sh
docker compose up -d clickhouse clickhouse_tls
npm run test:native:unit
npm run test:native:integration
npm run test:native:integration:tls
npm run test:native:dist
npm run test:native:coverage
```

The integration tests compare the results with the results of the HTTP client
on the same server (`CLICKHOUSE_NATIVE_URL`, default `tcp://localhost:9000`, and
`CLICKHOUSE_HTTP_URL`, default `http://localhost:8123`). The TLS tests need
`127.0.0.1 server.clickhouseconnect.test` in `/etc/hosts`.
