import { createClient } from '@clickhouse/client'
void (async () => {
  const tableName = 'array_json_each_row'
  const client = createClient()
  await client.exec({
    query: `DROP TABLE IF EXISTS ${tableName}`,
  })
  await client.exec({
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
})()
