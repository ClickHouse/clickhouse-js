import { createClient } from '@clickhouse/client'
import { AbortController } from 'node-abort-controller'
void (async () => {
  const client = createClient()
  const controller = new AbortController()
  const selectPromise = client
    .query({
      query: 'SELECT sleep(3)',
      format: 'CSV',
      abort_signal: controller.signal as AbortSignal,
    })
    .catch((e) => {
      console.info('Select was aborted')
      console.info('This is the underlying error message')
      console.info('------------------------------------')
      console.error(e)
    })
  controller.abort()
  await selectPromise
  await client.close()
})()
