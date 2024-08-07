import type { ClickHouseClient, Row } from '@clickhouse/client-common'
import { createTestClient } from '@test/utils'

describe('[Web] abort request', () => {
  let client: ClickHouseClient<ReadableStream>

  beforeEach(() => {
    client = createTestClient()
  })

  afterEach(async () => {
    await client.close()
  })

  // a slightly different assertion vs the same Node.js test
  it('cancels a select query before it is sent', async () => {
    const controller = new AbortController()
    const selectPromise = client.query({
      query: 'SELECT sleep(3)',
      format: 'CSV',
      abort_signal: controller.signal,
    })
    controller.abort()

    await expectAsync(selectPromise).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringMatching('The user aborted a request'),
      }),
    )
  })

  it('cancels a select query while reading response', async () => {
    const controller = new AbortController()
    const selectPromise = client
      .query({
        query: 'SELECT * from system.numbers LIMIT 100000',
        format: 'JSONCompactEachRow',
        abort_signal: controller.signal,
      })
      .then(async (rs) => {
        const reader = rs.stream().getReader()
        while (true) {
          const { done, value: rows } = await reader.read()
          if (done) break
          ;(rows as Row[]).forEach((row: Row) => {
            const [number] = row.json<[string]>()
            // abort when reach number 3
            if (number === '3') {
              controller.abort()
            }
          })
        }
      })

    await expectAsync(selectPromise).toBeRejectedWith(
      jasmine.objectContaining({
        // Chrome = The user aborted a request; FF = The operation was aborted
        message: jasmine.stringContaining('aborted'),
      }),
    )
  })

  it('cancels a select query while reading response by closing response stream', async () => {
    const selectPromise = client
      .query({
        query: 'SELECT * from system.numbers LIMIT 100000',
        format: 'JSONCompactEachRow',
      })
      .then(async function (rs) {
        const reader = rs.stream().getReader()
        while (true) {
          const { done, value: rows } = await reader.read()
          if (done) break
          for (const row of rows as Row[]) {
            const [number] = row.json<[string]>()
            // abort when reach number 3
            if (number === '3') {
              await reader.releaseLock()
              await rs.close()
            }
          }
        }
      })
    await expectAsync(selectPromise).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringContaining('Stream has been already consumed'),
      }),
    )
  })
})
