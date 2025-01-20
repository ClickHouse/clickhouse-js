import {
  ClickHouseError,
  type ClickHouseSettings,
} from '@clickhouse/client-common'
import { createTestClient } from '@test/utils'
import { StreamableDataFormat } from '../../src'
import { NodeClickHouseClient } from '../../src/client'

fdescribe('[Node.js] Errors during streaming', () => {
  let client: NodeClickHouseClient
  beforeAll(() => {
    client = createTestClient() as NodeClickHouseClient
  })
  afterAll(async () => {
    await client.close()
  })

  it('should work with CSV', async () => {
    let err: unknown
    let rowsCount = 0
    try {
      const rs = await runQuery('CSV')
      const stream = rs.stream()
      for await (const rows of stream) {
        rowsCount += rows.length
      }
    } catch (e) {
      err = e
    }
    assertStreamFailure(rowsCount, err)
  })

  fit('should work with JSONEachRow', async () => {
    let err: unknown
    let rowsCount = 0
    try {
      const rs = await runQuery('JSONEachRow', {
        http_write_exception_in_output_format: 0,
      })
      const stream = rs.stream()
      for await (const rows of stream) {
        for (const row of rows) {
          row.json() // should not produce SyntaxError
          rowsCount++
        }
      }
    } catch (e) {
      err = e
    }
    assertStreamFailure(rowsCount, err)
  })

  function runQuery<F extends StreamableDataFormat>(
    format: F,
    settings?: ClickHouseSettings,
  ) {
    return client.query({
      query: `
        SELECT
            number,
            if(number > 20, throwIf(1, 'Boom'), number) AS value
        FROM numbers(1000)
      `,
      format,
      clickhouse_settings: {
        // Forces CH to send more chunks of data (1 row each),
        // so that we get 200 OK + headers first instead of 500 ISE
        max_block_size: '1',
        ...(settings ?? {}),
      },
    })
  }

  function assertStreamFailure(rowsCount: number, err: unknown) {
    // rows count may vary, but the last row will always contain the error message
    expect(rowsCount).toBeGreaterThanOrEqual(10)
    expect(err).toBeInstanceOf(ClickHouseError)
    expect((err as ClickHouseError).code).toBe('395')
    expect((err as ClickHouseError).type).toBe(
      'FUNCTION_THROW_IF_VALUE_IS_NON_ZERO',
    )
  }
})
