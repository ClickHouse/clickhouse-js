import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

void (async () => {
  const dbName = 'clickhouse_js_examples'
  const tableName = `test_table_${Math.random().toString(36).slice(2, 8)}`
  const client = createClient({
    database: 'system',
  })

  await client.command({
    query: `CREATE DATABASE IF NOT EXISTS ${dbName}`,
  })

  // Including the database here, as the client is created for "system"
  const fullTableName = `${dbName}.${tableName}`

  await client.command({
    query: `
      CREATE OR REPLACE TABLE ${fullTableName}
      (id UInt32, message String)
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })
  console.info(`Created table ${fullTableName}`)

  await client.insert({
    table: fullTableName,
    values: [{ id: 42, message: 'foo' }],
    format: 'JSONEachRow',
  })

  const rows = await client.query({
    query: `SELECT * FROM ${fullTableName} ORDER BY id, message DESC`,
    format: 'JSONEachRow',
  })

  console.info('Result:', await rows.json())
  await client.close()
})()
