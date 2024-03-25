import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

/**
 * Cancelling a request in progress. By default, this does not cancel the query on the server, only the request itself.
 * If the query was received and processed by the server already, it will continue to execute.
 * However, cancellation of read-only (and only these) queries when the request is aborted can be achieved
 * by enabling `cancel_http_readonly_queries_on_client_close` setting.
 * This might be useful for a long-running SELECT queries.
 *
 * NB: regardless of `cancel_http_readonly_queries_on_client_close`,
 * if the request was received and processed by the server,
 * non-read-only queries (such as INSERT) will continue to execute anyway.
 *
 * For query cancellation, see `cancel_query.ts` example.
 */
void (async () => {
  const client = createClient({
    clickhouse_settings: {
      // See https://clickhouse.com/docs/en/operations/settings/settings#cancel-http-readonly-queries-on-client-close
      cancel_http_readonly_queries_on_client_close: 1,
    },
  })
  const controller = new AbortController()
  const selectPromise = client
    .query({
      query: 'SELECT sleep(3)',
      format: 'CSV',
      abort_signal: controller.signal,
    })
    .catch((e: unknown) => {
      console.error(e)
      console.info('---------------------------------------------------')
      console.info('Select was aborted, see above for the error details')
    })
  controller.abort()
  await selectPromise
  await client.close()
})()
