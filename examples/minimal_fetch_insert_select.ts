/**
 * Minimal fetch client example: Insert and select
 *
 * This example demonstrates table creation, inserting data, and querying.
 * Equivalent to: examples/array_json_each_row.ts
 */

import { createClient } from './minimal_fetch_client'

const tableName = 'minimal_fetch_example'
const client = createClient()

// Drop table if exists
await client.command({
  query: `DROP TABLE IF EXISTS ${tableName}`,
})

// Create table
await client.command({
  query: `
    CREATE TABLE ${tableName}
    (id UInt64, name String)
    ENGINE MergeTree()
    ORDER BY (id)
  `,
})

// Insert data
await client.insert({
  table: tableName,
  values: [
    { id: 42, name: 'foo' },
    { id: 43, name: 'bar' },
  ],
  format: 'JSONEachRow',
})

// Query data
const rows = await client.query({
  query: `SELECT * FROM ${tableName}`,
  format: 'JSONEachRow',
})
console.info('Inserted and queried data:', rows)

await client.close()
