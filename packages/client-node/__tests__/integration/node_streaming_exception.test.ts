import { createClient } from '../../src'

describe('[Node.js] streaming exception', () => {
  it('should not trigger on a valid \\r\\n in the stream', async () => {
    const client = createClient({
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
      rows.push(...chunk.map((r) => r.text))
    }

    await client.close()
    expect(rows).toEqual(['0,1\r', '1,2\r'])
  })
})
