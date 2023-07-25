import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

void (async () => {
  const client = createClient()
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
