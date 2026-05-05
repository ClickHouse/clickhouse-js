import { createClient } from '@clickhouse/client'

if (!process.env['CLICKHOUSE_CLOUD_URL']) {
  throw new Error('CLICKHOUSE_CLOUD_URL environment variable is not set')
}
if (!process.env['CLICKHOUSE_CLOUD_PASSWORD']) {
  throw new Error('CLICKHOUSE_CLOUD_PASSWORD environment variable is not set')
}

const client = createClient({
  url: process.env['CLICKHOUSE_CLOUD_URL'],
  password: process.env['CLICKHOUSE_CLOUD_PASSWORD'],
})
// Note that ENGINE and ON CLUSTER clauses can be omitted entirely here.
// ClickHouse cloud will automatically use ReplicatedMergeTree
// with appropriate settings in this case.
await client.command({
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
