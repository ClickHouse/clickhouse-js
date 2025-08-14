import { createClient } from '@clickhouse/client'
import { ClickHouseError } from '@clickhouse/client-common' // or '@clickhouse/client-web'

// This example demonstrates how to use asynchronous inserts, avoiding client side batching of the incoming data.
// Suitable for ClickHouse Cloud, too. Can be used with either Node.js or Web versions of the client.
// See https://clickhouse.com/docs/en/optimize/asynchronous-inserts
void (async () => {
  const client = createClient({
    url: process.env['CLICKHOUSE_URL'], // defaults to 'http://localhost:8123'
    password: process.env['CLICKHOUSE_PASSWORD'], // defaults to an empty string
    max_open_connections: 10,
    clickhouse_settings: {
      // https://clickhouse.com/docs/en/operations/settings/settings#async-insert
      async_insert: 1,
      // https://clickhouse.com/docs/en/operations/settings/settings#wait-for-async-insert
      wait_for_async_insert: 1,
      // https://clickhouse.com/docs/en/operations/settings/settings#async-insert-max-data-size
      async_insert_max_data_size: '1000000',
      // https://clickhouse.com/docs/en/operations/settings/settings#async-insert-busy-timeout-ms
      async_insert_busy_timeout_ms: 1000,
    },
  })

  // Create the table if necessary
  const table = 'async_insert_example'
  await client.command({
    query: `
      CREATE OR REPLACE TABLE ${table}
      (id Int32, data String)
      ENGINE MergeTree
      ORDER BY id
    `,
    // Tell the server to send the response only when the DDL is fully executed.
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
  })

  const start = new Date()
  // Assume that we can receive multiple insert requests at the same time
  // (e.g. from parallel HTTP requests in your app or similar).
  const promises = [...new Array(10)].map(async () => {
    // Each of these smaller inserts could be merged into a single batch on the server side
    // (or more, depending on https://clickhouse.com/docs/en/operations/settings/settings#async-insert-max-data-size).
    // Since we set `async_insert=1`, application does not have to prepare a larger batch to optimize the insert performance.
    // In this example, and with this particular (rather small) data size, we expect the server to merge it into just a single batch.
    // As we set `wait_for_async_insert=1` as well, the insert promises will be resolved when the server sends an ack
    // about a successfully written batch. This will happen when either `async_insert_max_data_size` is exceeded,
    // or after `async_insert_busy_timeout_ms` milliseconds of "waiting" for new insert operations.
    const values = [...new Array(1000).keys()].map(() => ({
      id: Math.floor(Math.random() * 100_000) + 1,
      data: Math.random().toString(36).slice(2),
    }))
    await client
      .insert({
        table,
        values,
        format: 'JSONEachRow', // or other, depends on your data
      })
      .catch((err) => {
        // Depending on the error, it is possible that the request itself was not processed on the server.
        if (err instanceof ClickHouseError) {
          // You could decide what to do with a failed insert based on the error code.
          // An overview of possible error codes is available in the `system.errors` ClickHouse table.
          console.error(`ClickHouse error: ${err.code}. Insert failed:`, err)
          return
        }
        // You could implement a proper retry mechanism depending on your application needs;
        // for the sake of this example, we just log an error.
        console.error('Insert failed:', err)
      })
  })
  await Promise.all(promises)

  // In this example, it should take `async_insert_busy_timeout_ms` milliseconds or a bit more,
  // as the server will wait for more insert operations,
  // cause due to small amount of data its internal buffer was not exceeded.
  console.log('Inserts took', new Date().getTime() - start.getTime(), 'ms')

  const resultSet = await client.query({
    query: `SELECT count(*) AS count FROM ${table}`,
    format: 'JSONEachRow',
  })
  const [{ count }] = await resultSet.json<{ count: string }>()
  // It is expected to have 10k records in the table.
  console.info('Select count result:', count)
})()
