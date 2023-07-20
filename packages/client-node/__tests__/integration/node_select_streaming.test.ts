import type { ClickHouseClient, Row } from '@clickhouse/client-common'
import { createTestClient } from '@test/utils'
import type Stream from 'stream'

describe('[Node.js] SELECT streaming', () => {
  let client: ClickHouseClient<Stream.Readable>
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
      let result = ''
      for await (const rows of rs.stream()) {
        rows.forEach((row: Row) => {
          result += row.text
        })
      }
      expect(result).toEqual('0')
      // wrap in a func to avoid changing inner "this"
      await assertAlreadyConsumed$(() => rs.json())
      await assertAlreadyConsumed$(() => rs.text())
      await assertAlreadyConsumed(() => rs.stream())
    })
  })

  describe('select result asStream()', () => {
    it('throws an exception if format is not stream-able', async () => {
      const result = await client.query({
        query: 'SELECT number FROM system.numbers LIMIT 5',
        format: 'JSON',
      })
      try {
        await expectAsync((async () => result.stream())()).toBeRejectedWith(
          jasmine.objectContaining({
            message: jasmine.stringContaining('JSON format is not streamable'),
          })
        )
      } finally {
        result.close()
      }
    })

    it('can pause response stream', async () => {
      const result = await client.query({
        query: 'SELECT number FROM system.numbers LIMIT 10000',
        format: 'CSV',
      })

      const stream = result.stream()

      let last = ''
      let i = 0
      for await (const rows of stream) {
        rows.forEach((row: Row) => {
          last = row.text
          i++
          if (i % 1000 === 0) {
            stream.pause()
            setTimeout(() => stream.resume(), 100)
          }
        })
      }
      expect(last).toBe('9999')
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

        const rs = await rowsValues(result.stream())
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

        const rs = await rowsValues(result.stream())
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

        const rs = await rowsValues(result.stream())
        expect(rs).toEqual([['0'], ['1'], ['2'], ['3'], ['4']])
      })

      it('returns stream of objects in JSONCompactEachRowWithNames format', async () => {
        const result = await client.query({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONCompactEachRowWithNames',
        })

        const rs = await rowsValues(result.stream())
        expect(rs).toEqual([['number'], ['0'], ['1'], ['2'], ['3'], ['4']])
      })

      it('returns stream of objects in JSONCompactEachRowWithNamesAndTypes format', async () => {
        const result = await client.query({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONCompactEachRowWithNamesAndTypes',
        })

        const rs = await rowsValues(result.stream())
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

        const rs = await rowsValues(result.stream())
        expect(rs).toEqual([['number'], ['0'], ['1'], ['2'], ['3'], ['4']])
      })

      it('returns stream of objects in JSONCompactStringsEachRowWithNamesAndTypes format', async () => {
        const result = await client.query({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONCompactStringsEachRowWithNamesAndTypes',
        })

        const rs = await rowsValues(result.stream())
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
})

async function rowsValues(stream: Stream.Readable): Promise<any[]> {
  const result: any[] = []
  for await (const rows of stream) {
    rows.forEach((row: Row) => {
      result.push(row.json())
    })
  }
  return result
}

async function rowsText(stream: Stream.Readable): Promise<string[]> {
  const result: string[] = []
  for await (const rows of stream) {
    rows.forEach((row: Row) => {
      result.push(row.text)
    })
  }
  return result
}
