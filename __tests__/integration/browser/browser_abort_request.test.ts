import type { ClickHouseClient, Row } from '@clickhouse/client-common'
import { createTestClient } from '../../utils'

describe('Browser abort request streaming', () => {
  let client: ClickHouseClient<ReadableStream>

  beforeEach(() => {
    client = createTestClient()
  })

  afterEach(async () => {
    await client.close()
  })

  it('cancels a select query while reading response', async () => {
    const controller = new AbortController()
    const selectPromise = client
      .query({
        query: 'SELECT * from system.numbers',
        format: 'JSONCompactEachRow',
        abort_controller: controller,
      })
      .then(async (rs) => {
        const reader = rs.stream().getReader()
        while (true) {
          const { done, value: rows } = await reader.read()
          if (done) break
          ;(rows as Row[]).forEach((row: Row) => {
            const [[number]] = row.json<[[string]]>()
            // abort when reach number 3
            if (number === '3') {
              controller.abort()
            }
          })
        }
      })

    await expectAsync(selectPromise).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringContaining('The user aborted a request'),
      })
    )
  })

  it('cancels a select query while reading response by closing response stream', async () => {
    const selectPromise = client
      .query({
        query: 'SELECT * from system.numbers',
        format: 'JSONCompactEachRow',
      })
      .then(async function (rs) {
        const reader = rs.stream().getReader()
        while (true) {
          const { done, value: rows } = await reader.read()
          if (done) break
          for (const row of rows as Row[]) {
            const [[number]] = row.json<[[string]]>()
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
      })
    )
  })
})
