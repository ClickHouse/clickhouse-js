import { createClient } from '@clickhouse/client'

// ClickHouse cluster - for example, as in our `docker-compose.cluster.yml`
void (async () => {
  const client = createClient()
  await client.exec({
    // See macro definitions in `.docker/clickhouse/cluster/serverN_config.xml`
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
