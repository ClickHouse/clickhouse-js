import type { ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient, guid } from '@test/utils'
import type Stream from 'stream'

fdescribe('[Node.js] stream RowBinary', () => {
  let client: ClickHouseClient<Stream.Readable>
  let tableName: string

  beforeEach(async () => {
    tableName = `insert_stream_row_binary_${guid()}`
    client = createTestClient()
    await client.command({
      query: `CREATE TABLE ${tableName} (i Int8, s String) ENGINE MergeTree ORDER BY (i)`,
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    })
    console.log(`Created table ${tableName}`)
    await client.insert({
      table: tableName,
      values: [
        { i: 42, s: 'foo' },
        { i: -5, s: 'bar' },
      ],
      format: 'JSONEachRow',
    })
  })
  afterEach(async () => {
    await client.close()
  })

  it('should stream stuff', async () => {
    const rs = await client.query({
      query: `SELECT * FROM ${tableName} ORDER BY i DESC`,
      format: 'RowBinaryWithNamesAndTypes',
    })
    const values: unknown[][] = []
    for await (const rows of rs.stream()) {
      rows.forEach((row: unknown[]) => {
        values.push(row)
      })
    }
    expect(values).toEqual([
      [42, 'foo'],
      [-5, 'bar'],
    ])
  })
})
