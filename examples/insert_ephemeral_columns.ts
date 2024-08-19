import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

// Ephemeral columns documentation: https://clickhouse.com/docs/en/sql-reference/statements/create/table#ephemeral
void (async () => {
  const tableName = 'insert_ephemeral_columns'
  const client = createClient({})

  await client.command({
    query: `
      CREATE OR REPLACE TABLE ${tableName}
      (
        id              UInt64,
        message         String DEFAULT message_default,
        message_default String EPHEMERAL
      )
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })

  await client.insert({
    table: tableName,
    values: [
      {
        id: '42',
        message_default: 'foo',
      },
      {
        id: '144',
        message_default: 'bar',
      },
    ],
    format: 'JSONEachRow',
    // The name of the ephemeral column has to be specified here
    // to trigger the default values logic for the rest of the columns
    columns: ['id', 'message_default'],
  })

  const rows = await client.query({
    query: `SELECT *
            FROM ${tableName}`,
    format: 'JSONEachRow',
  })

  console.info(await rows.json())
  await client.close()
})()
