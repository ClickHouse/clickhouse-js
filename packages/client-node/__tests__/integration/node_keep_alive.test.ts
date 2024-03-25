import { ClickHouseLogLevel } from '@clickhouse/client-common'
import { createSimpleTable } from '@test/fixtures/simple_table'
import { guid, sleep } from '@test/utils'
import type { NodeClickHouseClient } from '../../src'
import type { NodeClickHouseClientConfigOptions } from '../../src/config'
import { createNodeTestClient } from '../utils/node_client'

/**
 * FIXME: Works fine during the local runs, but it is flaky on GHA,
 *  maybe because of Jasmine test runner vs Jest and tests isolation
 *  To be revisited in https://github.com/ClickHouse/clickhouse-js/issues/177
 */
xdescribe('[Node.js] Keep Alive', () => {
  let client: NodeClickHouseClient
  const socketTTL = 2500 // seems to be a sweet spot for testing Keep-Alive socket hangups with 3s in config.xml
  afterEach(async () => {
    await client.close()
  })

  describe('query', () => {
    it('should recreate the request if socket is potentially expired', async () => {
      client = createNodeTestClient({
        max_open_connections: 1,
        keep_alive: {
          enabled: true,
          idle_socket_ttl: socketTTL,
        },
      } as NodeClickHouseClientConfigOptions)
      expect(await query(0)).toEqual(1)
      await sleep(socketTTL)
      // this one could've failed without idle socket release
      expect(await query(1)).toEqual(2)
    })

    it('should disable keep alive', async () => {
      client = createNodeTestClient({
        max_open_connections: 1,
        keep_alive: {
          enabled: true,
        },
      } as NodeClickHouseClientConfigOptions)
      expect(await query(0)).toEqual(1)
      await sleep(socketTTL)
      // this one won't fail cause a new socket will be assigned
      expect(await query(1)).toEqual(2)
    })

    it('should use multiple connections', async () => {
      client = createNodeTestClient({
        keep_alive: {
          enabled: true,
          idle_socket_ttl: socketTTL,
        },
      } as NodeClickHouseClientConfigOptions)

      const results = await Promise.all(
        [...Array(4).keys()].map((n) => query(n)),
      )
      expect(results.sort()).toEqual([1, 2, 3, 4])
      await sleep(socketTTL)
      const results2 = await Promise.all(
        [...Array(4).keys()].map((n) => query(n + 10)),
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
  // if the assigned socket is potentially expired, but better safe than sorry.
  // keep alive sockets for insert operations should be reused as normal
  describe('insert', () => {
    let tableName: string
    it('should not duplicate insert requests (single connection)', async () => {
      client = createNodeTestClient({
        max_open_connections: 1,
        log: {
          level: ClickHouseLogLevel.TRACE,
        },
        keep_alive: {
          enabled: true,
          idle_socket_ttl: socketTTL,
        },
      } as NodeClickHouseClientConfigOptions)
      tableName = `keep_alive_single_connection_insert_${guid()}`
      await createSimpleTable(client, tableName)
      await insert(0)
      await sleep(socketTTL)
      // this one should not fail, as it will have a fresh socket
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
      client = createNodeTestClient({
        max_open_connections: 2,
        keep_alive: {
          enabled: true,
          idle_socket_ttl: socketTTL,
        },
      } as NodeClickHouseClientConfigOptions)
      tableName = `keep_alive_multiple_connection_insert_${guid()}`
      await createSimpleTable(client, tableName)
      await Promise.all([...Array(3).keys()].map((n) => insert(n)))
      await sleep(socketTTL)
      // at least two of these should use a fresh socket
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
