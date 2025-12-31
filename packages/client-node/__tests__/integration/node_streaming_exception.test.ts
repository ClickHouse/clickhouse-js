import type { Row } from '@clickhouse/client-common'
import type Stream from 'stream'
import { type ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient } from '@test/utils'

describe('[Node.js] streaming exception', () => {
  it('should not trigger on a valid \\r\\n in the stream', async () => {
    const client: ClickHouseClient<Stream.Readable> = createTestClient({
      clickhouse_settings: {
        output_format_csv_crlf_end_of_line: 1,
        http_write_exception_in_output_format: 0,
      },
    })

    const rs = await client.query({
      query: 'SELECT number, number + 1 FROM system.numbers_mt LIMIT 2',
      format: 'CSV',
    })

    const rows = []
    for await (const chunk of rs.stream()) {
      rows.push(...chunk.map((r: Row) => r.text))
    }

    await client.close()
    expect(rows).toEqual(['0,1\r', '1,2\r'])
  })

  it('should trigger on a valid exception', async () => {
    const client: ClickHouseClient<Stream.Readable> = createTestClient({
      clickhouse_settings: {
        output_format_csv_crlf_end_of_line: 1,
        http_write_exception_in_output_format: 0,
        // to force smaller chunks
        http_response_buffer_size: '2',
        max_block_size: '1',
      },
    })

    const rs = await client.query({
      query: `SELECT number, throwIf(number = 500, 'valid exception 2') FROM system.numbers LIMIT 100000`,
      format: 'CSV',
    })

    const rows = []
    let err: unknown = null
    try {
      for await (const chunk of rs.stream()) {
        rows.push(...chunk.map((r: Row) => r.text))
      }
    } catch (e) {
      err = e
    }

    await client.close()

    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/valid exception 2/)
    // CH executes the query in parallel and can return 90-something rows before the exception
    // so to be sure we got some rows before the error, we check for > 50
    expect(rows.length).toBeGreaterThan(50)
  })
})
