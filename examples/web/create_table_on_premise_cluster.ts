import { createClient } from '@clickhouse/client-web'

if (typeof CLICKHOUSE_CLUSTER_URL === 'undefined') {
  console.info('Skipping: CLICKHOUSE_CLUSTER_URL is not set')
  throw new Error('CLICKHOUSE_CLUSTER_URL environment variable is required')
}

// ClickHouse cluster - for example, as defined in our `docker-compose.yml`
// (services `clickhouse1`/`clickhouse2` behind the `nginx` round-robin entrypoint on port 8127).
const client = createClient({
  url: CLICKHOUSE_CLUSTER_URL,
})

await client.command({
  // Sample macro definitions are located in `.docker/clickhouse/cluster/serverN_config.xml`
  query: `
    CREATE TABLE IF NOT EXISTS clickhouse_js_examples_local_cluster_table
    ON CLUSTER '{cluster}'
    (id UInt64, name String)
    ENGINE ReplicatedMergeTree(
      '/clickhouse/{cluster}/tables/{database}/{table}/{shard}',
      '{replica}'
    )
    ORDER BY (id)
  `,
  // Recommended for cluster usage.
  // By default, a query processing error might occur after the HTTP response was sent to the client.
  // See https://clickhouse.com/docs/en/interfaces/http/#response-buffering
  clickhouse_settings: {
    wait_end_of_query: 1,
  },
})

await client.close()
