import { type ClickHouseClient, type ResponseJSON } from '../../src'
import { createTestClient, guid } from '../utils'
import { createSimpleTable } from './fixtures/simple_table'

describe('insert compression', () => {
  let client: ClickHouseClient
  let tableName: string

  beforeEach(async () => {
    tableName = `insert_compression_test_${guid()}`
  })
  afterEach(async () => {
    await client.close()
  })

  const dataToInsert = new Array(1_000).fill(0).map((v, idx) => {
    return [idx, `${idx + 5}`, [idx + 1, idx + 2]]
  })

  it('uses gzip request compression', async () => {
    client = await createTestClient({
      compression: {
        request: true,
        response: false,
        encoding: 'gzip',
      },
    })
    await insertAndAssert()
  })

  it('uses lz4 request compression', async () => {
    client = await createTestClient({
      compression: {
        request: true,
        response: false,
        encoding: 'lz4',
      },
    })
    await insertAndAssert()
  })

  async function insertAndAssert() {
    await createSimpleTable(client, tableName)
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
  }
})
