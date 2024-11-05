import type { Row } from '@clickhouse/client-common'
import {
  type ClickHouseClient,
  type ClickHouseSettings,
} from '@clickhouse/client-common'
import { createSimpleTable } from '@test/fixtures/simple_table'
import { createTestClient, guid } from '@test/utils'
import { genLargeStringsDataset } from '@test/utils/datasets'
import { tableFromIPC } from 'apache-arrow'
import { Buffer } from 'buffer'
import Fs from 'fs'
import { readParquet } from 'parquet-wasm'
import split from 'split2'
import Stream from 'stream'

describe('[Node.js] streaming e2e', () => {
  let tableName: string
  let client: ClickHouseClient<Stream.Readable>
  beforeEach(async () => {
    client = createTestClient()

    tableName = `streaming_e2e_test_${guid()}`
    await createSimpleTable(client, tableName)
  })

  afterEach(async () => {
    await client.close()
  })

  const expected: Array<Array<string | number[]>> = [
    ['0', 'a', [1, 2]],
    ['1', 'b', [3, 4]],
    ['2', 'c', [5, 6]],
  ]

  it('should stream an NDJSON file', async () => {
    // contains id as numbers in JSONCompactEachRow format ["0"]\n["1"]\n...
    const filename =
      'packages/client-common/__tests__/fixtures/streaming_e2e_data.ndjson'
    await client.insert({
      table: tableName,
      values: Fs.createReadStream(filename).pipe(
        // should be removed when "insert" accepts a stream of strings/bytes
        split((row: string) => JSON.parse(row)),
      ),
      format: 'JSONCompactEachRow',
    })

    const rs = await client.query({
      query: `SELECT * from ${tableName}`,
      format: 'JSONCompactEachRow',
    })

    const actual: unknown[] = []
    for await (const rows of rs.stream()) {
      rows.forEach((row: Row) => {
        actual.push(row.json())
      })
    }
    expect(actual).toEqual(expected)
  })

  it('should stream a Parquet file', async () => {
    const streamParquetSettings: ClickHouseSettings = {
      output_format_parquet_compression_method: 'none',
      output_format_parquet_version: '2.6',
      // 24.3+ has this enabled by default; prior versions need this setting to be enforced for consistent assertions
      // Otherwise, the string type for Parquet will be Binary (24.3+) vs Utf8 (24.3-).
      // https://github.com/ClickHouse/ClickHouse/pull/61817/files#diff-aa3c979016a9f8c6ab5a51560411afa3f4cef55d34c899a2b1e7aff38aca4076R1097
      output_format_parquet_string_as_string: 1,
    }

    const filename =
      'packages/client-common/__tests__/fixtures/streaming_e2e_data.parquet'
    await client.insert({
      table: tableName,
      values: Fs.createReadStream(filename),
      format: 'Parquet',
    })

    // check that the data was inserted correctly
    const rs = await client.query({
      query: `SELECT * from ${tableName}`,
      format: 'JSONCompactEachRow',
    })

    const actual: unknown[] = []
    for await (const rows of rs.stream()) {
      rows.forEach((row: Row) => {
        actual.push(row.json())
      })
    }
    expect(actual).toEqual(expected)

    // check if we can stream it back and get the output matching the input file
    const stream = await client
      .exec({
        query: `SELECT * from ${tableName} FORMAT Parquet`,
        clickhouse_settings: streamParquetSettings,
      })
      .then((r) => r.stream)

    const parquetChunks: Buffer[] = []
    for await (const chunk of stream) {
      parquetChunks.push(chunk)
    }

    const table = tableFromIPC(
      readParquet(Buffer.concat(parquetChunks)).intoIPCStream(),
    )
    expect(table.schema.toString()).toEqual(
      'Schema<{ 0: id: Uint64, 1: name: Utf8, 2: sku: List<Uint8> }>',
    )
    const actualParquetData: unknown[] = []
    table.toArray().map((v) => {
      const row: Record<string, unknown> = {}
      row['id'] = v.id
      row['name'] = v.name
      row['sku'] = Array.from(v.sku.toArray()) // Vector -> UInt8Array -> Array
      actualParquetData.push(row)
    })
    expect(actualParquetData).toEqual([
      { id: 0n, name: 'a', sku: [1, 2] },
      { id: 1n, name: 'b', sku: [3, 4] },
      { id: 2n, name: 'c', sku: [5, 6] },
    ])
  })

  it('should stream a stream created in-place', async () => {
    await client.insert({
      table: tableName,
      values: Stream.Readable.from(expected),
      format: 'JSONCompactEachRow',
    })

    const rs = await client.query({
      query: `SELECT * from ${tableName}`,
      format: 'JSONCompactEachRow',
    })

    const actual: unknown[] = []
    for await (const rows of rs.stream()) {
      rows.forEach((row: Row) => {
        actual.push(row.json())
      })
    }
    expect(actual).toEqual(expected)
  })

  // See https://github.com/ClickHouse/clickhouse-js/issues/171 for more details
  // Here we generate a large enough dataset to break into multiple chunks while streaming,
  // effectively testing the implementation of incomplete rows handling
  describe('should correctly process multiple chunks', () => {
    describe('large amount of rows', () => {
      it('should work with .json()', async () => {
        const { table, values } = await genLargeStringsDataset(client, {
          rows: 10000,
          words: 10,
        })
        const result = await client
          .query({
            query: `SELECT * FROM ${table} ORDER BY id ASC`,
            format: 'JSONEachRow',
          })
          .then((r) => r.json())
        expect(result).toEqual(values)
      })

      it('should work with .stream()', async () => {
        const { table, values } = await genLargeStringsDataset(client, {
          rows: 10000,
          words: 10,
        })
        const stream = await client
          .query({
            query: `SELECT * FROM ${table} ORDER BY id ASC`,
            format: 'JSONEachRow',
          })
          .then((r) => r.stream())

        const result = []
        for await (const rows of stream) {
          for (const row of rows) {
            result.push(await row.json())
          }
        }
        expect(result).toEqual(values)
      })
    })

    describe("rows that don't fit into a single chunk", () => {
      it('should work with .json()', async () => {
        const { table, values } = await genLargeStringsDataset(client, {
          rows: 5,
          words: 10000,
        })
        const result = await client
          .query({
            query: `SELECT * FROM ${table} ORDER BY id ASC`,
            format: 'JSONEachRow',
          })
          .then((r) => r.json())
        expect(result).toEqual(values)
      })

      it('should work with .stream()', async () => {
        const { table, values } = await genLargeStringsDataset(client, {
          rows: 5,
          words: 10000,
        })
        const stream = await client
          .query({
            query: `SELECT * FROM ${table} ORDER BY id ASC`,
            format: 'JSONEachRow',
          })
          .then((r) => r.stream())

        const result = []
        for await (const rows of stream) {
          for (const row of rows) {
            result.push(await row.json())
          }
        }
        expect(result).toEqual(values)
      })
    })
  })
})
