import type { ResponseJSON } from '../../src'
import { type ClickHouseClient } from '../../src'
import { createTestClient, guid } from '../utils'
import { createSimpleTable } from './fixtures/simple_table'
import { assertJsonValues, jsonValues } from './fixtures/test_data'

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
    await client.insert({
      table: tableName,
      values: jsonValues,
      format: 'JSONEachRow',
    })
    await assertJsonValues(client, tableName)
  })

  it('can insert strings with non-ASCII symbols', async () => {
    const values = [
      { id: '42', name: '🅷🅴🅻🅻🅾', sku: [0, 1] },
      { id: '43', name: '🆆🅾🆁🅻🅳 ♥', sku: [3, 4] },
    ]
    await client.insert({
      table: tableName,
      values,
      format: 'JSONEachRow',
    })

    const Rows = await client.select({
      query: `SELECT * FROM ${tableName}`,
      format: 'JSONEachRow',
    })

    const result = await Rows.json<ResponseJSON>()
    expect(result).toEqual(values)
  })

  it('can do multiple inserts simultaneously', async () => {
    await Promise.all(
      jsonValues.map((row) =>
        client.insert({
          values: [row],
          table: tableName,
          format: 'JSONEachRow',
        })
      )
    )
    await assertJsonValues(client, tableName)
  })
})
