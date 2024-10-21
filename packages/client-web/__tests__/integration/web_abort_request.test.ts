import type { Row } from '@clickhouse/client-common'
import { createTestClient } from '@test/utils'
import type { WebClickHouseClient } from '../../src/client'

fdescribe('[Web] abort request', () => {
  let client: WebClickHouseClient

  beforeEach(() => {
    client = createTestClient() as unknown as WebClickHouseClient
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
    let rowCount = 0
    const selectPromise = client
      .query({
        query: 'SELECT number FROM system.numbers LIMIT 1000',
        format: 'JSONCompactEachRow',
        abort_signal: controller.signal,
        clickhouse_settings: {
          // low block size to force streaming 1 row at a time
          max_block_size: '1',
        },
      })
      .then(async (rs) => {
        const reader = rs.stream().getReader()
        while (true) {
          const { done, value: rows } = await reader.read()
          if (done) break
          ;(rows as Row[]).forEach(() => {
            if (rowCount >= 1) {
              controller.abort()
            }
            rowCount++
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
    let rowCount = 0
    const selectPromise = client
      .query({
        query: 'SELECT number FROM system.numbers LIMIT 3',
        format: 'JSONCompactEachRow',
        clickhouse_settings: {
          // low block size to force streaming 1 row at a time
          max_block_size: '1',
        },
      })
      .then(async function (rs) {
        const reader = rs.stream().getReader()
        while (true) {
          const { done, value: rows } = await reader.read()
          if (done) break
          for (const row of rows as Row[]) {
            row.json()
            if (rowCount >= 1) {
              await rs.stream().cancel()
            }
            rowCount++
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
