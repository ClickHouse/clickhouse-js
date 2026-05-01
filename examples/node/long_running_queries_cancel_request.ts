import { type ClickHouseClient, createClient } from '@clickhouse/client'
import * as crypto from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * Node.js-only example (uses Node's `crypto` module to generate a query_id).
 *
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
const tableName = 'long_running_queries_cancel_request'
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
    // 20s of headroom: in CI, system.query_log is shared with many
    // concurrently-running example processes, so the QueryStart entry can take
    // noticeably longer to appear than the 1s flush interval suggests.
    maxPolls: 200,
  },
)
abortController.abort()
await commandPromise

if (!insertQueryExists) {
  // The query is still not received by the server after a reasonable amount of time.
  // We might assume that the query will not be executed. Handle this depending on your use case.
  console.error('The query is not received by the server - assuming a failure.')
  await client.close()
  process.exit(1)
}

// Waiting until the query is completed on the server.
const isCompleted = await pollOnInterval(
  'CheckCompletedQuery',
  () => checkCompletedQuery(client, queryId),
  {
    maxPolls: 60, // Set to 400+ for a production-like timeout
    intervalMs: 1000, // assuming that our query max execution time is 400s
  },
)

if (isCompleted) {
  console.info('The query is completed.')
} else {
  // Handle this depending on your use case - you could wait a bit more, or cancel the query on the server.
  // See examples/cancel_query.ts for the latter option.
  console.error('The query is not completed after a reasonable amount of time.')
  await client.close()
  process.exit(1)
}

// Check the inserted data.
const rows = await client.query({
  query: `SELECT * FROM ${tableName}`,
  format: 'JSONEachRow',
})
console.info('Inserted data:', await rows.json())
await client.close()
process.exit(0)

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
        'The request was aborted, but the query might still be running on the server.',
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
  // Sequential polling loop: never overlap calls to `fn`, and wait `intervalMs`
  // between attempts. This is the equivalent of `set-interval-async` for the
  // simple "poll until success or max attempts" use case.
  for (let pollsCount = 1; pollsCount <= maxPolls; pollsCount++) {
    try {
      const success = await fn()
      console.log(`[${op}] Poll #${pollsCount}: ${success}`)
      if (success) return true
    } catch (err) {
      console.error(`[${op}] Error while polling:`, err)
      return false
    }
    if (pollsCount < maxPolls) await sleep(intervalMs)
  }
  console.error(`[${op}] Max polls count reached!`)
  return false
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
