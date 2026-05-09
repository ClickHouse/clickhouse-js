import { createClient } from '@clickhouse/client'

// Inserting and selecting an array of JS objects using the `JSONEachRow` format.
// This is the most common shape for app code: pass `values` as `Array<Record<string, unknown>>`
// where each object's keys match the table's column names.
const tableName = 'array_json_each_row'
const client = createClient()
await client.command({
  query: `DROP TABLE IF EXISTS ${tableName}`,
})
await client.command({
  query: `
    CREATE TABLE ${tableName}
    (id UInt64, name String)
    ENGINE MergeTree()
    ORDER BY (id)
  `,
})
await client.insert({
  table: tableName,
  // structure should match the desired format, JSONEachRow in this example
  values: [
    { id: 42, name: 'foo' },
    { id: 42, name: 'bar' },
  ],
  format: 'JSONEachRow',
})
const rows = await client.query({
  query: `SELECT * FROM ${tableName}`,
  format: 'JSONEachRow',
})
console.info(await rows.json())
await client.close()
