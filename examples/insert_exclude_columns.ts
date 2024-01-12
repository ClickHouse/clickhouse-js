import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

void (async () => {
  const tableName = 'insert_exclude_columns'
  const client = createClient()

  await client.command({
    query: `
      CREATE OR REPLACE TABLE ${tableName}
      (id UInt32, message String)
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })

  /**
   * Explicitly specifying a list of columns to insert the data into
   */
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

  /**
   * Alternatively, it is possible to exclude certain columns instead
   */
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
})()
