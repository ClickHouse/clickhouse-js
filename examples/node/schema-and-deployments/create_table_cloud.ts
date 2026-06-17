import { createClient } from "@clickhouse/client";

const url = process.env["CLICKHOUSE_CLOUD_URL"];
const password = process.env["CLICKHOUSE_CLOUD_PASSWORD"];

// This example targets ClickHouse Cloud and requires credentials. When they are
// not provided (e.g. CI runs without cloud secrets, such as Dependabot PRs),
// skip the example instead of failing so the rest of the examples still run.
if (!url || !password) {
  console.warn(
    "Skipping create_table_cloud example: set CLICKHOUSE_CLOUD_URL and " +
      "CLICKHOUSE_CLOUD_PASSWORD to run it against ClickHouse Cloud.",
  );
} else {
  const client = createClient({
    url,
    password,
  });
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
  });
  await client.close();
}
