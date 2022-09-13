import type { ClickHouseClient } from '../../src'
import { createSimpleTable } from './fixtures/simple_table'
import { createTestClient, guid } from '../utils'
import Stream from 'stream'

const CLIENTS_COUNT = 5

describe('multiple clients', () => {
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

  it('should send multiple parallel selects', async () => {
    type Res = Array<{ sum: number }>
    const results: number[] = []
    await Promise.all(
      clients.map((client, i) =>
        client
          .query({
            query: `SELECT toInt32(sum(*)) AS sum FROM numbers(0, ${i + 2});`,
            format: 'JSONEachRow',
          })
          .then((r) => r.json<Res>())
          .then((json: Res) => results.push(json[0].sum))
      )
    )
    expect(results.sort((a, b) => a - b)).toEqual([1, 3, 6, 10, 15])
  })

  it('should be able to send parallel DDLs', async () => {
    const id = guid()
    const tableName = (i: number) => `multiple_clients_ddl_test__${id}__${i}`
    await Promise.all(
      clients.map((client, i) => createSimpleTable(client, tableName(i)))
    )
    for (let i = 0; i < CLIENTS_COUNT; i++) {
      const result = await clients[i].query({
        query: `EXISTS ${tableName(i)}`,
        format: 'TabSeparated',
      })
      expect(await result.text()).toEqual('1\n')
    }
  })

  describe('insert', () => {
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

    it('should be able to send parallel inserts (arrays)', async () => {
      const id = guid()
      const tableName = `multiple_clients_insert_arrays_test__${id}`
      await createSimpleTable(clients[0], tableName)
      await Promise.all(
        clients.map((client, i) =>
          client.insert({
            table: tableName,
            values: [getValue(i)],
            format: 'JSONEachRow',
          })
        )
      )
      const result = await clients[0].query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONEachRow',
      })
      expect(await result.json()).toEqual(expected)
    })

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
          })
        )
      )
      const result = await clients[0].query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONEachRow',
      })
      expect(await result.json()).toEqual(expected)
    })
  })
})
