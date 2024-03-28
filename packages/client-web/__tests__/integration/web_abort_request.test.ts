import type { ClickHouseClient, Row } from '@clickhouse/client-common'
import { createTestClient } from '@test/utils'

describe('[Web] abort request streaming', () => {
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
        query: 'SELECT * from system.numbers LIMIT 100000',
        format: 'JSONCompactEachRow',
        abort_signal: controller.signal,
        clickhouse_settings: {
          cancel_http_readonly_queries_on_client_close: 1,
        },
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
        clickhouse_settings: {
          cancel_http_readonly_queries_on_client_close: 1,
        },
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
