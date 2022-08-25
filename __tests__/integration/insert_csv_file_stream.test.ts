import { createTestClient, guid } from '../utils'
import type { ClickHouseClient } from '../../src'
import { createSimpleTable } from './fixtures/simple_table'
import Stream from 'stream'

describe('insert csv file stream', () => {
  let client: ClickHouseClient
  let tableName: string
  let stream: Stream.Readable

  beforeEach(async () => {
    tableName = `insert_csv_${guid()}`
    client = createTestClient()
    await createSimpleTable(client, tableName)
  })

  it('should insert a CSV without names or types', async () => {
    stream = Stream.Readable.from(`42,foo,"[1,2]"\n43,bar,"[3,4]"\n`, {
      objectMode: false,
    })
    await client.insert({
      table: tableName,
      values: stream,
      format: 'CSV',
    })
    await assertInsertedValues()
  })

  it('should insert a CSV with names', async () => {
    stream = Stream.Readable.from(
      `id,name,sku\n42,foo,"[1,2]"\n43,bar,"[3,4]"\n`,
      {
        objectMode: false,
      }
    )
    await client.insert({
      table: tableName,
      values: stream,
      format: 'CSVWithNames',
    })
    await assertInsertedValues()
  })

  it('should insert a CSV with names and types', async () => {
    stream = Stream.Readable.from(
      `id,name,sku\nUInt64,String,Array(UInt8)\n42,foo,"[1,2]"\n43,bar,"[3,4]"\n`,
      {
        objectMode: false,
      }
    )
    await client.insert({
      table: tableName,
      values: stream,
      format: 'CSVWithNamesAndTypes',
    })
    await assertInsertedValues()
  })

  it('should throw in case of invalid CSV format', async () => {
    stream = Stream.Readable.from(`foobar,42,,\n`, {
      objectMode: false,
    })
    await expect(
      client.insert({
        table: tableName,
        values: stream,
        format: 'CSV',
      })
    ).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringContaining('Cannot parse input'),
      })
    )
  })

  async function assertInsertedValues() {
    const result = await client.select({
      query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
      format: 'JSONEachRow',
    })
    expect(await result.json()).toEqual([
      { id: '42', name: 'foo', sku: [1, 2] },
      { id: '43', name: 'bar', sku: [3, 4] },
    ])
  }
})
