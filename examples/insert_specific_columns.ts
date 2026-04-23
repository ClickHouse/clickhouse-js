import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

/**
 * Explicitly specifying a list of columns to insert the data into.
 * For the inverse (excluding certain columns instead), see `insert_exclude_columns.ts`.
 */
const tableName = 'insert_specific_columns'
const client = createClient()

await client.command({
  query: `
    CREATE OR REPLACE TABLE ${tableName}
    (id UInt32, message String)
    ENGINE MergeTree()
    ORDER BY (id)
  `,
})

await client.insert({
  table: tableName,
  values: [{ message: 'foo' }],
  format: 'JSONEachRow',
  // `id` column value for this row will be zero
  columns: ['message'],
})

await client.insert({
  table: tableName,
  values: [{ id: 42 }],
  format: 'JSONEachRow',
  // `message` column value for this row will be an empty string
  columns: ['id'],
})

const rows = await client.query({
  query: `SELECT * FROM ${tableName} ORDER BY id, message DESC`,
  format: 'JSONEachRow',
})

console.info(await rows.json())
await client.close()
