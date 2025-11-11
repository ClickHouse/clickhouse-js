import { ClickHouseClient, ClickHouseError, ResultSet } from '../../src'
import Stream from 'stream'
import { createNodeTestClient } from '../utils/node_client'

// See https://github.com/ClickHouse/ClickHouse/pull/88818
describe('[Node.js] Stream error handling in 25.11+', () => {
  let client: ClickHouseClient

  beforeEach(async () => {
    client = createNodeTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  it('with promise listeners', async () => {
    let caughtError: ClickHouseError | null = null

    try {
      const rs = await queryWithStreamError(client)
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
    let caughtError: ClickHouseError | null = null

    try {
      const rs = await queryWithStreamError(client)
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

function queryWithStreamError(
  client: ClickHouseClient,
): Promise<ResultSet<'JSONEachRow'>> {
  return client.query({
    query: `SELECT toInt32(number) AS n,
                   throwIf(number = 10, 'boom') AS e
            FROM system.numbers LIMIT 10000000`,
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_block_size: '1',
      http_write_exception_in_output_format: false,
    },
  })
}

function assertError(err: Error | null) {
  expect(err).not.toBeNull()
  expect(err).toBeInstanceOf(ClickHouseError)

  const chErr = err as ClickHouseError
  expect(chErr.message).toContain(`boom: while executing 'FUNCTION throwIf`)
  expect(chErr.code).toBe('395')
}
