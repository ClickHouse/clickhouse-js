import { createClient } from '@clickhouse/client'
import { ClickHouseError } from '@clickhouse/client-common'
import { EventEmitter } from 'events'

// This example demonstrates how to use async inserts without waiting for an ack about a successfully written batch.
// Run it for some time and observe the number of rows sent and the number of rows written to the table.
// Suitable for ClickHouse Cloud, too. Can be used with either Node.js or Web versions of the client.
// A bit more advanced version of the `examples/async_insert.ts` example,
// as async inserts are an interesting option when working with event listeners
// that can receive an arbitrarily large or small amount of data at various times.
// See https://clickhouse.com/docs/en/optimize/asynchronous-inserts
void (async () => {
  const client = createClient({
    url: process.env['CLICKHOUSE_URL'], // defaults to 'http://localhost:8123'
    password: process.env['CLICKHOUSE_PASSWORD'], // defaults to an empty string
    max_open_connections: 10,
    clickhouse_settings: {
      // https://clickhouse.com/docs/en/operations/settings/settings#async_insert
      async_insert: 1,
      // https://clickhouse.com/docs/en/operations/settings/settings#wait_for_async_insert
      // explicitly disable it on the client side;
      // insert operations promises will be resolved as soon as the request itself was processed on the server.
      wait_for_async_insert: 0,
      // https://clickhouse.com/docs/en/operations/settings/settings#async_insert_max_data_size
      async_insert_max_data_size: '1000000',
      // https://clickhouse.com/docs/en/operations/settings/settings#async_insert_busy_timeout_max_ms
      async_insert_busy_timeout_max_ms: 1000,
    },
  })
  const tableName = 'async_insert_without_waiting'
  await client.command({
    query: `
      CREATE OR REPLACE TABLE ${tableName}
      (id Int32, name String)
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })

  interface Row {
    id: number
    name: string
  }

  // Assume we have an event listener in our application that periodically receives incoming data,
  // that we would like to have inserted into ClickHouse.
  // This emitter is just a simulation for the sake of this example.
  let rowsInserted = 0
  const listener = new EventEmitter()
  const asyncInsertOnData = async (rows: Row[]) => {
    const start = +new Date()
    // Each individual insert operation will be resolved as soon as the request itself was processed on the server.
    // The data will be batched on the server side. Insert will not wait for an ack about a successfully written batch.
    // This is the main difference from the `examples/async_insert.ts` example.
    try {
      await client.insert({
        table: tableName,
        values: rows,
        format: 'JSONEachRow',
      })
      rowsInserted += rows.length
      const elapsed = +new Date() - start
      console.log(`Insert ${rows.length} rows finished in ${elapsed} ms`)
    } catch (err) {
      // Depending on the error, it is possible that the request itself was not processed on the server.
      if (err instanceof ClickHouseError) {
        // You could decide what to do with a failed insert based on the error code.
        // An overview of possible error codes is available in the `system.errors` ClickHouse table.
        console.error(`ClickHouse error: ${err.code}. Insert failed:`, err)
        return
      }
      // You could implement a proper retry mechanism depending on your application needs;
      // for the sake of this example, we just log an error.
      console.error(`Insert failed:`, err)
    }
  }
  listener.on('data', asyncInsertOnData)

  // Periodically send a random amount of data to the listener, simulating a real application behavior.
  let rowsSent = 0
  let sendRowsHandle: ReturnType<typeof setTimeout>
  const sendRows = () => {
    const rowsCount = Math.floor(Math.random() * 100) + 1
    const rows = [...new Array(rowsCount)].map((_, i) => ({
      id: rowsSent + i,
      name: `Name ${rowsSent + i}`,
    }))
    rowsSent += rowsCount
    listener.emit('data', rows)
    // Send the data at a random interval up to 1000 ms.
    sendRowsHandle = setTimeout(sendRows, Math.floor(Math.random() * 900) + 100)
  }
  sendRows()

  // Periodically check the number of rows inserted so far.
  // Amount of inserted values will be almost always slightly behind due to async inserts.
  const rowsCountHandle = setInterval(async () => {
    try {
      const resultSet = await client.query({
        query: `SELECT count(*) AS count FROM ${tableName}`,
        format: 'JSONEachRow',
      })
      const [{ count }] = await resultSet.json<{ count: string }>()
      console.log(
        'Rows inserted so far:',
        `${rowsInserted};`,
        'written to the table:',
        count,
      )
    } catch (err) {
      console.error(
        'Failed to get the number of rows written to the table:',
        err,
      )
    }
  }, 1000)

  // When Ctrl+C is pressed - clean up and exit.
  async function gracefulShutdown() {
    clearInterval(sendRowsHandle)
    clearInterval(rowsCountHandle)
    listener.removeListener('data', asyncInsertOnData)
    await client.close()
    process.exit(0)
  }
  process.on('SIGINT', gracefulShutdown)
  process.on('SIGTERM', gracefulShutdown)
})()
