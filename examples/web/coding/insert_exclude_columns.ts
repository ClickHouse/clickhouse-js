// Excluding certain columns from the INSERT statement.
// For the inverse (specifying the exact columns to insert into), see `insert_specific_columns.ts`.
import { createClient } from '@clickhouse/client-web'

const tableName = 'insert_exclude_columns_web'
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
  values: [{ message: 'bar' }],
  format: 'JSONEachRow',
  // `id` column value for this row will be zero
  columns: {
    except: ['id'],
  },
})

await client.insert({
  table: tableName,
  values: [{ id: 144 }],
  format: 'JSONEachRow',
  // `message` column value for this row will be an empty string
  columns: {
    except: ['message'],
  },
})

const rows = await client.query({
  query: `SELECT * FROM ${tableName} ORDER BY id, message DESC`,
  format: 'JSONEachRow',
})

console.info(await rows.json())
await client.close()
