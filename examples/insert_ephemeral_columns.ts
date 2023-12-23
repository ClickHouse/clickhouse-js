import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

// Ephemeral columns documentation: https://clickhouse.com/docs/en/sql-reference/statements/create/table#ephemeral
// This example is inspired by https://github.com/ClickHouse/clickhouse-js/issues/217
void (async () => {
  const tableName = 'insert_ephemeral_columns'
  const client = createClient({
    clickhouse_settings: {
      allow_experimental_object_type: 1, // allows JSON type usage
    },
  })

  await client.command({
    query: `DROP TABLE IF EXISTS ${tableName}`,
  })
  await client.command({
    query: `
      CREATE TABLE ${tableName}
      (
        event_type  LowCardinality(String) DEFAULT JSONExtractString(message_raw, 'type'),
        repo_name   LowCardinality(String) DEFAULT JSONExtractString(message_raw, 'repo', 'name'),
        message     JSON                   DEFAULT message_raw,
        message_raw String                 EPHEMERAL
      )
      ENGINE MergeTree()
      ORDER BY (event_type, repo_name)
    `,
  })

  await client.insert({
    table: tableName,
    values: [
      {
        message_raw: {
          type: 'MyEventType',
          repo: {
            name: 'foo',
          },
        },
      },
      {
        message_raw: {
          type: 'SomeOtherType',
          repo: {
            name: 'bar',
          },
        },
      },
    ],
    format: 'JSONEachRow',
    // The name of the ephemeral column has to be specified here
    // to trigger the default values logic for the rest of the columns
    columns: ['message_raw'],
  })

  const rows = await client.query({
    query: `SELECT * FROM ${tableName}`,
    format: 'JSONCompactEachRowWithNames',
  })

  console.info(await rows.text())
  await client.close()
})()
