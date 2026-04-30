import { createClient } from '@clickhouse/client-web'

// Replace the placeholders below with your ClickHouse Cloud connection details.
// In a real browser application, you would typically inject these at build time
// or read them from a runtime configuration object instead of hardcoding them.
const CLICKHOUSE_URL = 'https://<your-clickhouse-cloud-hostname>:8443'
const CLICKHOUSE_PASSWORD = '<your-clickhouse-cloud-password>'

if (
  CLICKHOUSE_URL.includes('<your-') ||
  CLICKHOUSE_PASSWORD.includes('<your-')
) {
  throw new Error(
    'Please set CLICKHOUSE_URL and CLICKHOUSE_PASSWORD in this example before running it.',
  )
}

const client = createClient({
  url: CLICKHOUSE_URL,
  password: CLICKHOUSE_PASSWORD,
})
// Note that ENGINE and ON CLUSTER clauses can be omitted entirely here.
// ClickHouse cloud will automatically use ReplicatedMergeTree
// with appropriate settings in this case.
await client.command({
  query: `
    CREATE TABLE IF NOT EXISTS clickhouse_js_example_cloud_table_web
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
