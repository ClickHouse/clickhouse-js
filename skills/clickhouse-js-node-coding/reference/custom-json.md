# Custom JSON `parse` / `stringify`

> **Requires:** client `>= 1.14.0` (configurable `json.parse` and
> `json.stringify`). Earlier versions cannot swap the JSON implementation.

Backing example:
[`examples/node/coding/custom_json_handling.ts`](https://github.com/ClickHouse/clickhouse-js/blob/main/examples/node/coding/custom_json_handling.ts).

## Why customize?

The default `JSON.stringify` / `JSON.parse`:

- Throws on `BigInt`.
- Calls `Date.prototype.toJSON()` (ISO string) — fine for `DateTime` with
  `date_time_input_format: 'best_effort'`, surprising in some workflows.
- Loses precision for 64-bit integers returned as numbers (a separate
  issue — covered in the troubleshooting skill).

A custom `{ parse, stringify }` lets you plug in `JSONBig`,
`safe-stable-stringify`, your own `BigInt`-aware serializer, etc.

## Recipe: BigInt-safe stringify, custom Date handling

```ts
import { createClient } from '@clickhouse/client'

const valueSerializer = (value: unknown): unknown => {
  // Serialize Date as a UNIX millis number (instead of toJSON's ISO string)
  if (value instanceof Date) {
    return value.getTime()
  }

  // Serialize BigInt as a string so JSON.stringify won't throw
  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (Array.isArray(value)) {
    return value.map(valueSerializer)
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, valueSerializer(v)]),
    )
  }

  return value
}

const client = createClient({
  json: {
    parse: JSON.parse,
    stringify: (obj: unknown) => JSON.stringify(valueSerializer(obj)),
  },
})

await client.command({
  query: `
    CREATE OR REPLACE TABLE inserts_custom_json_handling
    (id UInt64, dt DateTime64(3, 'UTC'))
    ENGINE MergeTree
    ORDER BY id
  `,
})

await client.insert({
  table: 'inserts_custom_json_handling',
  format: 'JSONEachRow',
  values: [
    {
      id: BigInt(250000000000000200), // serialized as a string
      dt: new Date(), // serialized as ms since epoch
    },
  ],
})

const rows = await client.query({
  query: 'SELECT * FROM inserts_custom_json_handling',
  format: 'JSONEachRow',
})
console.info(await rows.json())
await client.close()
```

> The custom `valueSerializer` runs **before** `JSON.stringify`, so values
> are transformed before the standard hooks (`Date.prototype.toJSON`,
> object `toJSON()` methods, etc.) ever run.

## Recipe: BigInt-safe parsing for 64-bit integer columns

If you want `UInt64`/`Int64` to come back as `BigInt`s (instead of strings
or precision-lossy numbers), plug in a `BigInt`-aware parser such as
[`json-bigint`](https://www.npmjs.com/package/json-bigint):

```ts
import { createClient } from '@clickhouse/client'
import JSONBig from 'json-bigint'

const bigJson = JSONBig({ useNativeBigInt: true })

const client = createClient({
  json: {
    parse: bigJson.parse,
    stringify: bigJson.stringify,
  },
})
```

This applies to **both** outgoing JSON bodies and incoming JSON-format
responses. Combine with `output_format_json_quote_64bit_integers: 0` (the
default since CH 25.8) so the server emits unquoted 64-bit integers that
`json-bigint` can parse to `BigInt`.

## Common pitfalls

- **Setting `json.parse` only.** That only affects reading JSON responses;
  outgoing JSON bodies use `json.stringify`. If you want consistent custom
  handling in both directions, generally provide a matching `stringify` too.
- **Forgetting `bigint` handling in `stringify`.** Default `JSON.stringify`
  throws on `BigInt`; if your data ever contains one, the insert will fail
  with `TypeError: Do not know how to serialize a BigInt`.
- **Targeting client `< 1.14.0`.** The `json` option doesn't exist; you'll
  need to convert values manually before calling `insert()` / `query()` (or
  upgrade).
- **Casting 64-bit integers to `Number`.** JavaScript's `number` type has
  only 53 bits of mantissa — values above `Number.MAX_SAFE_INTEGER` (2^53 − 1)
  are silently rounded. Do **not** try to fix precision loss by calling
  `Number()`, `parseInt()`, or `parseFloat()` on the value. The correct fix
  is a `BigInt`-aware parser (shown above), not a lossy cast.
