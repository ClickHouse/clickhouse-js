import { ClickHouseClient, ClickHouseError } from '../../src'
import Stream from 'stream'
import { createNodeTestClient } from '../utils/node_client'

fdescribe('[Node.js] Stream error handling', () => {
  let client: ClickHouseClient

  beforeEach(async () => {
    client = createNodeTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  it('should handle errors in the middle of a stream', async () => {
    let caughtError: Error | null = null

    try {
      const rs = await client.query({
        query: `SELECT toInt32(number) AS n, throwIf(number = 10, 'boom') AS e
              FROM system.numbers LIMIT 10000000`,
        format: 'JSONEachRow',
        clickhouse_settings: {
          max_block_size: '1',
          http_write_exception_in_output_format: false,
        },
      })

      console.log(rs.response_headers)

      await new Promise<void>((resolve, _reject) => {
        const stream = rs.stream<{ n: number }>()
        stream.on('data', (rows) => {
          console.log(rows)
          for (const row of rows) {
            row.json() // ignored
          }
        })
        stream.on('error', (err) => {
          caughtError = err
          resolve()
        })
        stream.on('end', () => {
          resolve()
        })
      })
    } catch (err) {
      caughtError = err as Error
    }

    expect(caughtError).not.toBeNull()
    const err = caughtError! as ClickHouseError

    expect(err.message).toContain(
      `DB::Exception: boom: while executing 'FUNCTION throwIf`,
    )
    expect(err.code).toBe('395')
  })
})
