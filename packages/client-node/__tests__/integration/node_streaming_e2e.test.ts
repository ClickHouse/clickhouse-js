import type { Row } from '@clickhouse/client-common'
import { type ClickHouseClient } from '@clickhouse/client-common'
import { fakerRU } from '@faker-js/faker'
import { createSimpleTable } from '@test/fixtures/simple_table'
import { createTableWithFields } from '@test/fixtures/table_with_fields'
import { createTestClient, guid } from '@test/utils'
import Fs from 'fs'
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

  it('should stream a file', async () => {
    // contains id as numbers in JSONCompactEachRow format ["0"]\n["1"]\n...
    const filename =
      'packages/client-common/__tests__/fixtures/streaming_e2e_data.ndjson'
    await client.insert({
      table: tableName,
      values: Fs.createReadStream(filename).pipe(
        // should be removed when "insert" accepts a stream of strings/bytes
        split((row: string) => JSON.parse(row))
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
    async function generateData({
      rows,
      words,
    }: {
      rows: number
      words: number
    }): Promise<{
      table: string
      values: { id: number; sentence: string; timestamp: string }[]
    }> {
      const table = await createTableWithFields(
        client as ClickHouseClient,
        `sentence String, timestamp String`
      )
      const values = [...new Array(rows)].map((_, id) => ({
        id,
        // it seems that it is easier to trigger an incorrect behavior with non-ASCII symbols
        sentence: fakerRU.lorem.sentence(words),
        timestamp: new Date().toISOString(),
      }))
      await client.insert({
        table,
        values,
        format: 'JSONEachRow',
      })
      return {
        table,
        values,
      }
    }

    describe('large amount of rows', () => {
      it('should work with .json()', async () => {
        const { table, values } = await generateData({
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
        const { table, values } = await generateData({
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
        const { table, values } = await generateData({
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
        const { table, values } = await generateData({
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
