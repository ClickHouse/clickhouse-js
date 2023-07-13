import type { ClickHouseClient, Row } from '@clickhouse/client-common'
import { createTestClient } from '@test/utils'

describe('Browser SELECT streaming', () => {
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
        })
      )
    }
    function assertAlreadyConsumed<T>(fn: () => T) {
      expect(fn).toThrow(
        jasmine.objectContaining({
          message: 'Stream has been already consumed',
        })
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
        format: 'TabSeparated',
      })
      expect(await rs.text()).toEqual('0\n')
      // wrap in a func to avoid changing inner "this"
      await assertAlreadyConsumed$(() => rs.json())
      await assertAlreadyConsumed$(() => rs.text())
      await assertAlreadyConsumed(() => rs.stream())
    })

    it('should consume a stream response only once', async () => {
      const rs = await client.query({
        query: 'SELECT * FROM system.numbers LIMIT 1',
        format: 'TabSeparated',
      })
      const result = await rowsText(rs.stream())
      expect(result).toEqual(['0'])
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
        })
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
})

async function rowsJsonValues<T = unknown>(
  stream: ReadableStream<Row[]>
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
