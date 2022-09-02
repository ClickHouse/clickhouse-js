import type { ResponseJSON } from '../../src'
import { type ClickHouseClient } from '../../src'
import { createTestClient, guid } from '../utils'
import { createSimpleTable } from './fixtures/simple_table'

describe('insert', () => {
  let client: ClickHouseClient
  let tableName: string

  beforeEach(async () => {
    client = await createTestClient()
    tableName = `insert_test_${guid()}`
    await createSimpleTable(client, tableName)
  })
  afterEach(async () => {
    await client.close()
  })

  it('inserts values as an array in a table', async () => {
    const dataToInsert = [
      [42, 'hello', [0, 1]],
      [43, 'world', [3, 4]],
    ]
    await client.insert({
      table: tableName,
      values: dataToInsert,
    })

    const Rows = await client.select({
      query: `SELECT * FROM ${tableName}`,
      format: 'JSONEachRow',
    })

    const result = await Rows.json<ResponseJSON>()
    expect(result).toEqual([
      { id: '42', name: 'hello', sku: [0, 1] },
      { id: '43', name: 'world', sku: [3, 4] },
    ])
  })

  it('can insert strings with non-latin symbols', async () => {
    const dataToInsert = [
      [42, 'привет', [0, 1]],
      [43, 'мир', [3, 4]],
    ]
    await client.insert({
      table: tableName,
      values: dataToInsert,
    })

    const Rows = await client.select({
      query: `SELECT * FROM ${tableName}`,
      format: 'JSONEachRow',
    })

    const result = await Rows.json<ResponseJSON>()
    expect(result).toEqual([
      { id: '42', name: 'привет', sku: [0, 1] },
      { id: '43', name: 'мир', sku: [3, 4] },
    ])
  })

  it('can do multiple inserts simultaneously', async () => {
    const data = [
      { id: '42', name: 'hello', sku: [0, 1] },
      { id: '43', name: 'world', sku: [2, 3] },
      { id: '44', name: 'foo', sku: [3, 4] },
      { id: '45', name: 'bar', sku: [4, 5] },
      { id: '46', name: 'baz', sku: [6, 7] },
    ]
    await Promise.all(
      data.map((row) =>
        client.insert({
          values: [row],
          table: tableName,
          format: 'JSONEachRow',
        })
      )
    )
    expect(
      await client
        .select({
          query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
          format: 'JSONEachRow',
        })
        .then((r) => r.json())
    ).toEqual(data)
  })
})
