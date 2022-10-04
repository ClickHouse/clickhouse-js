import { type ClickHouseClient, type ResponseJSON } from '../../src'
import { createTestClient, guid } from '../utils'
import { createSimpleTable } from './fixtures/simple_table'

describe('insert compression', () => {
  let client: ClickHouseClient
  let tableName: string
  beforeEach(async () => {
    client = await createTestClient({
      compression: {
        request: true,
      },
    })
    tableName = `insert_compression_test_${guid()}`
    await createSimpleTable(client, tableName)
  })

  afterEach(async () => {
    await client.close()
  })

  it('request compression', async () => {
    const dataToInsert = new Array(1_000).fill(0).map((v, idx) => {
      return [idx, `${idx + 5}`, [idx + 1, idx + 2]]
    })

    await client.insert({
      table: tableName,
      values: dataToInsert,
    })

    const rs = await client.query({
      query: `SELECT * FROM ${tableName}`,
      format: 'JSON',
    })

    const result = await rs.json<ResponseJSON>()
    expect(result.data.length).toBe(1_000)
  })
})
