import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

/**
 * If you execute a long-running query without data coming in from the client,
 * and your LB has idle connection timeout lower than 300s (it is the default handled by the client under the hood),
 * there is a workaround to trigger ClickHouse to send progress HTTP headers
 * using `http_headers_progress_interval_ms` setting, which will keep the connection alive from the LB perspective.
 *
 * One of the symptoms of such LB timeout might be a "socket hang up" error when `request_timeout` runs off,
 * but in `system.query_log` the query is marked as completed with its execution time less than `request_timeout`.
 */
void (async () => {
  const tableName = 'insert_from_select'
  const client = createClient({
    /* Here we assume that:

     --- we need to execute a long-running query that will not send any data from the client aside from the statement itself,
         and will not receive any data from the server during the progress, such as INSERT FROM SELECT,
         as there will be an ack only when it's done;
     --- there is an LB with 120s idle timeout; a safe value for `http_headers_progress_interval_ms` then will be 110s;
     --- the query will take 300-350s to execute; so we choose as safe value of `request_timeout` as 400s.

    Of course, the settings values might be different for your particular network configuration */
    request_timeout: 400_000,
    clickhouse_settings: {
      http_headers_progress_interval_ms: '110000', // UInt64, should be passed as a string
    },
  })
  await client.command({
    query: `DROP TABLE IF EXISTS ${tableName}`,
  })
  await client.command({
    query: `
      CREATE TABLE ${tableName}
      (id String, data String)
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })
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
  console.info(await rows.json())
  await client.close()
})()
