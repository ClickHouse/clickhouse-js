import type { ClickHouseClient } from '@clickhouse/client-common'
import { createSimpleTable } from '@test/fixtures/simple_table'
import { createTestClient } from '../utils/client.node'
import { guid } from '@test/utils'
import Stream from 'stream'

const CLIENTS_COUNT = 5

describe('[Node.js] multiple clients', () => {
  const clients: ClickHouseClient[] = Array(CLIENTS_COUNT)

  beforeEach(() => {
    for (let i = 0; i < CLIENTS_COUNT; i++) {
      clients[i] = createTestClient()
    }
  })

  afterEach(async () => {
    for (const c of clients) {
      await c.close()
    }
  })

  const names = ['foo', 'bar', 'baz', 'qaz', 'qux']

  function getValue(i: number) {
    return {
      id: i,
      name: names[i],
      sku: [i, i + 1],
    }
  }

  const expected = [
    { id: '0', name: 'foo', sku: [0, 1] },
    { id: '1', name: 'bar', sku: [1, 2] },
    { id: '2', name: 'baz', sku: [2, 3] },
    { id: '3', name: 'qaz', sku: [3, 4] },
    { id: '4', name: 'qux', sku: [4, 5] },
  ]

  it('should be able to send parallel inserts (streams)', async () => {
    const id = guid()
    const tableName = `multiple_clients_insert_streams_test__${id}`
    await createSimpleTable(clients[0], tableName)
    await Promise.all(
      clients.map((client, i) =>
        client.insert({
          table: tableName,
          values: Stream.Readable.from([getValue(i)]),
          format: 'JSONEachRow',
        }),
      ),
    )
    const result = await clients[0].query({
      query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
      format: 'JSONEachRow',
    })
    expect(await result.json()).toEqual(expected)
  })
})
