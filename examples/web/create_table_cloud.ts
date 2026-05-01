import { createClient } from "@clickhouse/client-web";

// Replace the placeholders below with your ClickHouse Cloud connection details.
const CLICKHOUSE_URL = "https://<your-instance>.clickhouse.cloud:8443";
// The pasword is available during a service creation or can be later
// set in the Cloud Console: https://console.clickhouse.cloud/
const CLICKHOUSE_PASSWORD = "<your-clickhouse-cloud-password>";
// In a real browser application, you would typically inject non-secrets at build time
// (for example using Vite bundler env vars: https://vite.dev/guide/env-and-mode)
// const CLICKHOUSE_URL = import.meta.env.VITE_CLICKHOUSE_URL
// and read secrets from a runtime configuration object instead of hardcoding them:
// const CLICKHOUSE_PASSWORD = (await import('/you-app-config.json')).CLICKHOUSE_PASSWORD

const client = createClient({
  url: CLICKHOUSE_URL,
  password: CLICKHOUSE_PASSWORD,
});

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
});

await client.close();
