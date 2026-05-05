# Insert Data Formats

> **Applies to:** all versions. The `JSON` type column / new JSON family is a
> ClickHouse feature; the JSON _formats_ listed here are universally supported
> by the client.

Backing examples:
[`examples/node/coding/array_json_each_row.ts`](https://github.com/ClickHouse/clickhouse-js/blob/main/examples/node/coding/array_json_each_row.ts),
[`examples/node/coding/insert_data_formats_overview.ts`](https://github.com/ClickHouse/clickhouse-js/blob/main/examples/node/coding/insert_data_formats_overview.ts).

> **Raw / binary formats (CSV, TSV, CustomSeparated, Parquet) require a Node
> stream as input.** Those belong to the `clickhouse-js-node-performance`
> skill — defer if the user wants to insert from a file or `Readable`.

## Default choice: `JSONEachRow` with an array of objects

This is the right answer for ~90% of inserts.

```ts
import { createClient } from '@clickhouse/client'

const client = createClient()

await client.insert({
  table: 'events',
  format: 'JSONEachRow',
  values: [
    { id: 42, name: 'foo' },
    { id: 43, name: 'bar' },
  ],
})

await client.close()
```

The shape of `values` must match the chosen format.

## Streamable JSON formats (pass an array)

| Format                                       | `values` shape                                      |
| -------------------------------------------- | --------------------------------------------------- |
| `JSONEachRow`                                | `Array<{ col: value, ... }>`                        |
| `JSONStringsEachRow`                         | `Array<{ col: stringifiedValue, ... }>`             |
| `JSONCompactEachRow`                         | `Array<[v1, v2, ...]>`                              |
| `JSONCompactStringsEachRow`                  | `Array<[stringV1, stringV2, ...]>`                  |
| `JSONCompactEachRowWithNames`                | First row = column names, then data rows            |
| `JSONCompactEachRowWithNamesAndTypes`        | Row 1 = names, row 2 = types, then data             |
| `JSONCompactStringsEachRowWithNames`         | First row = names, then stringified data rows       |
| `JSONCompactStringsEachRowWithNamesAndTypes` | Row 1 = names, row 2 = types, then stringified data |

```ts
await client.insert({
  table: 'events',
  format: 'JSONCompactEachRowWithNamesAndTypes',
  values: [
    ['id', 'name', 'sku'],
    ['UInt32', 'String', 'Array(UInt32)'],
    [11, 'foo', [1, 2, 3]],
    [12, 'bar', [4, 5, 6]],
  ],
})
```

These formats can be **streamed** — pass a Node stream of rows instead of an
array. See the performance skill for streaming guidance.

## Single-document JSON formats (pass an object)

These cannot be streamed — the entire body is sent in one shot.

| Format                    | `values` shape (typed via `InputJSON<T>` / `InputJSONObjectEachRow<T>`)                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `JSON`                    | `{ meta: [], data: Array<{ col: value, ... }> }` — for TypeScript/client usage, pass `meta: []` if metadata is not needed |
| `JSONCompact`             | `{ meta: [{ name, type }, ...], data: Array<[v1, v2, ...]> }`                                                       |
| `JSONColumnsWithMetadata` | `{ meta: [...], data: { col1: [v, ...], col2: [v, ...] } }`                                                         |
| `JSONObjectEachRow`       | `Record<string, { col: value, ... }>` (the record key labels each row but is not stored)                            |

```ts
import type { InputJSON, InputJSONObjectEachRow } from '@clickhouse/client'

const meta: InputJSON['meta'] = [
  { name: 'id', type: 'UInt32' },
  { name: 'name', type: 'String' },
]

await client.insert({
  table: 'events',
  format: 'JSONCompact',
  values: {
    meta,
    data: [
      [19, 'foo'],
      [20, 'bar'],
    ],
  },
})

await client.insert({
  table: 'events',
  format: 'JSONObjectEachRow',
  values: {
    row_1: { id: 23, name: 'foo' },
    row_2: { id: 24, name: 'bar' },
  } satisfies InputJSONObjectEachRow<{ id: number; name: string }>,
})
```

## Quick chooser

| Use case                                     | Format                                       |
| -------------------------------------------- | -------------------------------------------- |
| Insert plain JS objects                      | `JSONEachRow` _(default)_                    |
| Insert tuples / column-positional rows       | `JSONCompactEachRow`                         |
| Insert with explicit column ordering / types | `JSONCompactEachRow*WithNames…`              |
| Insert a single document with metadata       | `JSON`, `JSONCompact`                        |
| Insert from a CSV / TSV / Parquet file       | Raw format + Node stream → performance skill |

## Common pitfalls

- **Wrong shape for the format.** The most common cause of insert failures —
  e.g., passing `Array<{...}>` to `JSONCompact` (which expects
  `{ meta, data }`).
- **Don't wrap a `JSONEachRow` array in a `{ data: [...] }` envelope.** That
  envelope only belongs to single-document formats (`JSON` / `JSONCompact` /
  `JSONColumnsWithMetadata`).
- For type guidance (`Decimal` strings, `Date` objects, `BigInt`), see
  `insert-values.md` and `custom-json.md`.
