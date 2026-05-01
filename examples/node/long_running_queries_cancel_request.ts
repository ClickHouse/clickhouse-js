import { type ClickHouseClient, createClient } from '@clickhouse/client'
import * as crypto from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * If you execute a long-running query without data coming in from the client,
 * and your LB has idle connection timeout set to a value less than the query execution time,
 * one approach (see `long_running_queries_progress_headers.ts`) is to enable progress HTTP headers.
 *
 * This example demonstrates an alternative, more "hacky" approach: cancelling the outgoing HTTP request,
 * keeping the query running on the server. Unlike TCP/Native, mutations sent over HTTP are NOT cancelled
 * on the server when the connection is interrupted.
 *
 * While this is hacky, it is also less prone to network errors, as we only periodically poll the query status,
 * instead of waiting on the other side of the connection for the entire time.
 *
 * Inspired by https://github.com/ClickHouse/clickhouse-js/issues/244 and the discussion in this issue.
 * See also: https://github.com/ClickHouse/ClickHouse/issues/49683 - once implemented, we will not need this hack.
 *
 * @see https://clickhouse.com/docs/en/interfaces/http
 */
const client = createClient({
  // we don't need any extra settings here.
})

const tableName = 'long_running_queries_cancel_request'
await client.command({
  query: `
        CREATE OR REPLACE TABLE ${tableName}
        (id String, data String)
        ENGINE MergeTree()
        ORDER BY (id)
      `,
})

// Used to cancel the outgoing HTTP request (but not the query itself!).
// See more on cancelling the HTTP requests in examples/abort_request.ts.
const abortController = new AbortController()

// IMPORTANT: you HAVE to generate the known query_id on the client side to be able to cancel the query later.
const queryId = crypto.randomUUID()

// Assuming that this is our long-long running insert.
// IMPORTANT: do not wait for the promise to resolve yet,
// otherwise we won't be able to cancel the request later.
const longRunningQueryPromise = client.command({
  query: `
        INSERT INTO ${tableName}
        SELECT toString(42 + inner.number), concat('foobar_', inner.number, '_', sleepEachRow(1))
        FROM (SELECT number FROM system.numbers LIMIT 3) AS inner
      `,
  abort_signal: abortController.signal,
  query_id: queryId,
})

// Waiting until the query appears on the server in `system.query_log`.
// Once it is there, we can safely cancel the outgoing HTTP request.
for (let attempts = 1; ; attempts++) {
  if (await getQueryLogQueryType(client, queryId)) {
    break
  }
  await sleep(1000)
  if (attempts >= 30) {
    throw new Error(
      'The query is not received by the server - assuming a failure.',
    )
  }
}

abortController.abort()

try {
  await longRunningQueryPromise
} catch (err) {
  if (err instanceof Error && err.message.includes('abort')) {
    console.info(
      'The request was aborted, but the query might still be running on the server.',
    )
  } else {
    console.error('Unexpected error occurred during long-running insert.')
    await client.close()
    throw err
  }
}

// Check the inserted data.
const rows = await client.query({
  query: `SELECT * FROM ${tableName}`,
  format: 'JSONEachRow',
})
console.info('Inserted data:', await rows.json())

await client.close()

interface QueryLogInfo {
  type:
    | 'QueryStart'
    | 'QueryFinish'
    | 'ExceptionBeforeStart'
    | 'ExceptionWhileProcessing'
}

async function getQueryLogQueryType(
  client: ClickHouseClient,
  queryId: string,
): Promise<QueryLogInfo['type'] | null> {
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
  if (result.length === 0) {
    return null
  }
  return result[0].type
}
