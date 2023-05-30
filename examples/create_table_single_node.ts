import { createClient } from '@clickhouse/client'

// A single ClickHouse node - for example, as in our `docker-compose.yml`
void (async () => {
  const client = createClient()
  await client.exec({
    query: `
      CREATE TABLE IF NOT EXISTS clickhouse_js_create_table_example
      (id UInt64, name String)
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })
  await client.close()
})()
