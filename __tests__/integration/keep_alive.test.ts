import type { ClickHouseClient } from '../../src/client'
import { createTestClient, guid } from '../utils'
import { sleep } from '../utils/retry'
import { createSimpleTable } from './fixtures/simple_table'

describe('Node.js Keep Alive', () => {
  let client: ClickHouseClient
  const socketTTL = 2500 // seems to be a sweet spot for testing Keep-Alive socket hangups with 3s in config.xml
  afterEach(async () => {
    await client.close()
  })

  describe('query', () => {
    it('should recreate the request if socket is potentially expired', async () => {
      client = createTestClient({
        max_open_connections: 1,
        keep_alive: {
          enabled: true,
          socket_ttl: socketTTL,
          retry_on_expired_socket: true,
        },
      })
      expect(await query(0)).toEqual(1)
      await sleep(socketTTL)
      // this one will fail without retries
      expect(await query(1)).toEqual(2)
    })

    it('should disable keep alive', async () => {
      client = createTestClient({
        max_open_connections: 1,
        keep_alive: {
          enabled: false,
        },
      })
      expect(await query(0)).toEqual(1)
      await sleep(socketTTL)
      // this one won't fail cause a new socket will be assigned
      expect(await query(1)).toEqual(2)
    })

    it('should use multiple connections', async () => {
      client = createTestClient({
        keep_alive: {
          enabled: true,
          socket_ttl: socketTTL,
          retry_on_expired_socket: true,
        },
      })

      const results = await Promise.all(
        [...Array(4).keys()].map((n) => query(n))
      )
      expect(results.sort()).toEqual([1, 2, 3, 4])
      await sleep(socketTTL)
      const results2 = await Promise.all(
        [...Array(4).keys()].map((n) => query(n + 10))
      )
      expect(results2.sort()).toEqual([11, 12, 13, 14])
    })

    async function query(n: number) {
      const rs = await client.query({
        query: `SELECT * FROM system.numbers LIMIT ${1 + n}`,
        format: 'JSONEachRow',
      })
      return (await rs.json<Array<unknown>>()).length
    }
  })

  // the stream is not even piped into the request before we check
  // if the assigned socket is potentially expired, but better safe than sorry
  // observation: sockets seem to be never reused for insert operations
  describe('insert', () => {
    let tableName: string
    it('should not duplicate insert requests (single connection)', async () => {
      client = createTestClient({
        max_open_connections: 1,
        keep_alive: {
          enabled: true,
          socket_ttl: socketTTL,
          retry_on_expired_socket: true,
        },
      })
      tableName = `keep_alive_single_connection_insert_${guid()}`
      await createSimpleTable(client, tableName)
      await insert(0)
      await sleep(socketTTL)
      // this one should be retried
      await insert(1)
      const rs = await client.query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONEachRow',
      })
      expect(await rs.json()).toEqual([
        { id: `42`, name: 'hello', sku: [0, 1] },
        { id: `43`, name: 'hello', sku: [1, 2] },
      ])
    })

    it('should not duplicate insert requests (multiple connections)', async () => {
      client = createTestClient({
        max_open_connections: 2,
        keep_alive: {
          enabled: true,
          socket_ttl: socketTTL,
          retry_on_expired_socket: true,
        },
      })
      tableName = `keep_alive_multiple_connection_insert_${guid()}`
      await createSimpleTable(client, tableName)
      await Promise.all([...Array(3).keys()].map((n) => insert(n)))
      await sleep(socketTTL)
      // at least two of these should be retried
      await Promise.all([...Array(3).keys()].map((n) => insert(n + 10)))
      const rs = await client.query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONEachRow',
      })
      expect(await rs.json()).toEqual([
        // first "batch"
        { id: `42`, name: 'hello', sku: [0, 1] },
        { id: `43`, name: 'hello', sku: [1, 2] },
        { id: `44`, name: 'hello', sku: [2, 3] },
        // second "batch"
        { id: `52`, name: 'hello', sku: [10, 11] },
        { id: `53`, name: 'hello', sku: [11, 12] },
        { id: `54`, name: 'hello', sku: [12, 13] },
      ])
    })

    async function insert(n: number) {
      await client.insert({
        table: tableName,
        values: [{ id: `${42 + n}`, name: 'hello', sku: [n, n + 1] }],
        format: 'JSONEachRow',
      })
    }
  })
})
