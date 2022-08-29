import type Stream from 'stream'
import { type ClickHouseClient, type ResponseJSON, type Row } from '../../src'
import { createTestClient } from '../utils'

async function rowsValues(stream: Stream.Readable): Promise<any[]> {
  const result: any[] = []
  for await (const chunk of stream) {
    result.push((chunk as Row).json())
  }
  return result
}

async function rowsText(stream: Stream.Readable): Promise<string[]> {
  const result: string[] = []
  for await (const chunk of stream) {
    result.push((chunk as Row).text())
  }
  return result
}

describe('select', () => {
  let client: ClickHouseClient
  afterEach(async () => {
    await client.close()
  })
  beforeEach(async () => {
    client = createTestClient()
  })

  it('can send a multiline query', async () => {
    const rows = await client.select({
      query: `
        SELECT number
        FROM system.numbers
        LIMIT 2
      `,
      format: 'CSV',
    })

    const response = await rows.text()
    expect(response).toBe('0\n1\n')
  })

  it('can send a query with an inline comment', async () => {
    const rows = await client.select({
      query: `
        SELECT number
        -- a comment
        FROM system.numbers
        LIMIT 2
      `,
      format: 'CSV',
    })

    const response = await rows.text()
    expect(response).toBe('0\n1\n')
  })

  it('can send a query with a multiline comment', async () => {
    const rows = await client.select({
      query: `
        SELECT number
        /* This is:
         a multiline comment
        */
        FROM system.numbers
        LIMIT 2
      `,
      format: 'CSV',
    })

    const response = await rows.text()
    expect(response).toBe('0\n1\n')
  })

  it('can send a query with a trailing comment', async () => {
    const rows = await client.select({
      query: `
        SELECT number
        FROM system.numbers
        LIMIT 2
        -- comment`,
      format: 'JSON',
    })

    const response = await rows.json<ResponseJSON<{ number: string }>>()
    expect(response.data).toEqual([{ number: '0' }, { number: '1' }])
  })

  it('can specify settings in select', async () => {
    const rows = await client.select({
      query: 'SELECT number FROM system.numbers LIMIT 5',
      format: 'CSV',
      clickhouse_settings: {
        limit: '2',
      },
    })

    const response = await rows.text()
    expect(response).toBe('0\n1\n')
  })

  it('does not swallow a client error', async () => {
    await expect(client.select({ query: 'SELECT number FR' })).rejects.toEqual(
      expect.objectContaining({
        type: 'UNKNOWN_IDENTIFIER',
      })
    )
  })

  it('returns an error details provided by ClickHouse', async () => {
    await expect(client.select({ query: 'foobar' })).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringContaining('Syntax error'),
        code: '62',
        type: 'SYNTAX_ERROR',
      })
    )
  })

  describe('select result', () => {
    describe('text()', function () {
      it('returns values from SELECT query in specified format', async () => {
        const Rows = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 3',
          format: 'CSV',
        })

        expect(await Rows.text()).toBe('0\n1\n2\n')
      })
      it('returns values from SELECT query in specified format', async () => {
        const Rows = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 3',
          format: 'JSONEachRow',
        })

        expect(await Rows.text()).toBe(
          '{"number":"0"}\n{"number":"1"}\n{"number":"2"}\n'
        )
      })
    })

    describe('json()', () => {
      it('returns an array of values in data property', async () => {
        const rows = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSON',
        })

        const { data: nums } = await rows.json<
          ResponseJSON<{ number: string }>
        >()
        expect(Array.isArray(nums)).toBe(true)
        expect(nums).toHaveLength(5)
        const values = nums.map((i) => i.number)
        expect(values).toEqual(['0', '1', '2', '3', '4'])
      })

      it('returns columns data in response', async () => {
        const rows = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSON',
        })

        const { meta } = await rows.json<ResponseJSON<{ number: string }>>()

        expect(meta?.length).toBe(1)
        const column = meta ? meta[0] : undefined
        expect(column).toEqual({
          name: 'number',
          type: 'UInt64',
        })
      })

      it('returns number of rows in response', async () => {
        const rows = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSON',
        })

        const response = await rows.json<ResponseJSON<{ number: string }>>()

        expect(response.rows).toBe(5)
      })

      it('returns statistics in response', async () => {
        const rows = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSON',
        })

        const response = await rows.json<ResponseJSON<{ number: string }>>()
        expect(response).toEqual(
          expect.objectContaining({
            statistics: {
              elapsed: expect.any(Number),
              rows_read: expect.any(Number),
              bytes_read: expect.any(Number),
            },
          })
        )
      })

      it.skip('returns queryId in response', async () => {
        const rows = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSON',
        })

        const response = await rows.json<ResponseJSON<{ number: string }>>()

        expect(response.query_id).toBeInstanceOf(Number)
      })
    })
  })

  describe('select result asStream()', () => {
    it('throws an exception if format is not stream-able', async () => {
      const result = await client.select({
        query: 'SELECT number FROM system.numbers LIMIT 5',
        format: 'JSON',
      })
      try {
        expect(() => result.asStream()).toThrowError(
          'JSON format is not streamable'
        )
      } finally {
        result.close()
      }
    })

    it('can pause response stream', async () => {
      const result = await client.select({
        query: 'SELECT number FROM system.numbers LIMIT 10000',
        format: 'CSV',
      })

      const stream = result.asStream()

      let last = null
      let i = 0
      for await (const chunk of stream) {
        last = chunk.text()
        i++
        if (i % 1000 === 0) {
          stream.pause()
          setTimeout(() => stream.resume(), 100)
        }
      }
      expect(last).toBe('9999')
    })

    describe('text()', () => {
      it('returns stream of rows in CSV format', async () => {
        const result = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'CSV',
        })

        const rows = await rowsText(result.asStream())

        expect(rows).toEqual(['0', '1', '2', '3', '4'])
      })

      it('returns stream of rows in TabSeparated format', async () => {
        const result = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'TabSeparated',
        })

        const rows = await rowsText(result.asStream())

        expect(rows).toEqual(['0', '1', '2', '3', '4'])
      })
    })

    describe('json()', () => {
      it('returns stream of objects in JSONEachRow format', async () => {
        const result = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONEachRow',
        })

        const rows = await rowsValues(result.asStream())

        expect(rows).toEqual([
          { number: '0' },
          { number: '1' },
          { number: '2' },
          { number: '3' },
          { number: '4' },
        ])
      })

      it('returns stream of objects in JSONStringsEachRow format', async () => {
        const result = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONStringsEachRow',
        })

        const rows = await rowsValues(result.asStream())

        expect(rows).toEqual([
          { number: '0' },
          { number: '1' },
          { number: '2' },
          { number: '3' },
          { number: '4' },
        ])
      })

      it('returns stream of objects in JSONCompactEachRow format', async () => {
        const result = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONCompactEachRow',
        })

        const rows = await rowsValues(result.asStream())

        expect(rows).toEqual([['0'], ['1'], ['2'], ['3'], ['4']])
      })

      it('returns stream of objects in JSONCompactEachRowWithNames format', async () => {
        const result = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONCompactEachRowWithNames',
        })

        const rows = await rowsValues(result.asStream())

        expect(rows).toEqual([['number'], ['0'], ['1'], ['2'], ['3'], ['4']])
      })

      it('returns stream of objects in JSONCompactEachRowWithNamesAndTypes format', async () => {
        const result = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONCompactEachRowWithNamesAndTypes',
        })

        const rows = await rowsValues(result.asStream())

        expect(rows).toEqual([
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
        const result = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONCompactStringsEachRowWithNames',
        })

        const rows = await rowsValues(result.asStream())

        expect(rows).toEqual([['number'], ['0'], ['1'], ['2'], ['3'], ['4']])
      })

      it('returns stream of objects in JSONCompactStringsEachRowWithNamesAndTypes format', async () => {
        const result = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONCompactStringsEachRowWithNamesAndTypes',
        })

        const rows = await rowsValues(result.asStream())

        expect(rows).toEqual([
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

  describe('trailing semi', () => {
    it('should allow queries with trailing semicolon', async () => {
      const numbers = await client.select({
        query: 'SELECT * FROM system.numbers LIMIT 3;',
        format: 'CSV',
      })
      expect(await numbers.text()).toEqual('0\n1\n2\n')
    })

    it('should allow queries with multiple trailing semicolons', async () => {
      const numbers = await client.select({
        query: 'SELECT * FROM system.numbers LIMIT 3;;;;;;;;;;;;;;;;;',
        format: 'CSV',
      })
      expect(await numbers.text()).toEqual('0\n1\n2\n')
    })
  })
})
