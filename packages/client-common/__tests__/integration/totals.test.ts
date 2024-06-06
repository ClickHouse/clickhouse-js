import type { ClickHouseClient } from '@clickhouse/client-common'
import { createSimpleTable } from '@test/fixtures/simple_table'
import { createTestClient, guid } from '@test/utils'

fdescribe('Queries with totals', () => {
  let client: ClickHouseClient
  let tableName: string

  beforeEach(async () => {
    client = createTestClient()
    tableName = `totals_test_${guid()}`
    await createSimpleTable(client, tableName)
  })
  afterEach(async () => {
    await client.close()
  })

  it('should return the expected totals', async () => {
    await client.insert({
      table: tableName,
      values: [
        { id: '42', name: 'hello', sku: [0, 1] },
        { id: '43', name: 'hello', sku: [2, 3] },
        { id: '44', name: 'foo', sku: [3, 4] },
        { id: '45', name: 'foo', sku: [4, 5] },
        { id: '46', name: 'foo', sku: [6, 7] },
      ],
      format: 'JSONEachRow',
    })

    const rs1 = await client.query({
      query: `SELECT *, count(*) AS count FROM ${tableName} GROUP BY id, name, sku WITH TOTALS ORDER BY id ASC`,
      format: 'JSON',
    })
    const result1 = await rs1.json()
    expect(result1.data).toEqual([
      { id: '42', name: 'hello', sku: [0, 1], count: '1' },
      { id: '43', name: 'hello', sku: [2, 3], count: '1' },
      { id: '44', name: 'foo', sku: [3, 4], count: '1' },
      { id: '45', name: 'foo', sku: [4, 5], count: '1' },
      { id: '46', name: 'foo', sku: [6, 7], count: '1' },
    ])
    expect(result1.totals).toEqual({
      id: '0',
      name: '',
      sku: [],
      count: '5',
    })

    const rs2 = await client.query({
      query: `SELECT name, count(*) AS count FROM ${tableName} GROUP BY name WITH TOTALS ORDER BY name ASC`,
      format: 'JSON',
    })
    const result2 = await rs2.json()
    expect(result2.data).toEqual([
      { name: 'foo', count: '3' },
      { name: 'hello', count: '2' },
    ])
    expect(result2.totals).toEqual({
      name: '',
      count: '5',
    })
  })
})
