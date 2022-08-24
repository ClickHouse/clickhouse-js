import { createFileStream, createTestClient, guid } from '../utils'
import type { ClickHouseClient } from '../../src'
import { createSimpleTable } from './fixtures/simple_table'

describe('insert csv file stream', () => {
  let client: ClickHouseClient
  let tableName: string

  beforeEach(async () => {
    tableName = `insert_csv_${guid()}`
    client = createTestClient()
    await createSimpleTable(client, tableName)
  })

  it('should insert a CSV without names or types', async () => {
    const stream = createFileStream('insert_csv_simple.csv')
    await client.insert({
      table: tableName,
      values: stream,
      format: 'CSV',
    })
    await assertInsertedValues()
  })

  it('should insert a CSV with names', async () => {
    const stream = createFileStream('insert_csv_with_names.csv')
    await client.insert({
      table: tableName,
      values: stream,
      format: 'CSVWithNames',
    })
    await assertInsertedValues()
  })

  it('should insert a CSV with names and types', async () => {
    const stream = createFileStream('insert_csv_with_names_and_types.csv')
    await client.insert({
      table: tableName,
      values: stream,
      format: 'CSVWithNamesAndTypes',
    })
    await assertInsertedValues()
  })

  it('should throw in case of invalid CSV format', async () => {
    const stream = createFileStream('insert_csv_invalid_format.csv')
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
