import { type ClickHouseClient, createClient } from '@clickhouse/client'

/**
 * If you execute a long-running query without data coming in from the client,
 * and your LB has idle connection timeout set to a value less than the query execution time,
 * there is a workaround to trigger ClickHouse to send progress HTTP headers and make LB think that the connection is alive.
 *
 * This is the combination of `send_progress_in_http_headers` + `http_headers_progress_interval_ms` settings.
 *
 * One of the symptoms of such LB timeout might be a "socket hang up" error when `request_timeout` runs off,
 * but in `system.query_log` the query is marked as completed with its execution time less than `request_timeout`.
 *
 * In this example we wait for the entire time of the query execution.
 * This is susceptible to transient network errors.
 * See `long_running_queries_cancel_request.ts` for a more "safe", but more hacky approach.
 *
 * @see https://clickhouse.com/docs/en/operations/settings/settings#send_progress_in_http_headers
 * @see https://clickhouse.com/docs/en/interfaces/http
 */
const tableName = 'long_running_queries_progress_headers'
const client = createClient({
  /* Here we assume that:

   --- We need to execute a long-running query that will not send any data from the client
       aside from the statement itself, and will not receive any data from the server during the progress.
       An example of such statement will be INSERT FROM SELECT; the client will get the response only when it's done;
   --- There is an LB with 120s idle timeout; a safe value for `http_headers_progress_interval_ms` could be 110 or 115s;
   --- We estimate that the query will be completed in 300 to 350s at most;
       so we choose the safe value of `request_timeout` as 400s.

  Of course, the exact settings values will depend on your infrastructure configuration. */
  request_timeout: 400_000,
  clickhouse_settings: {
    // Ask ClickHouse to periodically send query execution progress in HTTP headers, creating some activity in the connection.
    // 1 here is a boolean value (true).
    send_progress_in_http_headers: 1,
    // The interval of sending these progress headers. Here it is less than 120s,
    // which in this example is assumed to be the LB idle connection timeout.
    // As it is UInt64 (UInt64 max value > Number.MAX_SAFE_INTEGER), it should be passed as a string.
    http_headers_progress_interval_ms: '110000',
  },
})
await createTestTable(client, tableName)

// Assuming that this is our long-long running insert,
// it should not fail because of LB and the client settings described above.
await client.command({
  query: `
    INSERT INTO ${tableName}
    SELECT '42', 'foobar'
  `,
})
const rows = await client.query({
  query: `SELECT * FROM ${tableName}`,
  format: 'JSONEachRow',
})
console.info('Inserted data:', await rows.json())
await client.close()

async function createTestTable(client: ClickHouseClient, tableName: string) {
  try {
    await client.command({
      query: `
        CREATE OR REPLACE TABLE ${tableName}
        (id String, data String)
        ENGINE MergeTree()
        ORDER BY (id)
      `,
    })
  } catch (err) {
    console.error(`Error while creating the table ${tableName}:`, err)
    await client.close()
    process.exit(1)
  }
}
