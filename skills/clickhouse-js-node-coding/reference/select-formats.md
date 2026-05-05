# Select Data Formats

> **Applies to:** all versions. `JSONEachRowWithProgress` requires client
> `>= 1.7.0` (covered in the performance skill).

Backing examples:
[`examples/node/coding/select_json_each_row.ts`](https://github.com/ClickHouse/clickhouse-js/blob/main/examples/node/coding/select_json_each_row.ts),
[`examples/node/coding/select_data_formats_overview.ts`](https://github.com/ClickHouse/clickhouse-js/blob/main/examples/node/coding/select_data_formats_overview.ts),
[`examples/node/coding/select_json_with_metadata.ts`](https://github.com/ClickHouse/clickhouse-js/blob/main/examples/node/coding/select_json_with_metadata.ts).

## Default choice: `JSONEachRow` → `.json<T>()`

Right answer for ~90% of selects when the result fits in memory.

```ts
import { createClient } from '@clickhouse/client'

interface Row {
  number: string
}

const client = createClient()
const rows = await client.query({
  query: 'SELECT number FROM system.numbers LIMIT 5',
  format: 'JSONEachRow',
})
const result = await rows.json<Row>() // Row[]
result.forEach((r) => console.log(r))
await client.close()
```

`UInt64`/`Int64` and other 64-bit integers come back as **strings** by
default to avoid JS precision loss; see the troubleshooting skill for the
ways to change that.

## Single-document `JSON` format with metadata

Use `JSON` (or `JSONCompact`) when you need ClickHouse's response envelope
(rows + meta + statistics + row count). Type the result with
`ResponseJSON<T>`:

```ts
import { createClient, type ResponseJSON } from '@clickhouse/client'

const client = createClient()
const rows = await client.query({
  query: 'SELECT number FROM system.numbers LIMIT 2',
  format: 'JSON',
})
const result = await rows.json<ResponseJSON<{ number: string }>>()
console.info(result.meta, result.data, result.rows, result.statistics)
await client.close()
```

> `JSON`, `JSONCompact`, `JSONStrings`, `JSONCompactStrings`,
> `JSONColumnsWithMetadata`, `JSONObjectEachRow` are **single-document**
> formats — they cannot be streamed. Use a `*EachRow` variant if you want
> to stream.

## Selecting raw text (CSV / TSV / CustomSeparated)

Use `.text()` (not `.json()`) for raw textual formats:

```ts
const rs = await client.query({
  query: 'SELECT number, number * 2 AS doubled FROM system.numbers LIMIT 3',
  format: 'CSVWithNames',
})
console.log(await rs.text())
```

Streaming raw text/Parquet line-by-line belongs to the performance skill.

## Format chooser

| Use case                                                 | Format                                             |
| -------------------------------------------------------- | -------------------------------------------------- |
| Read rows as JS objects                                  | `JSONEachRow` _(default)_                          |
| Read rows as positional tuples (smaller payload)         | `JSONCompactEachRow`                               |
| Need `meta` / `statistics` / `rows` envelope             | `JSON` or `JSONCompact` + `ResponseJSON<T>`        |
| Read all values as strings (avoid number-precision loss) | `JSONStringsEachRow` / `JSONCompactStringsEachRow` |
| Stream very large result                                 | `JSONEachRow` / `JSONCompactEachRow` (perf skill)  |
| Export to CSV/TSV/Parquet                                | `CSV*`, `TabSeparated*`, `Parquet` (perf skill)    |

## ResultSet methods

| Method               | Returns                                          | Notes                                                                         |
| -------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `await rs.json<T>()` | `T[]` for `*EachRow`, single-doc shape otherwise | Buffers the full response                                                     |
| `await rs.text()`    | `string`                                         | Buffers the full response — for textual formats only (CSV/TSV/etc.)           |
| `rs.stream()`        | Node `Readable` of `Row[]` chunks                | Use for large results or binary formats such as Parquet — see the performance skill |
| `await rs.close()`   | `void`                                           | Always call if you obtained `stream()` and stop reading early                 |

## Common pitfalls

- **Calling `.json()` on a `JSON` (single-doc) result and expecting an
  array.** You get a `ResponseJSON<T>` object; the rows are under
  `.data`. Use `JSONEachRow` if you want a flat array.
- **Leaving a `stream()` half-consumed.** This is a top cause of
  `ECONNRESET` on the _next_ request — fully iterate the stream or call
  `await resultSet.close()`. (Diagnosis details live in the
  troubleshooting skill.)
- **Reaching for `.json()` on a CSV/TSV result.** Use `.text()` (or
  `.stream()` for large results).
