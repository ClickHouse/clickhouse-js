import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

// NB: currently, JS Date objects work only with DateTime* fields
void (async () => {
  const tableName = 'insert_js_date'
  const client = createClient()
  await client.command({
    query: `DROP TABLE IF EXISTS ${tableName}`,
  })
  await client.command({
    query: `
      CREATE TABLE ${tableName}
      (id String, dt DateTime64(3, 'UTC'))
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })
  await client.insert({
    table: tableName,
    values: [
      {
        id: '42',
        dt: new Date(),
      },
    ],
    clickhouse_settings: {
      // Allows to insert serialized JS Dates (such as '2023-12-06T10:54:48.000Z')
      date_time_input_format: 'best_effort',
    },
    format: 'JSONEachRow',
  })
  const rows = await client.query({
    query: `SELECT * FROM ${tableName}`,
    format: 'JSONEachRow',
  })
  console.info(await rows.json())
  await client.close()
})()
