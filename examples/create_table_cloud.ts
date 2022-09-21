import { createClient } from '@clickhouse/client'

// ClickHouse cloud - a specific CREATE TABLE syntax is allowed
void (async () => {
  const client = createClient({
    host: process.env['CLICKHOUSE_HOST'],
    password: process.env['CLICKHOUSE_PASSWORD'],
  })
  // Note that ENGINE and ON CLUSTER clauses can be omitted entirely here.
  // ClickHouse cloud will automatically use ReplicatedMergeTree
  // with appropriate settings in this case.
  await client.exec({
    query: `
      CREATE TABLE IF NOT EXISTS clickhouse_js_example_cloud_table
      (id UInt64, name String)
      ORDER BY (id)
    `,
    // Recommended for cluster usage to avoid situations
    // where a query processing error occurred after the response code
    // and HTTP headers were sent to the client.
    // See https://clickhouse.com/docs/en/interfaces/http/#response-buffering
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
  })
  await client.close()
})()
