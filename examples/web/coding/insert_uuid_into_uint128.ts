import { createClient } from '@clickhouse/client-web'

function assertEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`)
  }
}

// ClickHouse converts UUID values into UInt128 implicitly only for the `VALUES`
// clause. With row-oriented input formats such as `JSONEachRow`, sending a UUID
// string like "019982cb-3abf-7e12-9668-c788a9e3639c" for a `UInt128` column
// fails with `CANNOT_PARSE_INPUT_ASSERTION_FAILED`. This example shows two
// supported patterns for the JSON formats used by the client.
//
// Pattern 1 — convert the UUID to its 128-bit numeric representation on the
// client and send it as a decimal string (recommended; JS `number` cannot hold
// 128 bits without precision loss, so always pass UInt128 as a string).
//
// Pattern 2 — declare the UUID column as `EPHEMERAL` and let ClickHouse
// populate the `UInt128` column via `DEFAULT`. See also:
// https://clickhouse.com/docs/en/sql-reference/statements/create/table#ephemeral

function uuidToUInt128(uuid: string): string {
  // 8-4-4-4-12 hex digits → 32 hex digits → BigInt → decimal string
  return BigInt('0x' + uuid.replace(/-/g, '')).toString()
}

const client = createClient()

const uuid = '019982cb-3abf-7e12-9668-c788a9e3639c'
const expectedUInt128 = uuidToUInt128(uuid)

// ---- Pattern 1: client-side UUID → UInt128 conversion ----
const tableName = 'insert_uuid_into_uint128_example_web'
await client.command({
  query: `
    CREATE OR REPLACE TABLE ${tableName}
    (
      id          UInt128,
      description String
    )
    ENGINE MergeTree()
    ORDER BY (id)
  `,
})
await client.insert({
  table: tableName,
  values: [
    {
      id: expectedUInt128,
      description: 'converted from UUID on the client',
    },
  ],
  format: 'JSONEachRow',
})
const converted = await client.query({
  // UInt128 values are returned as decimal strings (too wide for a JS number).
  query: `SELECT toString(id) AS id_uint128, description
          FROM ${tableName}`,
  format: 'JSONEachRow',
})
const convertedRows = await converted.json<{
  id_uint128: string
  description: string
}>()
console.info('Pattern 1 (client-side conversion):', convertedRows)
// Round-trip assertion: the value SELECTed back must equal the BigInt-derived
// UInt128 we sent, proving the server parsed the JSON input correctly.
assertEqual(
  convertedRows[0].id_uint128,
  expectedUInt128,
  'Pattern 1 round-trip',
)

// ---- Pattern 2: EPHEMERAL UUID column with UInt128 DEFAULT ----
const ephemeralTableName = 'insert_uuid_into_uint128_ephemeral_example_web'
await client.command({
  query: `
    CREATE OR REPLACE TABLE ${ephemeralTableName}
    (
      id          UInt128 DEFAULT id_uuid,
      id_uuid     UUID EPHEMERAL,
      description String
    )
    ENGINE MergeTree()
    ORDER BY (id)
  `,
})
await client.insert({
  table: ephemeralTableName,
  values: [
    {
      id_uuid: uuid,
      description: 'populated via EPHEMERAL UUID column',
    },
  ],
  format: 'JSONEachRow',
  // The ephemeral column must be listed explicitly so that the DEFAULT
  // expression on `id` is evaluated.
  columns: ['id_uuid', 'description'],
})
const ephemeral = await client.query({
  query: `SELECT toString(id) AS id_uint128, description
          FROM ${ephemeralTableName}`,
  format: 'JSONEachRow',
})
const ephemeralRows = await ephemeral.json<{
  id_uint128: string
  description: string
}>()
console.info('Pattern 2 (EPHEMERAL column):', ephemeralRows)
// Both patterns must produce the same UInt128 representation of the UUID.
assertEqual(
  ephemeralRows[0].id_uint128,
  expectedUInt128,
  'Pattern 2 round-trip',
)

await client.close()
