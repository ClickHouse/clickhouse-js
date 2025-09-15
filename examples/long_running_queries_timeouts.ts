import { type ClickHouseClient, createClient } from '@clickhouse/client' // or '@clickhouse/client-web'
import * as crypto from 'crypto'
import type { SetIntervalAsyncTimer } from 'set-interval-async'
import { clearIntervalAsync, setIntervalAsync } from 'set-interval-async'

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
 * An alternative, but more "hacky" approach will be to use an HTTP interface "feature",
 * where a cancelled mutation query will still continue to execute on the server.
 *
 * This example covers both approaches.
 *
 * @see https://clickhouse.com/docs/en/operations/settings/settings#send_progress_in_http_headers
 * @see https://clickhouse.com/docs/en/interfaces/http
 */
void (async () => {
  const tableName = 'insert_from_select'

  // ------------------------------------------------------------------------------------------------------------------
  // Example #1 - waiting for the entire time of the query execution.
  // This is susceptible to transient network errors.
  // See example #2 for a more "safe", but more hacky approach.
  // ------------------------------------------------------------------------------------------------------------------
  await (async () => {
    console.info('Running example #1')
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
    console.info('Example #1 - inserted data:', await rows.json())
    console.info('---------------------------------------------------')
    await client.close()
  })()

  // ------------------------------------------------------------------------------------------------------------------
  // Example #2 - cancelling the outgoing HTTP request, keeping the query running. This is a more "hacky" approach.
  // Unlike TCP/Native, mutations sent over HTTP are NOT cancelled on the server when the connection is interrupted.
  //
  // While this is hacky, it is also less prone to network errors, as we only periodically poll the query status,
  // instead of waiting on the other side of the connection for the entire time.
  //
  // Inspired by https://github.com/ClickHouse/clickhouse-js/issues/244 and the discussion in this issue.
  // See also: https://github.com/ClickHouse/ClickHouse/issues/49683 - once implemented, we will not need this hack.
  // ------------------------------------------------------------------------------------------------------------------
  await (async () => {
    console.info('Running example #2')
    const client = createClient({
      // we don't need any extra settings here.
    })
    await createTestTable(client, tableName)

    // Used to cancel the outgoing HTTP request (but not the query itself!).
    // See more on cancelling the HTTP requests in examples/abort_request.ts.
    const abortController = new AbortController()

    // IMPORTANT: you HAVE to generate the known query_id on the client side to be able to cancel the query later.
    const queryId = crypto.randomUUID()

    // Assuming that this is our long-long running insert.
    // IMPORTANT: do not wait for the promise to resolve yet.
    const commandPromise = longRunningInsert(client, {
      tableName,
      queryId,
      abortController,
    })

    // Waiting until the INSERT appears on the server in system.query_log.
    // Once it is there, we can safely cancel the outgoing HTTP request.
    const insertQueryExists = await pollOnInterval(
      'CheckQueryExists',
      () => checkQueryExists(client, queryId),
      {
        intervalMs: 100,
        maxPolls: 50,
      },
    )
    abortController.abort()
    await commandPromise

    if (!insertQueryExists) {
      // The query is still not received by the server after a reasonable amount of time.
      // We might assume that the query will not be executed. Handle this depending on your use case.
      console.error(
        'The query is not received by the server - assuming a failure.',
      )
      await client.close()
      process.exit(1)
    }

    // Waiting until the query is completed on the server.
    const isCompleted = await pollOnInterval(
      'CheckCompletedQuery',
      () => checkCompletedQuery(client, queryId),
      {
        maxPolls: 400,
        intervalMs: 1000, // assuming that our query max execution time is 400s
      },
    )

    if (isCompleted) {
      console.info('The query is completed.')
    } else {
      // Handle this depending on your use case - you could wait a bit more, or cancel the query on the server.
      // See examples/cancel_query.ts for the latter option.
      console.error(
        'The query is not completed after a reasonable amount of time.',
      )
      await client.close()
      process.exit(1)
    }

    // Check the inserted data.
    const rows = await client.query({
      query: `SELECT * FROM ${tableName}`,
      format: 'JSONEachRow',
    })
    console.info('Example #2 - inserted data:', await rows.json())
    await client.close()
    process.exit(0)
  })()
})()

async function longRunningInsert(
  client: ClickHouseClient,
  {
    abortController,
    queryId,
    tableName,
  }: {
    tableName: string
    queryId: string
    abortController: AbortController
  },
): Promise<void> {
  try {
    await client.command({
      query: `
        INSERT INTO ${tableName}
        SELECT toString(42 + inner.number), concat('foobar_', inner.number, '_', sleepEachRow(1))
        FROM (SELECT number FROM system.numbers LIMIT 3) AS inner
      `,
      abort_signal: abortController.signal,
      query_id: queryId,
    })
  } catch (err) {
    if (err instanceof Error && err.message.includes('abort')) {
      console.info(
        'The request was aborted, but the query is still running on the server.',
      )
    } else {
      console.error('Unexpected error:', err)
      await client.close()
      process.exit(1)
    }
  }
}

async function checkQueryExists(
  client: ClickHouseClient,
  queryId: string,
): Promise<boolean> {
  const resultSet = await client.query({
    query: `
      SELECT COUNT(*) > 0 AS exists
      FROM system.query_log
      WHERE query_id = '${queryId}'
    `,
    format: 'JSONEachRow',
  })
  const result = await resultSet.json<{ exists: 0 | 1 }>()
  console.log(`[Query ${queryId}] CheckQueryExists result:`, result)
  return result.length > 0 && result[0].exists !== 0
}

interface QueryLogInfo {
  type:
    | 'QueryStart'
    | 'QueryFinish'
    | 'ExceptionBeforeStart'
    | 'ExceptionWhileProcessing'
}

async function checkCompletedQuery(
  client: ClickHouseClient,
  queryId: string,
): Promise<boolean> {
  const resultSet = await client.query({
    query: `
      SELECT type
      FROM system.query_log
      WHERE query_id = '${queryId}' AND type != 'QueryStart'
      LIMIT 1
    `,
    format: 'JSONEachRow',
  })
  const result = await resultSet.json<QueryLogInfo>()
  console.log(`[Query ${queryId}] CheckCompletedQuery result:`, result)
  return result.length > 0 && result[0].type === 'QueryFinish'
}

async function pollOnInterval(
  op: string,
  fn: () => Promise<boolean>,
  {
    intervalMs,
    maxPolls,
  }: {
    intervalMs: number
    maxPolls: number
  },
): Promise<boolean> {
  let intervalId: SetIntervalAsyncTimer<[]> | undefined
  const result: boolean = await new Promise((resolve) => {
    let pollsCount = 1
    // See https://www.npmjs.com/package/set-interval-async#when-should-i-use-setintervalasync
    intervalId = setIntervalAsync(async () => {
      try {
        const success = await fn()
        console.log(`[${op}] Poll #${pollsCount}: ${success}`)
        if (success) {
          resolve(true)
        } else {
          if (pollsCount < maxPolls) {
            pollsCount++
            return
          }
          console.error(`[${op}] Max polls count reached!`)
          resolve(false)
        }
      } catch (err) {
        console.error(`[${op}] Error while polling:`, err)
        resolve(false)
      }
    }, intervalMs)
  })
  if (intervalId !== undefined) {
    await clearIntervalAsync(intervalId)
  }
  return result
}

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
