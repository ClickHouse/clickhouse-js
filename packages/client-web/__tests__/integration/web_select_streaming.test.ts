import type { ClickHouseClient, Row } from '@clickhouse/client-common'
import { fakerRU } from '@faker-js/faker'
import { createTableWithFields } from '@test/fixtures/table_with_fields'
import { createTestClient } from '@test/utils'

describe('[Web] SELECT streaming', () => {
  let client: ClickHouseClient<ReadableStream<Row[]>>
  afterEach(async () => {
    await client.close()
  })
  beforeEach(async () => {
    client = createTestClient()
  })

  describe('consume the response only once', () => {
    async function assertAlreadyConsumed$<T>(fn: () => Promise<T>) {
      await expectAsync(fn()).toBeRejectedWith(
        jasmine.objectContaining({
          message: 'Stream has been already consumed',
        }),
      )
    }
    function assertAlreadyConsumed<T>(fn: () => T) {
      expect(fn).toThrow(
        jasmine.objectContaining({
          message: 'Stream has been already consumed',
        }),
      )
    }
    it('should consume a JSON response only once', async () => {
      const rs = await client.query({
        query: 'SELECT * FROM system.numbers LIMIT 1',
        format: 'JSONEachRow',
      })
      expect(await rs.json()).toEqual([{ number: '0' }])
      // wrap in a func to avoid changing inner "this"
      await assertAlreadyConsumed$(() => rs.json())
      await assertAlreadyConsumed$(() => rs.text())
      await assertAlreadyConsumed(() => rs.stream())
    })

    it('should consume a text response only once', async () => {
      const rs = await client.query({
        query: 'SELECT * FROM system.numbers LIMIT 1',
        format: 'JSONEachRow',
      })
      expect(await rs.text()).toEqual('{"number":"0"}\n')
      // wrap in a func to avoid changing inner "this"
      await assertAlreadyConsumed$(() => rs.json())
      await assertAlreadyConsumed$(() => rs.text())
      await assertAlreadyConsumed(() => rs.stream())
    })

    it('should consume a stream response only once', async () => {
      const rs = await client.query({
        query: 'SELECT * FROM system.numbers LIMIT 1',
        format: 'JSONEachRow',
      })
      const result = await rowsText(rs.stream())
      expect(result).toEqual(['{"number":"0"}'])
      // wrap in a func to avoid changing inner "this"
      await assertAlreadyConsumed$(() => rs.json())
      await assertAlreadyConsumed$(() => rs.text())
      assertAlreadyConsumed(() => rs.stream())
    })
  })

  describe('select result asStream()', () => {
    it('throws an exception if format is not stream-able', async () => {
      const result = await client.query({
        query: 'SELECT number FROM system.numbers LIMIT 5',
        format: 'JSON',
      })
      // wrap in a func to avoid changing inner "this"
      expect(() => result.stream()).toThrow(
        jasmine.objectContaining({
          message: jasmine.stringContaining('JSON format is not streamable'),
        }),
      )
    })
  })

  describe('text()', () => {
    it('returns stream of rows in CSV format', async () => {
      const result = await client.query({
        query: 'SELECT number FROM system.numbers LIMIT 5',
        format: 'CSV',
      })

      const rs = await rowsText(result.stream())
      expect(rs).toEqual(['0', '1', '2', '3', '4'])
    })

    it('returns stream of rows in TabSeparated format', async () => {
      const result = await client.query({
        query: 'SELECT number FROM system.numbers LIMIT 5',
        format: 'TabSeparated',
      })

      const rs = await rowsText(result.stream())
      expect(rs).toEqual(['0', '1', '2', '3', '4'])
    })
  })

  describe('json()', () => {
    it('returns stream of objects in JSONEachRow format', async () => {
      const result = await client.query({
        query: 'SELECT number FROM system.numbers LIMIT 5',
        format: 'JSONEachRow',
      })

      const rs = await rowsJsonValues<{ number: string }>(result.stream())
      expect(rs).toEqual([
        { number: '0' },
        { number: '1' },
        { number: '2' },
        { number: '3' },
        { number: '4' },
      ])
    })

    it('returns stream of objects in JSONStringsEachRow format', async () => {
      const result = await client.query({
        query: 'SELECT number FROM system.numbers LIMIT 5',
        format: 'JSONStringsEachRow',
      })

      const rs = await rowsJsonValues<{ number: string }>(result.stream())
      expect(rs).toEqual([
        { number: '0' },
        { number: '1' },
        { number: '2' },
        { number: '3' },
        { number: '4' },
      ])
    })

    it('returns stream of objects in JSONCompactEachRow format', async () => {
      const result = await client.query({
        query: 'SELECT number FROM system.numbers LIMIT 5',
        format: 'JSONCompactEachRow',
      })

      const rs = await rowsJsonValues<[string]>(result.stream())
      expect(rs).toEqual([['0'], ['1'], ['2'], ['3'], ['4']])
    })

    it('returns stream of objects in JSONCompactEachRowWithNames format', async () => {
      const result = await client.query({
        query: 'SELECT number FROM system.numbers LIMIT 5',
        format: 'JSONCompactEachRowWithNames',
      })

      const rs = await rowsJsonValues<[string]>(result.stream())
      expect(rs).toEqual([['number'], ['0'], ['1'], ['2'], ['3'], ['4']])
    })

    it('returns stream of objects in JSONCompactEachRowWithNamesAndTypes format', async () => {
      const result = await client.query({
        query: 'SELECT number FROM system.numbers LIMIT 5',
        format: 'JSONCompactEachRowWithNamesAndTypes',
      })

      const rs = await rowsJsonValues<[string]>(result.stream())
      expect(rs).toEqual([
        ['number'],
        ['UInt64'],
        ['0'],
        ['1'],
        ['2'],
        ['3'],
        ['4'],
      ])
    })

    it('returns stream of objects in JSONCompactStringsEachRowWithNames format', async () => {
      const result = await client.query({
        query: 'SELECT number FROM system.numbers LIMIT 5',
        format: 'JSONCompactStringsEachRowWithNames',
      })

      const rs = await rowsJsonValues<[string]>(result.stream())
      expect(rs).toEqual([['number'], ['0'], ['1'], ['2'], ['3'], ['4']])
    })

    it('returns stream of objects in JSONCompactStringsEachRowWithNamesAndTypes format', async () => {
      const result = await client.query({
        query: 'SELECT number FROM system.numbers LIMIT 5',
        format: 'JSONCompactStringsEachRowWithNamesAndTypes',
      })

      const rs = await rowsJsonValues<[string]>(result.stream())
      expect(rs).toEqual([
        ['number'],
        ['UInt64'],
        ['0'],
        ['1'],
        ['2'],
        ['3'],
        ['4'],
      ])
    })
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
        `sentence String, timestamp String`,
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

async function rowsJsonValues<T = unknown>(
  stream: ReadableStream<Row[]>,
): Promise<T[]> {
  const result: T[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    value.forEach((row) => {
      result.push(row.json<T>())
    })
  }
  return result
}

async function rowsText(stream: ReadableStream<Row[]>): Promise<string[]> {
  const result: string[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    value.forEach((row) => {
      result.push(row.text)
    })
  }
  return result
}
