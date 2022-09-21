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
    .catch((e) => console.error('Select was aborted', e))
  controller.abort()
  await selectPromise
  await client.close()
})()
