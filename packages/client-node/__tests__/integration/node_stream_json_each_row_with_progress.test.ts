import { type ClickHouseClient } from '@clickhouse/client-common'
import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import { createSimpleTable } from '@test/fixtures/simple_table'
import { createTestClient } from '@test/utils/client'
import { isClickHouseVersionAtLeast } from '@test/utils/server_version'
import { guid } from '@test/utils/guid'
import * as simdjson from 'simdjson'
import { makeObjectStream } from '../utils/stream'

let client: ClickHouseClient
let tableName: string

beforeEach(async () => {
  client = createTestClient()
  tableName = `insert_stream_json_${guid()}`
  await createSimpleTable(client, tableName)
})
afterEach(async () => {
  await client.close()
})

describe('JSONEachRowWithProgress', () => {
  it('works with progress rows', async () => {
    const rs = await client.query({
      query: 'SELECT sleep(0.1) AS foo FROM numbers(2)',
      format: 'JSONEachRowWithProgress',
      clickhouse_settings: {
        // triggers more progress rows, as it is emitted after each block
        max_block_size: '1',
      },
    })
    const rows = await rs.json()
    expect(rows).toEqual([
      {
        progress: {
          read_rows: '1',
          read_bytes: '8',
          total_rows_to_read: '2',
          elapsed_ns: expect.stringMatching(/^\d+$/),
        },
      },
      { meta: [{ name: 'foo', type: 'UInt8' }] },
      { row: { foo: 0 } },
      {
        progress: {
          read_rows: '2',
          read_bytes: '16',
          total_rows_to_read: '2',
          elapsed_ns: expect.stringMatching(/^\d+$/),
        },
      },
      { row: { foo: 0 } },
    ])
  })

  // See https://github.com/ClickHouse/ClickHouse/pull/74181/files#diff-9be59e5a502cccf360c8f2b0419115cfa2513def8f964f7c24459cfa0e877578
  it('works with special events', async () => {
    const rs = await client.query({
      query: `SELECT (123 + number * 456) % 100 AS k, count() AS c, sum(number) AS s FROM numbers(100) GROUP BY ALL WITH TOTALS ORDER BY ALL LIMIT 10`,
      format: 'JSONEachRowWithProgress',
      clickhouse_settings: {
        rows_before_aggregation: 1,
        extremes: 1,
      },
    })
    const rows = await rs.json<{ k: number; c: string; s: string }>()
    expect(rows).toEqual([
      {
        progress: {
          read_rows: '100',
          read_bytes: '800',
          total_rows_to_read: '100',
          elapsed_ns: expect.stringMatching(/^\d+$/),
        },
      },
      {
        meta: [
          { name: 'k', type: 'UInt8' },
          { name: 'c', type: 'UInt64' },
          { name: 's', type: 'UInt64' },
        ],
      },
      { row: { k: 3, c: '4', s: '170' } },
      { row: { k: 7, c: '4', s: '206' } },
      { row: { k: 11, c: '4', s: '242' } },
      { row: { k: 15, c: '4', s: '178' } },
      { row: { k: 19, c: '4', s: '214' } },
      { row: { k: 23, c: '4', s: '150' } },
      { row: { k: 27, c: '4', s: '186' } },
      { row: { k: 31, c: '4', s: '222' } },
      { row: { k: 35, c: '4', s: '158' } },
      { row: { k: 39, c: '4', s: '194' } },
      { totals: { k: 0, c: '100', s: '4950' } },
      { min: { k: 3, c: '4', s: '150' } },
      { max: { k: 39, c: '4', s: '242' } },
      { rows_before_limit_at_least: 25 },
      { rows_before_aggregation: 100 },
    ])
  })

  it('works with exceptions', async ({ skip }) => {
    if (!(await isClickHouseVersionAtLeast(client, 25, 11))) {
      skip()
    }

    const rs = await client.query({
      query: `SELECT toInt32(number) AS n,
                 throwIf(number = 10, 'boom') AS e,
                 sleepEachRow(0.001)
          FROM system.numbers LIMIT 100`,
      format: 'JSONEachRowWithProgress',
      clickhouse_settings: {
        // enforcing at least a few blocks, so that the response code is 200 OK
        max_block_size: '1',
        // Should be false by default since 25.11; but setting explicitly to make sure
        // the server configuration doesn't interfere with the test.
        http_write_exception_in_output_format: false,
      },
    })
    await expect(rs.json()).rejects.toMatchObject({
      code: '395',
      message: expect.stringContaining(
        `boom: while executing 'FUNCTION throwIf`,
      ),
    })
  })

  describe('custom JSON handling', () => {
    it('should use custom stringify when inserting with JSONEachRow stream', async () => {
      let stringifyCalls = 0
      const customClient = createTestClient({
        json: {
          parse: JSON.parse,
          stringify: (value) => {
            stringifyCalls++
            return JSON.stringify(value)
          },
        },
      })

      const stream = makeObjectStream()
      stream.push({ id: '42', name: 'foo', sku: [0, 1] })
      stream.push({ id: '43', name: 'bar', sku: [2, 3] })
      setTimeout(() => stream.push(null), 100)

      await customClient.insert({
        table: tableName,
        values: stream,
        format: 'JSONEachRow',
      })

      expect(stringifyCalls).toBe(2)

      const result = await customClient.query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONEachRow',
      })
      expect(await result.json()).toEqual([
        { id: '42', name: 'foo', sku: [0, 1] },
        { id: '43', name: 'bar', sku: [2, 3] },
      ])

      await customClient.close()
    })

    it('should use custom stringify when inserting with JSONEachRow array', async () => {
      let stringifyCalls = 0
      const customClient = createTestClient({
        json: {
          parse: JSON.parse,
          stringify: (value) => {
            stringifyCalls++
            return JSON.stringify(value)
          },
        },
      })

      const values = [
        { id: '42', name: 'foo', sku: [0, 1] },
        { id: '43', name: 'bar', sku: [2, 3] },
      ]

      await customClient.insert({
        table: tableName,
        values,
        format: 'JSONEachRow',
      })

      expect(stringifyCalls).toBe(2)

      const result = await customClient.query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONEachRow',
      })
      expect(await result.json()).toEqual(values)

      await customClient.close()
    })

    it('should use custom parse when querying with JSONEachRow', async () => {
      let parseCalls = 0
      const customClient = createTestClient({
        json: {
          parse: (text) => {
            parseCalls++
            return JSON.parse(text)
          },
          stringify: JSON.stringify,
        },
      })

      const stream = makeObjectStream()
      stream.push({ id: '42', name: 'foo', sku: [0, 1] })
      stream.push({ id: '43', name: 'bar', sku: [2, 3] })
      setTimeout(() => stream.push(null), 100)

      await customClient.insert({
        table: tableName,
        values: stream,
        format: 'JSONEachRow',
      })

      parseCalls = 0
      const result = await customClient.query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONEachRow',
      })
      await result.json()

      expect(parseCalls).toBeGreaterThan(0)

      await customClient.close()
    })

    it('should work with simdjson parser', async () => {
      const customClient = createTestClient({
        json: {
          parse: simdjson.parse,
          stringify: JSON.stringify,
        },
      })

      const stream = makeObjectStream()
      stream.push({ id: '42', name: 'foo', sku: [0, 1] })
      stream.push({ id: '43', name: 'bar', sku: [2, 3] })
      setTimeout(() => stream.push(null), 100)

      await customClient.insert({
        table: tableName,
        values: stream,
        format: 'JSONEachRow',
      })

      const result = await customClient.query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONEachRow',
      })
      expect(await result.json()).toEqual([
        { id: '42', name: 'foo', sku: [0, 1] },
        { id: '43', name: 'bar', sku: [2, 3] },
      ])

      await customClient.close()
    })

    it('should use custom stringify with JSONCompactEachRow', async () => {
      let stringifyCalls = 0
      const customClient = createTestClient({
        json: {
          parse: JSON.parse,
          stringify: (value) => {
            stringifyCalls++
            return JSON.stringify(value)
          },
        },
      })

      const stream = makeObjectStream()
      stream.push(['42', 'foo', [0, 1]])
      stream.push(['43', 'bar', [2, 3]])
      setTimeout(() => stream.push(null), 100)

      await customClient.insert({
        table: tableName,
        values: stream,
        format: 'JSONCompactEachRow',
      })

      expect(stringifyCalls).toBe(2)

      const result = await customClient.query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONCompactEachRow',
      })
      expect(await result.json()).toEqual([
        ['42', 'foo', [0, 1]],
        ['43', 'bar', [2, 3]],
      ])

      await customClient.close()
    })

    it('should use custom stringify for data transformation', async () => {
      const customClient = createTestClient({
        json: {
          parse: JSON.parse,
          stringify: (value) => {
            if (typeof value === 'object' && value !== null && 'id' in value) {
              return JSON.stringify({
                ...value,
                id: String(Number(value.id) * 10),
              })
            }
            return JSON.stringify(value)
          },
        },
      })

      const values = [
        { id: '4', name: 'foo', sku: [0, 1] },
        { id: '5', name: 'bar', sku: [2, 3] },
      ]

      await customClient.insert({
        table: tableName,
        values,
        format: 'JSONEachRow',
      })

      const result = await customClient.query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONEachRow',
      })
      expect(await result.json()).toEqual([
        { id: '40', name: 'foo', sku: [0, 1] },
        { id: '50', name: 'bar', sku: [2, 3] },
      ])

      await customClient.close()
    })
  })
})
