import {
  assertError,
  streamErrorQueryParams,
} from '@test/fixtures/stream_errors'
import { requireServerVersionAtLeast } from '@test/utils/jasmine'
import type { ClickHouseClient } from '../../src'
import type { ClickHouseError } from '../../src'
import { createNodeTestClient } from '../utils/node_client'

// See https://github.com/ClickHouse/ClickHouse/pull/88818
describe('[Node.js] Stream error handling', () => {
  let client: ClickHouseClient

  beforeEach(async () => {
    client = createNodeTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  it('with promise listeners', async () => {
    requireServerVersionAtLeast(25, 11)

    let caughtError: ClickHouseError | null = null

    try {
      const queryParams = streamErrorQueryParams()
      const rs = await client.query(queryParams)

      await new Promise<void>((resolve, reject) => {
        const stream = rs.stream<{ n: number }>()
        stream.on('data', (rows) => {
          for (const row of rows) {
            row.json() // ignored
          }
        })
        stream.on('error', (err) => {
          reject(err)
        })
        stream.on('end', () => {
          resolve()
        })
      })
    } catch (err) {
      caughtError = err as ClickHouseError
    }

    assertError(caughtError)
  })

  it('with async iterators', async () => {
    requireServerVersionAtLeast(25, 11)

    let caughtError: ClickHouseError | null = null

    try {
      const queryParams = streamErrorQueryParams()
      const rs = await client.query(queryParams)

      const stream = rs.stream()
      for await (const rows of stream) {
        for (const row of rows) {
          row.json() // ignored
        }
      }
    } catch (err) {
      caughtError = err as ClickHouseError
    }

    assertError(caughtError)
  })
})
