import { createClient, ClickHouseError } from '@clickhouse/client' // or '@clickhouse/client-web'
import * as crypto from 'crypto' // Node.js only

/**
 * An example of cancelling a long-running query on the server side.
 * See https://clickhouse.com/docs/en/sql-reference/statements/kill
 */
void (async () => {
  const client = createClient()
  const query_id = crypto.randomUUID()

  // Assuming a long-running query on the server. This promise is not awaited.
  const selectPromise = client
    .query({
      query: 'SELECT * FROM system.numbers', // it will never end, unless it is cancelled.
      format: 'JSONEachRow',
      query_id, // required in this case; should be unique.
    })
    .catch((err: unknown) => {
      // An overview of possible error codes is available in the `system.errors` ClickHouse table.
      // In this example, the expected error code is 394 (QUERY_WAS_CANCELLED).
      if (err instanceof ClickHouseError && err.code === '394') {
        console.error('Got an expected ClickHouse error:', err)
      } else {
        console.error('Unexpected error', err)
      }
    })

  // Similarly, a mutation can be cancelled.
  // See also: https://clickhouse.com/docs/en/sql-reference/statements/kill#kill-mutation
  await client.command({
    query: `KILL QUERY WHERE query_id = '${query_id}'`,
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
  })

  // select promise will be rejected and print the error message
  await selectPromise
  await client.close()
})()
